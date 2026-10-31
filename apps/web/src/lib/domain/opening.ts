import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import {
  auditEvent, customer, member, openingBalance, openingBalancePayment, product, productVariant,
  stockMovement, stockOpening, stockOpeningLine, supplier,
} from "@/lib/db/schema";
import { parseQuantityMicros, QUANTITY_SCALE, UNIT_COST_SCALE } from "./costing";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { decodeCursor, encodeCursor, likePattern, pageLimit, productCursorSchema } from "./cursor";
import { idempotencyKeySchema, runIdempotent } from "./operation-guard";

type Context = { businessId: string; actorUserId: string };
const contextShape = { businessId: z.string().min(1), actorUserId: z.string().min(1) };
const xof = z.string().regex(/^(0|[1-9]\d{0,17})$/);
const quantity = z.string().regex(/^(0|[1-9]\d{0,17})(?:\.\d{1,6})?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const methods = ["cash", "wave", "orange_money", "mtn_momo", "other"] as const;

async function requirePermission(db: CommercialDatabase, context: Context, resource: Parameters<typeof hasBusinessPermission>[1], action: string) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId))).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, resource, action)) {
    throw new CommercialError("Vous n’avez pas l’autorisation d’effectuer cette opération.", 403);
  }
}

/** Jour civil d'Abidjan (UTC+0, sans heure d'été). */
export function abidjanToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Une date de référence d'ouverture est un vrai jour calendaire, ni futur ni antérieur à 2000. */
export function assertReferenceDate(value: string, now = new Date()) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new CommercialError("La date de référence est invalide.");
  if (value > abidjanToday(now)) throw new CommercialError("La date de référence ne peut pas être dans le futur.");
  if (value < "2000-01-01") throw new CommercialError("La date de référence est trop ancienne.");
}

const formatMicros = (value: bigint) => `${value / QUANTITY_SCALE}.${(value % QUANTITY_SCALE).toString().padStart(6, "0")}`;
const formatCost = (value: bigint) => `${value / UNIT_COST_SCALE}.${(value % UNIT_COST_SCALE).toString().padStart(12, "0")}`;

/* ------------------------------------------------------------------ Stock d'ouverture */

/**
 * Une variante peut recevoir un stock d'ouverture seulement si elle n'a encore aucun mouvement,
 * aucune ligne d'ouverture et un stock à zéro. Après la première vente, réception ou inventaire,
 * toute correction passe par un inventaire (mouvement supplémentaire traçable).
 */
const eligibleVariant = (businessId: string): SQL[] => [
  eq(productVariant.businessId, businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt), sql`${productVariant.onHand} = 0`,
  sql`not exists (select 1 from stock_movement m where m.business_id = ${productVariant.businessId} and m.variant_id = ${productVariant.id})`,
  sql`not exists (select 1 from stock_opening_line l where l.business_id = ${productVariant.businessId} and l.variant_id = ${productVariant.id})`,
];

export async function listOpeningCandidates(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "inventory", "adjust");
  const input = z.object({ q: z.string().trim().max(120).optional(), cursor: z.string().max(512).optional(), limit: z.union([z.string(), z.number()]).optional() }).parse(raw);
  const limit = pageLimit(input.limit, 20);
  const cursor = decodeCursor(input.cursor, productCursorSchema);
  const conditions = eligibleVariant(context.businessId);
  if (input.q) {
    const pattern = likePattern(input.q);
    conditions.push(sql`(${product.name} ilike ${pattern} or ${productVariant.sku} ilike ${pattern} or ${productVariant.label} ilike ${pattern})`);
  }
  if (cursor) conditions.push(or(gt(product.name, cursor.name), and(eq(product.name, cursor.name), gt(productVariant.id, cursor.id)))!);
  const [rows, openedRows, recent] = await Promise.all([
    db.select({ variantId: productVariant.id, name: product.name, variantLabel: productVariant.label, sku: productVariant.sku, baseUnit: product.baseUnit })
      .from(productVariant).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(...conditions)).orderBy(asc(product.name), asc(productVariant.id)).limit(limit + 1),
    db.select({ count: sql<string>`count(*)::text` }).from(stockOpeningLine).where(eq(stockOpeningLine.businessId, context.businessId)),
    db.select({ id: stockOpening.id, referenceDate: stockOpening.referenceDate, postedAt: stockOpening.postedAt, note: stockOpening.note,
      // Colonnes qualifiées à la main : sur une requête à une seule table, Drizzle ne préfixe pas le nom de table
      // et `business_id`/`id` seraient lus dans la sous-requête elle-même.
      lineCount: sql<string>`(select count(*) from stock_opening_line l where l.business_id = "stock_opening"."business_id" and l.opening_id = "stock_opening"."id")::text` })
      .from(stockOpening).where(eq(stockOpening.businessId, context.businessId)).orderBy(desc(stockOpening.postedAt)).limit(5),
  ]);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ name: last.name, id: last.variantId }) : null,
    openedCount: Number(openedRows[0]?.count ?? 0), recentOpenings: recent.map((row) => ({ ...row, postedAt: row.postedAt.toISOString(), lineCount: Number(row.lineCount) })) };
}

const openingInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, referenceDate: isoDate, note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({ variantId: z.string().min(1).max(100), quantity, unitCostXof: xof.optional() })).min(1).max(200) });

export async function postStockOpening(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = openingInput.parse(raw);
  assertReferenceDate(input.referenceDate, now);
  await requirePermission(db, input, "inventory", "adjust");
  const ids = input.lines.map((line) => line.variantId);
  if (new Set(ids).size !== ids.length) throw new CommercialError("Un produit ne peut apparaître qu’une fois dans le stock d’ouverture.");
  if (input.lines.some((line) => parseQuantityMicros(line.quantity) <= 0n)) throw new CommercialError("Chaque quantité de départ doit être supérieure à zéro.");
  const request = { referenceDate: input.referenceDate, note: input.note ?? null,
    lines: input.lines.map((line) => ({ variantId: line.variantId, quantityMicros: parseQuantityMicros(line.quantity).toString(), unitCostXof: line.unitCostXof ?? null })) };
  const id = randomUUID();
  return runIdempotent(db, { ...input, operation: "stock.opening", request }, async (tx) => {
    const sorted = [...ids].sort();
    const variants = await tx.select({ id: productVariant.id, onHand: productVariant.onHand, stockRevision: productVariant.stockRevision })
      .from(productVariant).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(eq(productVariant.businessId, input.businessId), inArray(productVariant.id, sorted), isNull(productVariant.archivedAt), isNull(product.archivedAt)))
      .orderBy(asc(productVariant.id)).for("update", { of: productVariant });
    if (variants.length !== sorted.length) throw new CommercialError("Un produit du stock d’ouverture est introuvable dans ce commerce.", 404);
    const [activity] = await tx.select({ count: sql<string>`count(*)::text` }).from(stockMovement)
      .where(and(eq(stockMovement.businessId, input.businessId), inArray(stockMovement.variantId, sorted)));
    const [opened] = await tx.select({ count: sql<string>`count(*)::text` }).from(stockOpeningLine)
      .where(and(eq(stockOpeningLine.businessId, input.businessId), inArray(stockOpeningLine.variantId, sorted)));
    if (Number(activity?.count ?? 0) > 0 || Number(opened?.count ?? 0) > 0 || variants.some((variant) => parseQuantityMicros(variant.onHand) !== 0n)) {
      throw new CommercialError("Un produit a déjà un stock ou des mouvements : utilisez un inventaire pour le corriger.", 409);
    }
    const occurredAt = new Date(`${input.referenceDate}T00:00:00Z`);
    await tx.insert(stockOpening).values({ id, businessId: input.businessId, referenceDate: input.referenceDate, note: input.note || null, postedByUserId: input.actorUserId });
    for (const line of input.lines) {
      const variant = variants.find((row) => row.id === line.variantId)!;
      const micros = parseQuantityMicros(line.quantity);
      const lineId = randomUUID();
      const cost = line.unitCostXof !== undefined ? BigInt(line.unitCostXof) : null;
      await tx.insert(stockOpeningLine).values({ id: lineId, businessId: input.businessId, openingId: id, variantId: line.variantId, quantity: formatMicros(micros), unitCostXof: cost });
      // Coût inconnu : on ne l'invente pas, le coût moyen reste « non renseigné ».
      await tx.update(productVariant).set({ onHand: formatMicros(micros), stockRevision: variant.stockRevision + 1n,
        ...(cost !== null ? { averageCostXof: formatCost(cost * UNIT_COST_SCALE), costKnown: true } : {}) })
        .where(and(eq(productVariant.businessId, input.businessId), eq(productVariant.id, line.variantId)));
      await tx.insert(stockMovement).values({ id: randomUUID(), businessId: input.businessId, variantId: line.variantId, quantityDelta: formatMicros(micros),
        reason: "opening_stock", openingLineId: lineId, unitCostXof: cost !== null ? formatCost(cost * UNIT_COST_SCALE) : null, createdByUserId: input.actorUserId, occurredAt });
    }
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "stock.opening_posted",
      entityType: "stock_opening", entityId: id, metadata: { lineCount: input.lines.length, referenceDate: input.referenceDate } });
    return { id, lineCount: input.lines.length, referenceDate: input.referenceDate };
  });
}

