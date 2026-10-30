import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { auditEvent, inventoryLine, inventoryScopeVariant, inventorySession, member, product, productCategory, productVariant, stockMovement } from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { parseQuantityMicros, QUANTITY_SCALE } from "./costing";
import { assertBusinessOperational } from "./operation-guard";

const contextSchema = z.object({ businessId: z.string().min(1), actorUserId: z.string().min(1) });
const startSchema = contextSchema.extend({ categoryId: z.string().min(1).optional() });
const countSchema = contextSchema.extend({ sessionId: z.string().min(1), variantId: z.string().min(1), countedQty: z.string().min(1).max(32), adjustmentReason: z.string().trim().max(500).optional() });

function quantityString(micros: bigint) {
  const sign = micros < 0n ? "-" : "";
  const absolute = micros < 0n ? -micros : micros;
  return `${sign}${absolute / QUANTITY_SCALE}.${(absolute % QUANTITY_SCALE).toString().padStart(6, "0")}`;
}

function toMicros(value: string) {
  const parsed = parseQuantityMicros(value);
  if (parsed < 0n) throw new CommercialError("La quantité doit être positive ou nulle.");
  return parsed;
}

async function requirePermission(db: CommercialDatabase, businessId: string, actorUserId: string, action: "read" | "count" | "validate") {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, businessId), eq(member.userId, actorUserId),
  )).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, "inventory", action)) {
    throw new CommercialError("Vous n’avez pas l’autorisation nécessaire pour cet inventaire.", 403);
  }
  return membership.role;
}

export async function listInventorySessions(db: CommercialDatabase, raw: unknown) {
  const input = contextSchema.parse(raw);
  await requirePermission(db, input.businessId, input.actorUserId, "read");
  const sessions = await db.select({
    id: inventorySession.id, status: inventorySession.status, createdAt: inventorySession.createdAt,
    submittedAt: inventorySession.submittedAt, validatedAt: inventorySession.validatedAt,
    categoryName: productCategory.name,
    scopeCount: inventorySession.id,
  }).from(inventorySession).leftJoin(productCategory, and(
    eq(productCategory.businessId, inventorySession.businessId), eq(productCategory.id, inventorySession.scopeCategoryId),
  )).where(eq(inventorySession.businessId, input.businessId)).orderBy(asc(inventorySession.createdAt)).limit(100);

  return Promise.all(sessions.map(async (session) => {
    const [scope, counted] = await Promise.all([
      db.select({ id: inventoryScopeVariant.variantId }).from(inventoryScopeVariant).where(and(
        eq(inventoryScopeVariant.businessId, input.businessId), eq(inventoryScopeVariant.sessionId, session.id),
      )),
      db.select({ id: inventoryLine.id }).from(inventoryLine).where(and(
        eq(inventoryLine.businessId, input.businessId), eq(inventoryLine.sessionId, session.id),
      )),
    ]);
    return { ...session, scopeCount: scope.length, countedCount: counted.length };
  }));
}

export async function listInventoryWorkspace(db: CommercialDatabase, raw: unknown) {
  const input = contextSchema.parse(raw);
  const [sessions, categories] = await Promise.all([
    listInventorySessions(db, input),
    db.select({ id: productCategory.id, name: productCategory.name }).from(productCategory)
      .where(and(eq(productCategory.businessId, input.businessId), isNull(productCategory.archivedAt))).orderBy(asc(productCategory.name)),
  ]);
  return { sessions, categories };
}

export async function startInventory(db: CommercialDatabase, raw: unknown) {
  const input = startSchema.parse(raw);
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(
      eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
    )).limit(1);
    if (!membership || !hasBusinessPermission(membership.role, "inventory", "count")) {
      throw new CommercialError("Vous n’avez pas l’autorisation de démarrer un inventaire.", 403);
    }
    await assertBusinessOperational(tx, input.businessId);
    if (input.categoryId) {
      const [category] = await tx.select({ id: productCategory.id }).from(productCategory).where(and(
        eq(productCategory.businessId, input.businessId), eq(productCategory.id, input.categoryId), isNull(productCategory.archivedAt),
      )).limit(1);
      if (!category) throw new CommercialError("Catégorie introuvable dans ce commerce.", 404);
    }
    const variants = await tx.select({ id: productVariant.id }).from(productVariant).innerJoin(product, and(
      eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId),
    )).where(and(
      eq(productVariant.businessId, input.businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt),
      ...(input.categoryId ? [eq(product.categoryId, input.categoryId)] : []),
    )).orderBy(asc(productVariant.id));
    if (!variants.length) throw new CommercialError("Aucun produit actif ne correspond à ce périmètre.", 422);

    await tx.insert(inventorySession).values({ id, businessId: input.businessId, status: "counting", startedByUserId: input.actorUserId, scopeCategoryId: input.categoryId ?? null });
    await tx.insert(inventoryScopeVariant).values(variants.map(({ id: variantId }) => ({ businessId: input.businessId, sessionId: id, variantId })));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId,
      eventType: "inventory.started", entityType: "inventory_session", entityId: id,
      metadata: { scope: input.categoryId ? "category" : "all", variantCount: variants.length } });
    return { id, status: "counting", scopeCount: variants.length };
  });
}

