import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { costOfGoodsSold, parseQuantityMicros, QUANTITY_SCALE } from "./costing";
import { assertBusinessOperational } from "./operation-guard";
import { databaseSchema, member, product, productCategory, productVariant, sale, saleLine, payment, stockMovement, auditEvent } from "../db/schema";
import { assertPlanQuota } from "./plan-limits";

export type CommercialDatabase = PgDatabase<PgQueryResultHKT, typeof databaseSchema>;

export class CommercialError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "CommercialError";
  }
}

const productInputSchema = z.object({
  businessId: z.string().min(1), actorUserId: z.string().min(1),
  name: z.string().trim().min(1).max(160), categoryId: z.string().min(1).optional(),
  description: z.string().trim().max(2000).optional(), baseUnit: z.string().trim().min(1).max(32).default("piece"),
  variantLabel: z.string().trim().min(1).max(100).default("Standard"),
  salePriceXof: z.string().regex(/^(0|[1-9]\d{0,17})$/), sku: z.string().trim().max(100).optional(),
});

export async function createProduct(db: CommercialDatabase, rawInput: unknown) {
  const input = productInputSchema.parse(rawInput);
  const id = randomUUID();
  const variantId = randomUUID();

  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(
      eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
    )).limit(1);
    if (!membership) throw new CommercialError("Aucun accès à ce commerce.", 403);
    if (!hasBusinessPermission(membership.role, "product", "create")) throw new CommercialError("Permission de création de produit refusée.", 403);
    await assertBusinessOperational(tx, input.businessId);
    await assertPlanQuota(tx, input.businessId, "products");

    if (input.categoryId) {
      const [category] = await tx.select({ id: productCategory.id }).from(productCategory).where(and(
        eq(productCategory.businessId, input.businessId), eq(productCategory.id, input.categoryId), isNull(productCategory.archivedAt),
      )).limit(1);
      if (!category) throw new CommercialError("Catégorie introuvable dans ce commerce.", 404);
    }

    await tx.insert(product).values({
      id, businessId: input.businessId, categoryId: input.categoryId ?? null,
      name: input.name, description: input.description ?? null, baseUnit: input.baseUnit,
    });
    await tx.insert(productVariant).values({
      id: variantId, businessId: input.businessId, productId: id, label: input.variantLabel,
      sku: input.sku || null, salePriceXof: BigInt(input.salePriceXof), onHand: "0", averageCostXof: "0",
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId,
      eventType: "product.created", entityType: "product", entityId: id, metadata: {},
    });
    return { id, variantId };
  });
}

export async function listProducts(db: CommercialDatabase, input: { businessId: string; actorUserId: string }) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
  )).limit(1);
  if (!membership) throw new CommercialError("Aucun accès à ce commerce.", 403);
  if (!hasBusinessPermission(membership.role, "product", "read")) throw new CommercialError("Permission de lecture des produits refusée.", 403);

  return db.select({
    id: product.id, name: product.name, categoryId: product.categoryId, baseUnit: product.baseUnit,
    variantId: productVariant.id, variantLabel: productVariant.label, sku: productVariant.sku,
    salePriceXof: productVariant.salePriceXof, onHand: productVariant.onHand,
  }).from(product).innerJoin(productVariant, and(
    eq(productVariant.businessId, product.businessId), eq(productVariant.productId, product.id),
  )).where(and(eq(product.businessId, input.businessId), isNull(product.archivedAt), isNull(productVariant.archivedAt)))
    .orderBy(asc(product.name));
}

const paymentMethods = ["cash", "wave", "orange_money", "mtn_momo", "other"] as const;
const saleInputSchema = z.object({
  businessId: z.string().min(1), actorUserId: z.string().min(1), idempotencyKey: z.string().min(8).max(128),
  customerId: z.string().min(1).optional(),
  lines: z.array(z.object({ variantId: z.string().min(1), quantity: z.string().min(1).max(32) })).min(1).max(100),
  payments: z.array(z.object({ method: z.enum(paymentMethods), amountXof: z.string().regex(/^[1-9]\d{0,17}$/) })).max(20).default([]),
});

type SaleInput = z.infer<typeof saleInputSchema>;
type SaleResult = { id: string; reference: string; subtotalXof: bigint; totalXof: bigint; paidXof: bigint; dueXof: bigint; replayed: boolean };