/* ------------------------------------------------------------------ Soldes d'ouverture */

const partyType = z.enum(["customer", "supplier"]);
type PartyType = z.infer<typeof partyType>;
const readPermission: Record<PartyType, [Parameters<typeof hasBusinessPermission>[1], string]> = { customer: ["customer", "read"], supplier: ["supplier", "read"] };
// Créer une dette d'ouverture modifie la situation financière : réservé à qui peut modifier la fiche.
const createPermission: Record<PartyType, [Parameters<typeof hasBusinessPermission>[1], string]> = { customer: ["customer", "update"], supplier: ["supplier", "update"] };
// Encaisser un client relève des paiements ; payer un fournisseur relève des achats.
const paymentPermission: Record<PartyType, [Parameters<typeof hasBusinessPermission>[1], string]> = { customer: ["payment", "record"], supplier: ["purchase", "create"] };

const paidSubquery = sql<string>`coalesce((select sum(p.amount_xof) from opening_balance_payment p where p.business_id = ${openingBalance.businessId} and p.opening_balance_id = ${openingBalance.id}), 0)`;

export async function listOpeningBalances(db: CommercialDatabase, context: Context, raw: unknown) {
  const input = z.object({ partyType }).parse(raw);
  await requirePermission(db, context, ...readPermission[input.partyType]);
  const party = input.partyType === "customer" ? customer : supplier;
  const partyColumn = input.partyType === "customer" ? openingBalance.customerId : openingBalance.supplierId;
  const archived = input.partyType === "customer" ? sql`true` : isNull(supplier.archivedAt);
  const rows = await db.select({ partyId: party.id, name: party.name, phone: party.phone,
    balanceId: openingBalance.id, amountXof: sql<string | null>`${openingBalance.amountXof}::text`, asOfDate: openingBalance.asOfDate, note: openingBalance.note,
    paidXof: sql<string | null>`case when ${openingBalance.id} is null then null else (${paidSubquery})::text end` })
    .from(party).leftJoin(openingBalance, and(eq(openingBalance.businessId, party.businessId), eq(partyColumn, party.id)))
    .where(and(eq(party.businessId, context.businessId), archived)).orderBy(asc(party.name), asc(party.id)).limit(500);
  return { parties: rows.map((row) => ({ ...row, remainingXof: row.amountXof === null ? null : (BigInt(row.amountXof) - BigInt(row.paidXof ?? "0")).toString() })) };
}

const balanceInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, partyType, partyId: z.string().min(1).max(100),
  amountXof: xof, asOfDate: isoDate, note: z.string().trim().max(500).optional() });