export async function getInventorySession(db: CommercialDatabase, raw: unknown) {
  const input = contextSchema.extend({ sessionId: z.string().min(1) }).parse(raw);
  await requirePermission(db, input.businessId, input.actorUserId, "read");
  const [session] = await db.select().from(inventorySession).where(and(
    eq(inventorySession.businessId, input.businessId), eq(inventorySession.id, input.sessionId),
  )).limit(1);
  if (!session) throw new CommercialError("Inventaire introuvable.", 404);
  const lines = await db.select({
    variantId: productVariant.id, productName: product.name, variantLabel: productVariant.label, baseUnit: product.baseUnit,
    currentQty: productVariant.onHand, countedQty: inventoryLine.countedQty, theoreticalQty: inventoryLine.theoreticalQty,
    countedAt: inventoryLine.countedAt, adjustmentReason: inventoryLine.adjustmentReason,
  }).from(inventoryScopeVariant).innerJoin(productVariant, and(
    eq(productVariant.businessId, inventoryScopeVariant.businessId), eq(productVariant.id, inventoryScopeVariant.variantId),
  )).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
    .leftJoin(inventoryLine, and(
      eq(inventoryLine.businessId, inventoryScopeVariant.businessId), eq(inventoryLine.sessionId, inventoryScopeVariant.sessionId), eq(inventoryLine.variantId, inventoryScopeVariant.variantId),
    )).where(and(eq(inventoryScopeVariant.businessId, input.businessId), eq(inventoryScopeVariant.sessionId, input.sessionId))).orderBy(asc(product.name));
  return { ...session, lines };
}

export async function recordInventoryCount(db: CommercialDatabase, raw: unknown) {
  const input = countSchema.parse(raw);
  const countedMicros = toMicros(input.countedQty);
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(
      eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
    )).limit(1);
    if (!membership || !hasBusinessPermission(membership.role, "inventory", "count")) throw new CommercialError("Vous n’avez pas l’autorisation de compter le stock.", 403);
    await assertBusinessOperational(tx, input.businessId);
    const [session] = await tx.select().from(inventorySession).where(and(
      eq(inventorySession.businessId, input.businessId), eq(inventorySession.id, input.sessionId),
    )).for("update").limit(1);
    if (!session) throw new CommercialError("Inventaire introuvable.", 404);
    if (session.status !== "counting") throw new CommercialError("Cet inventaire n’accepte plus de comptage.", 409);
    const [scope] = await tx.select({ variantId: inventoryScopeVariant.variantId }).from(inventoryScopeVariant).where(and(
      eq(inventoryScopeVariant.businessId, input.businessId), eq(inventoryScopeVariant.sessionId, input.sessionId), eq(inventoryScopeVariant.variantId, input.variantId),
    )).limit(1);
    if (!scope) throw new CommercialError("Ce produit ne fait pas partie de l’inventaire.", 404);
    const [variant] = await tx.select({ onHand: productVariant.onHand, revision: productVariant.stockRevision }).from(productVariant)
      .where(and(eq(productVariant.businessId, input.businessId), eq(productVariant.id, input.variantId))).for("update").limit(1);
    if (!variant) throw new CommercialError("Variante introuvable.", 404);
    const [existing] = await tx.select().from(inventoryLine).where(and(
      eq(inventoryLine.businessId, input.businessId), eq(inventoryLine.sessionId, input.sessionId), eq(inventoryLine.variantId, input.variantId),
    )).for("update").limit(1);
    const theoretical = existing ? toMicros(existing.theoreticalQty) : toMicros(variant.onHand);
    const reason = input.adjustmentReason?.trim() || null;
    if (countedMicros !== theoretical && !reason) throw new CommercialError("Indiquez le motif de chaque écart de stock.");
    if (existing) {
      await tx.update(inventoryLine).set({ countedQty: quantityString(countedMicros), countedByUserId: input.actorUserId, adjustmentReason: countedMicros === theoretical ? null : reason })
        .where(eq(inventoryLine.id, existing.id));
    } else {
      await tx.insert(inventoryLine).values({ id: randomUUID(), businessId: input.businessId, sessionId: input.sessionId, variantId: input.variantId,
        countedAt: new Date(), theoreticalQty: variant.onHand, countedQty: quantityString(countedMicros), expectedStockRevision: variant.revision,
        countedByUserId: input.actorUserId, adjustmentReason: countedMicros === theoretical ? null : reason });
    }
    return { saved: true, theoreticalQty: quantityString(theoretical), countedQty: quantityString(countedMicros), differenceQty: quantityString(countedMicros - theoretical) };
  });
}