function parseScaledDecimal(value: string, scale: number): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > scale) throw new CommercialError("Valeur décimale invalide renvoyée par le stockage.", 500);
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] ?? "").padEnd(scale, "0") || "0");
}

function totalForLine(priceXof: bigint, quantityMicros: bigint): bigint {
  return (priceXof * quantityMicros + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}

function formatQuantity(micros: bigint): string {
  return `${micros / QUANTITY_SCALE}.${(micros % QUANTITY_SCALE).toString().padStart(6, "0")}`;
}

async function assertCanCreateSale(db: CommercialDatabase, businessId: string, actorUserId: string) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, businessId), eq(member.userId, actorUserId),
  )).limit(1);
  if (!membership) throw new CommercialError("Aucun accès à ce commerce.", 403);
  if (!hasBusinessPermission(membership.role, "sale", "create")) throw new CommercialError("Permission d’enregistrer une vente refusée.", 403);
}

async function findIdempotentSale(db: CommercialDatabase, input: SaleInput): Promise<SaleResult | undefined> {
  const [existing] = await db.select().from(sale).where(and(
    eq(sale.businessId, input.businessId), eq(sale.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (!existing) return undefined;
  const savedLines = await db.select().from(saleLine).where(and(eq(saleLine.businessId, input.businessId), eq(saleLine.saleId, existing.id)));
  const savedPayments = await db.select().from(payment).where(and(eq(payment.businessId, input.businessId), eq(payment.saleId, existing.id)));
  const normalizedLines = input.lines.map((line) => `${line.variantId}:${parseQuantityMicros(line.quantity)}`).sort();
  const storedLines = savedLines.map((line) => `${line.variantId}:${parseQuantityMicros(line.quantity)}`).sort();
  const normalizedPayments = input.payments.map((part) => `${part.method}:${BigInt(part.amountXof)}`).sort();
  const storedPayments = savedPayments.map((part) => `${part.method}:${part.amountXof}`).sort();
  if (normalizedLines.join("|") !== storedLines.join("|") || normalizedPayments.join("|") !== storedPayments.join("|") || (input.customerId ?? null) !== existing.customerId) {
    throw new CommercialError("Cette clé d’idempotence a déjà été utilisée pour une requête différente.", 409);
  }
  const paidXof = savedPayments.filter((part) => part.status === "confirmed").reduce((total, part) => total + part.amountXof, 0n);
  return { id: existing.id, reference: existing.reference, subtotalXof: existing.subtotalXof, totalXof: existing.totalXof, paidXof, dueXof: existing.totalXof - paidXof, replayed: true };
}

export async function createSale(db: CommercialDatabase, rawInput: unknown): Promise<SaleResult> {
  const input = saleInputSchema.parse(rawInput);
  await assertCanCreateSale(db, input.businessId, input.actorUserId);
  const replay = await findIdempotentSale(db, input);
  if (replay) return replay;
  const parsedLines = input.lines.map((line) => ({ ...line, quantityMicros: parseQuantityMicros(line.quantity) }));
  if (parsedLines.some((line) => line.quantityMicros <= 0n)) throw new CommercialError("Chaque quantité doit être supérieure à zéro.");
  const paymentTotal = input.payments.reduce((total, part) => total + BigInt(part.amountXof), 0n);
  const confirmedTotal = input.payments.filter((part) => part.method === "cash").reduce((total, part) => total + BigInt(part.amountXof), 0n);
  let result: SaleResult;

  try {
    result = await db.transaction(async (tx) => {
      const [membership] = await tx.select({ role: member.role }).from(member).where(and(
        eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
      )).limit(1);
      if (!membership) throw new CommercialError("Aucun accès à ce commerce.", 403);
      if (!hasBusinessPermission(membership.role, "sale", "create")) throw new CommercialError("Permission d’enregistrer une vente refusée.", 403);
      await assertBusinessOperational(tx, input.businessId);

      const requestedVariantIds = [...new Set(parsedLines.map((line) => line.variantId))].sort();
      if (requestedVariantIds.length !== parsedLines.length) throw new CommercialError("Une variante ne peut apparaître qu’une fois dans la vente.");
      const variants = await tx.select({ variant: productVariant, productName: product.name }).from(productVariant)
        .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
        .where(and(eq(productVariant.businessId, input.businessId), inArray(productVariant.id, requestedVariantIds), isNull(productVariant.archivedAt), isNull(product.archivedAt)))
        .orderBy(asc(productVariant.id)).for("update");
      if (variants.length !== requestedVariantIds.length) throw new CommercialError("Un ou plusieurs produits sont introuvables dans ce commerce.", 404);

      const lines = parsedLines.map((requestLine) => {
        const row = variants.find(({ variant }) => variant.id === requestLine.variantId);
        if (!row) throw new CommercialError("Variante introuvable.", 404);
        const onHandMicros = parseQuantityMicros(row.variant.onHand);
        if (requestLine.quantityMicros > onHandMicros) throw new CommercialError(`Stock insuffisant pour ${row.productName}.`, 409);
        const amount = totalForLine(row.variant.salePriceXof, requestLine.quantityMicros);
        const cogs = costOfGoodsSold(requestLine.quantityMicros, parseScaledDecimal(row.variant.averageCostXof, 12));
        return { ...requestLine, row, amount, cogs };
      });
      const subtotal = lines.reduce((sum, line) => sum + line.amount, 0n);
      if (paymentTotal > subtotal) throw new CommercialError("Le montant encaissé dépasse le total de la vente.");
      if (confirmedTotal < subtotal && !input.customerId) throw new CommercialError("Associez un client à toute vente avec un solde restant dû ou un paiement mobile en attente.");

      const saleId = randomUUID();
      const reference = `V-${Date.now().toString(36).toUpperCase()}-${saleId.slice(0, 8).toUpperCase()}`;
      await tx.insert(sale).values({ id: saleId, businessId: input.businessId, reference, idempotencyKey: input.idempotencyKey,
        cashierUserId: input.actorUserId, customerId: input.customerId ?? null, subtotalXof: subtotal, totalXof: subtotal, discountXof: 0n });

      for (const line of lines) {
        const lineId = randomUUID();
        await tx.insert(saleLine).values({ id: lineId, businessId: input.businessId, saleId, variantId: line.row.variant.id,
          productNameSnapshot: line.row.productName, variantSnapshot: line.row.variant.label, quantity: line.quantity,
          unitPriceXof: line.row.variant.salePriceXof, lineDiscountXof: 0n, lineTotalXof: line.amount,
          unitCostSnapshotXof: line.row.variant.averageCostXof, cogsXof: line.cogs, costAvailable: line.row.variant.costKnown });
        await tx.update(productVariant).set({ onHand: formatQuantity(parseQuantityMicros(line.row.variant.onHand) - line.quantityMicros), stockRevision: line.row.variant.stockRevision + 1n })
          .where(and(eq(productVariant.businessId, input.businessId), eq(productVariant.id, line.row.variant.id)));
        await tx.insert(stockMovement).values({ id: randomUUID(), businessId: input.businessId, variantId: line.row.variant.id,
          quantityDelta: `-${line.quantity}`, reason: "sale", saleLineId: lineId, unitCostXof: line.row.variant.averageCostXof, createdByUserId: input.actorUserId });
      }
      for (const [index, part] of input.payments.entries()) {
        await tx.insert(payment).values({ id: randomUUID(), businessId: input.businessId, saleId, method: part.method,
          amountXof: BigInt(part.amountXof), status: part.method === "cash" ? "confirmed" : "pending", recordedByUserId: input.actorUserId,
          idempotencyKey: `${input.idempotencyKey}:${index}`, confirmedAt: part.method === "cash" ? new Date() : null });
      }
      await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId,
        eventType: "sale.created", entityType: "sale", entityId: saleId, metadata: { lineCount: lines.length, paymentPartCount: input.payments.length } });
      return { id: saleId, reference, subtotalXof: subtotal, totalXof: subtotal, paidXof: confirmedTotal,
        dueXof: subtotal - confirmedTotal, replayed: false };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      await assertCanCreateSale(db, input.businessId, input.actorUserId);
      const replay = await findIdempotentSale(db, input);
      if (replay) return replay;
    }
    throw error;
  }
  return result;
}