export async function createOpeningBalance(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = balanceInput.parse(raw);
  if (BigInt(input.amountXof) <= 0n) throw new CommercialError("Le montant dû doit être supérieur à zéro.");
  assertReferenceDate(input.asOfDate, now);
  await requirePermission(db, input, ...createPermission[input.partyType]);
  const id = randomUUID();
  const request = { partyType: input.partyType, partyId: input.partyId, amountXof: input.amountXof, asOfDate: input.asOfDate, note: input.note ?? null };
  return runIdempotent(db, { ...input, operation: "opening_balance.create", request }, async (tx) => {
    const isCustomer = input.partyType === "customer";
    const [party] = isCustomer
      ? await tx.select({ id: customer.id }).from(customer).where(and(eq(customer.businessId, input.businessId), eq(customer.id, input.partyId))).limit(1)
      : await tx.select({ id: supplier.id }).from(supplier).where(and(eq(supplier.businessId, input.businessId), eq(supplier.id, input.partyId), isNull(supplier.archivedAt))).limit(1);
    if (!party) throw new CommercialError(isCustomer ? "Client introuvable dans ce commerce." : "Fournisseur introuvable dans ce commerce.", 404);
    const [existing] = await tx.select({ id: openingBalance.id }).from(openingBalance).where(and(eq(openingBalance.businessId, input.businessId),
      isCustomer ? eq(openingBalance.customerId, input.partyId) : eq(openingBalance.supplierId, input.partyId))).limit(1);
    if (existing) throw new CommercialError(isCustomer ? "Ce client a déjà un solde d’ouverture." : "Ce fournisseur a déjà un solde d’ouverture.", 409);
    await tx.insert(openingBalance).values({ id, businessId: input.businessId, partyType: input.partyType, customerId: isCustomer ? input.partyId : null,
      supplierId: isCustomer ? null : input.partyId, amountXof: BigInt(input.amountXof), asOfDate: input.asOfDate, note: input.note || null, createdByUserId: input.actorUserId });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "opening_balance.created",
      entityType: isCustomer ? "customer" : "supplier", entityId: input.partyId, metadata: { amountXof: input.amountXof, asOfDate: input.asOfDate } });
    return { id, amountXof: input.amountXof, remainingXof: input.amountXof };
  });
}

const paymentInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, openingBalanceId: z.string().min(1).max(100), amountXof: xof, method: z.enum(methods) });

export async function recordOpeningBalancePayment(db: CommercialDatabase, raw: unknown) {
  const input = paymentInput.parse(raw);
  const amount = BigInt(input.amountXof);
  if (amount <= 0n) throw new CommercialError("Le montant du règlement doit être supérieur à zéro.");
  const [balance] = await db.select({ partyType: openingBalance.partyType }).from(openingBalance)
    .where(and(eq(openingBalance.businessId, input.businessId), eq(openingBalance.id, input.openingBalanceId))).limit(1);
  if (!balance) throw new CommercialError("Solde d’ouverture introuvable.", 404);
  await requirePermission(db, input, ...paymentPermission[balance.partyType as PartyType]);
  const request = { openingBalanceId: input.openingBalanceId, amountXof: input.amountXof, method: input.method };
  return runIdempotent(db, { ...input, operation: "opening_balance.payment", request }, async (tx) => {
    const [locked] = await tx.select().from(openingBalance).where(and(eq(openingBalance.businessId, input.businessId), eq(openingBalance.id, input.openingBalanceId))).for("update").limit(1);
    if (!locked) throw new CommercialError("Solde d’ouverture introuvable.", 404);
    const [paid] = await tx.select({ total: sql<string>`coalesce(sum(${openingBalancePayment.amountXof}),0)::text` }).from(openingBalancePayment)
      .where(and(eq(openingBalancePayment.businessId, input.businessId), eq(openingBalancePayment.openingBalanceId, input.openingBalanceId)));
    const remaining = locked.amountXof - BigInt(paid?.total ?? "0");
    if (amount > remaining) throw new CommercialError("Le règlement dépasse le solde restant dû.", 409);
    await tx.insert(openingBalancePayment).values({ id: randomUUID(), businessId: input.businessId, openingBalanceId: input.openingBalanceId,
      amountXof: amount, method: input.method, recordedByUserId: input.actorUserId });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "opening_balance.payment_recorded",
      entityType: "opening_balance", entityId: input.openingBalanceId, metadata: { amountXof: input.amountXof, method: input.method } });
    return { remainingXof: (remaining - amount).toString() };
  });
}