export async function submitInventory(db: CommercialDatabase, raw: unknown) {
  const input = contextSchema.extend({ sessionId: z.string().min(1) }).parse(raw);
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId))).limit(1);
    if (!membership || !hasBusinessPermission(membership.role, "inventory", "count")) throw new CommercialError("Vous n’avez pas l’autorisation de soumettre cet inventaire.", 403);
    await assertBusinessOperational(tx, input.businessId);
    const [session] = await tx.select().from(inventorySession).where(and(eq(inventorySession.businessId, input.businessId), eq(inventorySession.id, input.sessionId))).for("update").limit(1);
    if (!session) throw new CommercialError("Inventaire introuvable.", 404);
    if (session.status !== "counting") throw new CommercialError("Cet inventaire n’est plus en cours de comptage.", 409);
    const scope = await tx.select({ variantId: inventoryScopeVariant.variantId }).from(inventoryScopeVariant).where(and(eq(inventoryScopeVariant.businessId, input.businessId), eq(inventoryScopeVariant.sessionId, input.sessionId)));
    const lines = await tx.select().from(inventoryLine).where(and(eq(inventoryLine.businessId, input.businessId), eq(inventoryLine.sessionId, input.sessionId)));
    if (!scope.length || lines.length !== scope.length) throw new CommercialError("Comptez chaque produit du périmètre avant de soumettre.", 422);
    if (lines.some((line) => toMicros(line.countedQty) !== toMicros(line.theoreticalQty) && !line.adjustmentReason?.trim())) {
      throw new CommercialError("Chaque écart doit avoir un motif avant validation.", 422);
    }
    const submittedAt = new Date();
    await tx.update(inventorySession).set({ status: "submitted", submittedAt, countedAt: submittedAt }).where(eq(inventorySession.id, input.sessionId));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId,
      eventType: "inventory.submitted", entityType: "inventory_session", entityId: input.sessionId, metadata: { lineCount: lines.length } });
    return { id: input.sessionId, status: "submitted", lineCount: lines.length };
  });
}

export async function validateInventory(db: CommercialDatabase, raw: unknown) {
  const input = contextSchema.extend({ sessionId: z.string().min(1) }).parse(raw);
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId))).limit(1);
    if (!membership || !hasBusinessPermission(membership.role, "inventory", "validate")) throw new CommercialError("Vous n’avez pas l’autorisation de valider cet inventaire.", 403);
    await assertBusinessOperational(tx, input.businessId);
    const [session] = await tx.select().from(inventorySession).where(and(eq(inventorySession.businessId, input.businessId), eq(inventorySession.id, input.sessionId))).for("update").limit(1);
    if (!session) throw new CommercialError("Inventaire introuvable.", 404);
    if (session.status === "validated") return { id: session.id, status: "validated", replayed: true };
    if (session.status !== "submitted") throw new CommercialError("Soumettez le comptage avant sa validation.", 409);
    const lines = await tx.select().from(inventoryLine).where(and(eq(inventoryLine.businessId, input.businessId), eq(inventoryLine.sessionId, input.sessionId))).orderBy(asc(inventoryLine.variantId));
    if (!lines.length) throw new CommercialError("Cet inventaire ne contient aucun comptage.", 422);
    if (lines.some((line) => line.countedByUserId === input.actorUserId)) throw new CommercialError("La validation doit être effectuée par une autre personne que le compteur.", 403);
    if (lines.some((line) => toMicros(line.countedQty) !== toMicros(line.theoreticalQty) && !line.adjustmentReason?.trim())) throw new CommercialError("Un écart sans motif empêche la validation.", 422);
    const variants = await tx.select().from(productVariant).where(and(
      eq(productVariant.businessId, input.businessId), inArray(productVariant.id, lines.map((line) => line.variantId)),
    )).orderBy(asc(productVariant.id)).for("update");
    if (variants.length !== lines.length) throw new CommercialError("Un produit de cet inventaire est introuvable.", 409);
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    let adjustedCount = 0;
    for (const line of lines) {
      const variant = byId.get(line.variantId);
      if (!variant) throw new CommercialError("Variante introuvable.", 409);
      const delta = toMicros(line.countedQty) - toMicros(line.theoreticalQty);
      if (delta === 0n) continue;
      const current = toMicros(variant.onHand);
      if (current + delta < 0n) throw new CommercialError("Les mouvements postérieurs ne permettent pas cet écart sans rendre le stock négatif. Recomptez ou faites une correction autorisée.", 409);
      await tx.update(productVariant).set({ onHand: quantityString(current + delta), stockRevision: variant.stockRevision + 1n })
        .where(and(eq(productVariant.businessId, input.businessId), eq(productVariant.id, variant.id)));
      await tx.insert(stockMovement).values({ id: randomUUID(), businessId: input.businessId, variantId: variant.id,
        quantityDelta: quantityString(delta), reason: "inventory_adjustment", inventoryLineId: line.id,
        unitCostXof: variant.averageCostXof, createdByUserId: input.actorUserId, occurredAt: new Date() });
      adjustedCount += 1;
    }
    const validatedAt = new Date();
    await tx.update(inventorySession).set({ status: "validated", validatedByUserId: input.actorUserId, validatedAt }).where(eq(inventorySession.id, input.sessionId));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId,
      eventType: "inventory.validated", entityType: "inventory_session", entityId: input.sessionId,
      metadata: { adjustedCount, lineCount: lines.length } });
    return { id: input.sessionId, status: "validated", adjustedCount, lineCount: lines.length, replayed: false };
  });
}
