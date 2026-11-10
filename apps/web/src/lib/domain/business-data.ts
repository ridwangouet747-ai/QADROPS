import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import {
  auditEvent, businessProfile, customer, expense, member, organization,
  payment, paymentRefund, product, productCategory, productVariant, purchase, purchaseLine, purchasePayment,
  receiptSettings, receivablePayment, sale, saleLine, stockMovement, supplier,
} from "@/lib/db/schema";
import { parseQuantityMicros, QUANTITY_SCALE, UNIT_COST_SCALE, weightedAverageCost } from "./costing";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { assertValidTimezone, getDashboardReports } from "./reports";
import { assertBusinessOperational, idempotencyKeySchema, runIdempotent } from "./operation-guard";
import { attachOpenCashSession } from "./cash-session";
import { decodeCursor, encodeCursor, movementCursorSchema, pageLimit, productCursorSchema } from "./cursor";

type Context = { businessId: string; actorUserId: string };

async function requirePermission(db: CommercialDatabase, context: Context, resource: Parameters<typeof hasBusinessPermission>[1], action: string) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId),
  )).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, resource, action)) {
    throw new CommercialError("Vous n’avez pas l’autorisation d’effectuer cette opération.", 403);
  }
  return membership.role;
}

const formatMicros = (value: bigint) => `${value / QUANTITY_SCALE}.${(value % QUANTITY_SCALE).toString().padStart(6, "0")}`;
const formatCost = (value: bigint) => `${value / UNIT_COST_SCALE}.${(value % UNIT_COST_SCALE).toString().padStart(12, "0")}`;
const xof = z.string().regex(/^(0|[1-9]\d{0,17})$/);
const quantity = z.string().regex(/^(0|[1-9]\d{0,17})(?:\.\d{1,6})?$/);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Date commerciale (AAAA-MM-JJ) dans le fuseau du commerce, la même règle que `reportRange` (docs/engineering/fuseaux-horaires.md). */
function businessDate(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Tableau de bord : 7 requêtes et au plus 4 simultanées (mission 11, phase 6). Auparavant, deux rapports
 * complets et les listes partaient ensemble, soit une trentaine de requêtes en même temps sur le pool.
 * - 1 lecture : permission `report:read` et identité du commerce (dont son fuseau) ;
 * - 3 en parallèle : chiffres de base des quatre périodes, résumé du jour, résumé de la semaine ;
 * - pendant ce temps, les trois listes l'une après l'autre.
 */
export async function getBusinessOverview(db: CommercialDatabase, context: Context) {
  const [identity] = await db.select({ role: member.role, name: organization.name, logo: organization.logo, activity: businessProfile.activity,
    phone: businessProfile.phone, timezone: businessProfile.timezone })
    .from(member).innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(businessProfile, eq(businessProfile.businessId, member.organizationId))
    .where(and(eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId))).limit(1);
  if (!identity || !hasBusinessPermission(identity.role, "report", "read")) {
    throw new CommercialError("Vous n’avez pas l’autorisation d’effectuer cette opération.", 403);
  }
  if (!identity.timezone || !identity.activity) throw new CommercialError("Commerce introuvable.", 404);
  const today = businessDate(assertValidTimezone(identity.timezone));
  const lists = async () => {
    const recentSales = await db.select({ id: sale.id, reference: sale.reference, status: sale.status, totalXof: sale.totalXof, occurredAt: sale.occurredAt,
      customerName: customer.name, paidXof: sql<string>`coalesce(sum(case when ${payment.status} = 'confirmed' then ${payment.amountXof} else 0 end),0)::text` })
      .from(sale).leftJoin(customer, and(eq(customer.businessId, sale.businessId), eq(customer.id, sale.customerId)))
      .leftJoin(payment, and(eq(payment.businessId, sale.businessId), eq(payment.saleId, sale.id)))
      .where(and(eq(sale.businessId, context.businessId), sql`${sale.status} <> 'voided'`))
      .groupBy(sale.id, customer.name).orderBy(desc(sale.occurredAt)).limit(6);
    const lowStock = await db.select({ productId: product.id, name: product.name, variantId: productVariant.id, variant: productVariant.label,
      sku: productVariant.sku, onHand: productVariant.onHand, threshold: productVariant.lowStockThreshold })
      .from(productVariant).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(eq(productVariant.businessId, context.businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt),
        sql`${productVariant.lowStockThreshold} > 0 and ${productVariant.onHand} <= ${productVariant.lowStockThreshold}`))
      .orderBy(asc(productVariant.onHand), asc(product.name)).limit(8);
    const recentActivity = await db.select({ id: auditEvent.id, eventType: auditEvent.eventType, entityType: auditEvent.entityType, occurredAt: auditEvent.occurredAt })
      .from(auditEvent).where(eq(auditEvent.businessId, context.businessId)).orderBy(desc(auditEvent.occurredAt)).limit(5);
    return { recentSales, lowStock, recentActivity };
  };
  const [reports, { recentSales, lowStock, recentActivity }] = await Promise.all([
    getDashboardReports(db, { ...context, timezone: identity.timezone, date: today }),
    lists(),
  ]);
  const { name, logo, activity, phone, timezone } = identity;
  return { business: { name, logo, activity, phone, timezone }, date: today, today: reports.today, week: reports.week,
    recentSales, lowStock, recentActivity };
}

export async function listBusinessProducts(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "product", "read");
  const [products, categories] = await Promise.all([
    db.select({ id: product.id, name: product.name, description: product.description, categoryId: product.categoryId,
      categoryName: productCategory.name, baseUnit: product.baseUnit, archivedAt: product.archivedAt,
      variantId: productVariant.id, variantLabel: productVariant.label, sku: productVariant.sku,
      salePriceXof: productVariant.salePriceXof, onHand: productVariant.onHand, averageCostXof: productVariant.averageCostXof,
      costKnown: productVariant.costKnown, lowStockThreshold: productVariant.lowStockThreshold })
      .from(product).innerJoin(productVariant, and(eq(productVariant.businessId, product.businessId), eq(productVariant.productId, product.id)))
      .leftJoin(productCategory, and(eq(productCategory.businessId, product.businessId), eq(productCategory.id, product.categoryId)))
      .where(and(eq(product.businessId, context.businessId), isNull(product.archivedAt), isNull(productVariant.archivedAt))).orderBy(asc(product.name)),
    db.select({ id: productCategory.id, name: productCategory.name }).from(productCategory)
      .where(and(eq(productCategory.businessId, context.businessId), isNull(productCategory.archivedAt))).orderBy(asc(productCategory.name)),
  ]);
  return { products, categories };
}

export async function createCategory(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, name: z.string().trim().min(1).max(80) }).parse(raw);
  await requirePermission(db, input, "product", "create");
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await assertBusinessOperational(tx, input.businessId);
    await tx.insert(productCategory).values({ id, businessId: input.businessId, name: input.name });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "product_category.created", entityType: "product_category", entityId: id, metadata: {} });
  });
  return { id, name: input.name };
}

const contextShape = { businessId: z.string().min(1), actorUserId: z.string().min(1) };

export async function updateBusinessProduct(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, productId: z.string().min(1), variantId: z.string().min(1),
    name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable(), categoryId: z.string().nullable(),
    variantLabel: z.string().trim().min(1).max(100), sku: z.string().trim().max(100).nullable(), salePriceXof: xof, lowStockThreshold: quantity,
  }).parse(raw);
  await requirePermission(db, input, "product", "update");
  return db.transaction(async (tx) => {
    await assertBusinessOperational(tx, input.businessId);
    if (input.categoryId) {
      const [category] = await tx.select({ id: productCategory.id }).from(productCategory).where(and(
        eq(productCategory.businessId, input.businessId), eq(productCategory.id, input.categoryId), isNull(productCategory.archivedAt),
      )).limit(1);
      if (!category) throw new CommercialError("Catégorie introuvable dans ce commerce.", 404);
    }
    const [existing] = await tx.select({ id: product.id }).from(product).innerJoin(productVariant, and(
      eq(productVariant.businessId, product.businessId), eq(productVariant.productId, product.id),
    )).where(and(eq(product.businessId, input.businessId), eq(product.id, input.productId), eq(productVariant.id, input.variantId), isNull(product.archivedAt))).limit(1);
    if (!existing) throw new CommercialError("Produit introuvable dans ce commerce.", 404);
    await tx.update(product).set({ name: input.name, description: input.description, categoryId: input.categoryId, updatedAt: new Date() })
      .where(and(eq(product.businessId, input.businessId), eq(product.id, input.productId)));
    await tx.update(productVariant).set({ label: input.variantLabel, sku: input.sku, salePriceXof: BigInt(input.salePriceXof), lowStockThreshold: input.lowStockThreshold })
      .where(and(eq(productVariant.businessId, input.businessId), eq(productVariant.id, input.variantId)));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "product.updated", entityType: "product", entityId: input.productId, metadata: {} });
    return { updated: true };
  });
}

export async function archiveBusinessProduct(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, productId: z.string().min(1) }).parse(raw);
  await requirePermission(db, input, "product", "archive");
  await db.transaction(async (tx) => {
    await assertBusinessOperational(tx, input.businessId);
    const [archived] = await tx.update(product).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(product.businessId, input.businessId), eq(product.id, input.productId), isNull(product.archivedAt),
    )).returning({ id: product.id });
    if (!archived) throw new CommercialError("Produit introuvable ou déjà archivé.", 404);
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "product.archived", entityType: "product", entityId: input.productId, metadata: {} });
  });
  return { archived: true };
}

/*
 * Pagination par curseur des listes (mission 11, phase 6), sur le modèle de catalog-pages.ts : `?limit=`
 * (ou `cursor`) renvoie `{ items, nextCursor }` ; sans ces paramètres, chaque route garde sa réponse
 * historique pour les écrans qui en dépendent (liste complète des clients pour la caisse, 200 lignes
 * pour les journaux). Le curseur ne porte que des clés de tri, jamais d'identifiant de commerce.
 */
const pageInput = z.object({ cursor: z.string().max(512).optional(), limit: z.union([z.string(), z.number()]).optional() });
type Page = { cursor: string | null; limit: number };
function parsePage(raw: unknown): Page {
  const input = pageInput.parse(raw ?? {});
  return { cursor: input.cursor ?? null, limit: pageLimit(input.limit) };
}
/** Coupe la ligne de trop (limit + 1) et calcule le curseur suivant à partir de la dernière ligne gardée. */
function pageOf<T>(rows: T[], limit: number, cursorFor: (row: T) => Record<string, string>) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorFor(last)) : null };
}
/** Strictement après (nom, id) dans l'ordre croissant. */
const afterName = (name: SQLWrapper, id: SQLWrapper, cursor: { name: string; id: string }) => sql`(${name} > ${cursor.name} or (${name} = ${cursor.name} and ${id} > ${cursor.id}))`;
/** Strictement avant (date, id) dans l'ordre décroissant ; date exacte de PostgreSQL relue en texte (microsecondes). */
const beforeTime = (at: SQLWrapper, id: SQLWrapper, cursor: { at: string; id: string }) => sql`(${at} < ${cursor.at}::timestamptz or (${at} = ${cursor.at}::timestamptz and ${id} < ${cursor.id}))`;

async function querySales(db: CommercialDatabase, context: Context, filters: { from?: string; to?: string }, page: { cursor: { at: string; id: string } | null; limit: number }) {
  const conditions = [eq(sale.businessId, context.businessId), sql`${sale.status} <> 'voided'`];
  if (filters.from) conditions.push(gte(sale.occurredAt, new Date(`${filters.from}T00:00:00.000Z`)));
  if (filters.to) conditions.push(lte(sale.occurredAt, new Date(`${filters.to}T23:59:59.999Z`)));
  if (page.cursor) conditions.push(beforeTime(sale.occurredAt, sale.id, page.cursor));
  const rows = await db.select({ id: sale.id, reference: sale.reference, status: sale.status, totalXof: sale.totalXof,
    occurredAt: sale.occurredAt, customerName: customer.name,
    paidXof: sql<string>`coalesce(sum(case when ${payment.status} = 'confirmed' then ${payment.amountXof} else 0 end),0)::text`,
    methods: sql<string[]>`coalesce(array_agg(distinct ${payment.method}) filter (where ${payment.status} = 'confirmed'), array[]::text[])`,
    cursorAt: sql<string>`${sale.occurredAt}::text` })
    .from(sale).leftJoin(customer, and(eq(customer.businessId, sale.businessId), eq(customer.id, sale.customerId)))
    .leftJoin(payment, and(eq(payment.businessId, sale.businessId), eq(payment.saleId, sale.id)))
    .where(and(...conditions)).groupBy(sale.id, customer.name).orderBy(desc(sale.occurredAt), desc(sale.id)).limit(page.limit);
  return rows.map((row) => ({ ...row, dueXof: (row.totalXof - BigInt(row.paidXof)).toString() }));
}
function withoutCursor<T extends { cursorAt: string }>(row: T): Omit<T, "cursorAt"> {
  const copy: Partial<T> = { ...row };
  delete copy.cursorAt;
  return copy as Omit<T, "cursorAt">;
}

export async function listBusinessSales(db: CommercialDatabase, context: Context, filters: { from?: string; to?: string } = {}) {
  await requirePermission(db, context, "sale", "read");
  return (await querySales(db, context, filters, { cursor: null, limit: 200 })).map(withoutCursor);
}

/** Ventes du plus récent au plus ancien (date puis identifiant), page suivante strictement après la dernière affichée. */
export async function listBusinessSalesPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "sale", "read");
  const input = z.object({ from: isoDay.optional(), to: isoDay.optional() }).parse(raw ?? {});
  const page = parsePage(raw);
  const rows = await querySales(db, context, input, { cursor: decodeCursor(page.cursor, movementCursorSchema), limit: page.limit + 1 });
  const result = pageOf(rows, page.limit, (row) => ({ at: row.cursorAt, id: row.id }));
  return { items: result.items.map(withoutCursor), nextCursor: result.nextCursor };
}

export async function getBusinessSale(db: CommercialDatabase, context: Context & { saleId: string }) {
  await requirePermission(db, context, "sale", "read");
  const [record] = await db.select({ id: sale.id, reference: sale.reference, status: sale.status, subtotalXof: sale.subtotalXof,
    discountXof: sale.discountXof, totalXof: sale.totalXof, occurredAt: sale.occurredAt, customerId: sale.customerId,
    customerName: customer.name, customerPhone: customer.phone })
    .from(sale).leftJoin(customer, and(eq(customer.businessId, sale.businessId), eq(customer.id, sale.customerId)))
    .where(and(eq(sale.businessId, context.businessId), eq(sale.id, context.saleId))).limit(1);
  if (!record) throw new CommercialError("Vente introuvable.", 404);
  const [lines, payments, refunds] = await Promise.all([
    db.select().from(saleLine).where(and(eq(saleLine.businessId, context.businessId), eq(saleLine.saleId, context.saleId))),
    db.select().from(payment).where(and(eq(payment.businessId, context.businessId), eq(payment.saleId, context.saleId))).orderBy(asc(payment.occurredAt)),
    // Remboursements des seuls paiements de cette vente, filtrés en SQL (auparavant : tous ceux du commerce, triés en JavaScript).
    db.select({ id: paymentRefund.id, paymentId: paymentRefund.paymentId, amountXof: paymentRefund.amountXof, status: paymentRefund.status, occurredAt: paymentRefund.occurredAt })
      .from(paymentRefund).innerJoin(payment, and(eq(payment.businessId, paymentRefund.businessId), eq(payment.id, paymentRefund.paymentId)))
      .where(and(eq(paymentRefund.businessId, context.businessId), eq(payment.saleId, context.saleId))).orderBy(desc(paymentRefund.occurredAt)),
  ]);
  return { ...record, lines, payments, refunds, dueXof: (record.totalXof - payments.filter((part) => part.status === "confirmed").reduce((sum, part) => sum + part.amountXof, 0n)).toString() };
}

type CustomerRow = { id: string; name: string; phone: string | null; notes: string | null; createdAt: Date; saleCount: string; balanceXof: string; openingDueXof: string };

const customerColumns = sql`c.id, c.name, c.phone, c.notes, c.created_at as "createdAt",
  coalesce(st.sale_count, 0)::text as "saleCount",
  (coalesce(st.due, 0) + coalesce(ob.remaining, 0))::text as "balanceXof",
  coalesce(ob.remaining, 0)::text as "openingDueXof"`;

/**
 * Clients triés par nom puis identifiant, avec leur solde : ventes non annulées non soldées + reste de la
 * dette d'ouverture (mêmes chiffres qu'avant la phase 6, vérifiés par performance.integration.test.ts).
 * Deux plans, mesurés sur PGlite (docs/performance.md) :
 * - une page (`limit`) lit les ventes et paiements client par client (LATERAL, index
 *   customer(business_id, name, id), sale(business_id, customer_id), payment(business_id, sale_id, status)) ;
 * - la liste complète de la caisse agrège en une passe les seules ventes rattachées à un client
 *   (jointures par hachage) ; l'ancienne version agrégeait les paiements de toutes les ventes du commerce.
 */
async function queryCustomers(db: CommercialDatabase, businessId: string, page: { cursor: { name: string; id: string } | null; limit: number | null }) {
  if (page.limit !== null) {
    const after = page.cursor ? sql`and (c.name > ${page.cursor.name} or (c.name = ${page.cursor.name} and c.id > ${page.cursor.id}))` : sql``;
    const paged = await db.execute(sql`select ${customerColumns}
      from customer c
      left join lateral (select count(*) as sale_count, sum(greatest(s.total_xof - coalesce(p.paid, 0), 0)) as due
        from sale s left join lateral (select sum(pp.amount_xof) as paid from payment pp
          where pp.business_id = s.business_id and pp.sale_id = s.id and pp.status = 'confirmed') p on true
        where s.business_id = c.business_id and s.customer_id = c.id and s.status <> 'voided') st on true
      left join lateral (select b.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op where op.business_id = b.business_id and op.opening_balance_id = b.id), 0) as remaining
        from opening_balance b where b.business_id = c.business_id and b.customer_id = c.id) ob on true
      where c.business_id = ${businessId} ${after} order by c.name, c.id limit ${page.limit}`) as unknown as { rows: CustomerRow[] };
    return paged.rows;
  }
  const result = await db.execute(sql`with c as (
      select id, name, phone, notes, created_at from customer where business_id = ${businessId}
    ), s as (
      select s.id, s.customer_id, s.total_xof from sale s
      where s.business_id = ${businessId} and s.status <> 'voided' and s.customer_id in (select id from c)
    ), p as (
      select pp.sale_id, sum(pp.amount_xof) as paid from payment pp
      where pp.business_id = ${businessId} and pp.status = 'confirmed' and pp.sale_id in (select id from s) group by pp.sale_id
    ), st as (
      select s.customer_id, count(*) as sale_count, sum(greatest(s.total_xof - coalesce(p.paid, 0), 0)) as due
      from s left join p on p.sale_id = s.id group by s.customer_id
    ), ob as (
      select b.customer_id, b.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op where op.business_id = b.business_id and op.opening_balance_id = b.id), 0) as remaining
      from opening_balance b where b.business_id = ${businessId} and b.customer_id in (select id from c)
    )
    select ${customerColumns}
    from c left join st on st.customer_id = c.id left join ob on ob.customer_id = c.id
    order by c.name, c.id`) as unknown as { rows: CustomerRow[] };
  return result.rows;
}

export async function listBusinessCustomers(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "customer", "read");
  return queryCustomers(db, context.businessId, { cursor: null, limit: null });
}

export async function listBusinessCustomersPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "customer", "read");
  const page = parsePage(raw);
  const rows = await queryCustomers(db, context.businessId, { cursor: decodeCursor(page.cursor, productCursorSchema), limit: page.limit + 1 });
  return pageOf(rows, page.limit, (row) => ({ name: row.name, id: row.id }));
}

export async function createBusinessCustomer(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, name: z.string().trim().min(1).max(160), phone: z.string().trim().max(60).optional(), notes: z.string().trim().max(1000).optional() }).parse(raw);
  await requirePermission(db, input, "customer", "create");
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await assertBusinessOperational(tx, input.businessId);
    await tx.insert(customer).values({ id, businessId: input.businessId, name: input.name, phone: input.phone || null, notes: input.notes || null });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "customer.created", entityType: "customer", entityId: id, metadata: {} });
  });
  return { id };
}

export async function recordCustomerPayment(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, saleId: z.string().min(1), amountXof: xof, method: z.enum(["cash", "wave", "orange_money", "mtn_momo", "other"]) }).parse(raw);
  if (BigInt(input.amountXof) <= 0n) throw new CommercialError("Le montant doit être supérieur à zéro.");
  await requirePermission(db, input, "payment", "record");
  return runIdempotent(db, { ...input, operation: "receivable.payment",
    request: { saleId: input.saleId, amountXof: input.amountXof, method: input.method } }, async (tx) => {
    const [saleRow] = await tx.select().from(sale).where(and(eq(sale.businessId, input.businessId), eq(sale.id, input.saleId))).for("update").limit(1);
    if (!saleRow || !saleRow.customerId) throw new CommercialError("Créance client introuvable.", 404);
    const confirmed = await tx.select({ total: sql<string>`coalesce(sum(${payment.amountXof}),0)::text` }).from(payment).where(and(
      eq(payment.businessId, input.businessId), eq(payment.saleId, input.saleId), eq(payment.status, "confirmed"),
    ));
    const balance = saleRow.totalXof - BigInt(confirmed[0]?.total ?? "0");
    const amount = BigInt(input.amountXof);
    if (amount > balance) throw new CommercialError("Le règlement dépasse le solde restant dû.", 409);
    const id = randomUUID();
    const cashSessionId = input.method === "cash" ? await attachOpenCashSession(tx, input.businessId, input.actorUserId) : null;
    await tx.insert(payment).values({ id, businessId: input.businessId, saleId: input.saleId, method: input.method,
      amountXof: amount, status: "confirmed", recordedByUserId: input.actorUserId, idempotencyKey: `receivable:${input.idempotencyKey}`, confirmedAt: new Date(), cashSessionId });
    await tx.insert(receivablePayment).values({ id: randomUUID(), businessId: input.businessId, saleId: input.saleId, paymentId: id, appliedAmountXof: amount });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "receivable.payment_recorded", entityType: "sale", entityId: input.saleId, metadata: { amountXof: amount.toString(), method: input.method } });
    return { paymentId: id, remainingXof: (balance - amount).toString() };
  });
}

function queryStockItems(db: CommercialDatabase, businessId: string, page: { cursor: { name: string; id: string } | null; limit: number | null }) {
  const conditions = [eq(productVariant.businessId, businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt)];
  if (page.cursor) conditions.push(afterName(product.name, productVariant.id, page.cursor));
  const query = db.select({ variantId: productVariant.id, productId: product.id, name: product.name, category: productCategory.name,
    label: productVariant.label, sku: productVariant.sku, unit: product.baseUnit, onHand: productVariant.onHand,
    threshold: productVariant.lowStockThreshold, averageCostXof: productVariant.averageCostXof })
    .from(productVariant).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
    .leftJoin(productCategory, and(eq(productCategory.businessId, product.businessId), eq(productCategory.id, product.categoryId)))
    .where(and(...conditions)).orderBy(asc(product.name), asc(productVariant.id));
  return page.limit === null ? query : query.limit(page.limit);
}

/** Niveaux de stock par page (nom puis variante) ; les mouvements ont leur propre liste paginée (/api/business/stock/movements). */
export async function listStockItemsPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "inventory", "read");
  const page = parsePage(raw);
  const rows = await queryStockItems(db, context.businessId, { cursor: decodeCursor(page.cursor, productCursorSchema), limit: page.limit + 1 });
  return pageOf(rows, page.limit, (row) => ({ name: row.name, id: row.variantId }));
}

export async function getStockWorkspace(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "inventory", "read");
  const [items, movements] = await Promise.all([
    queryStockItems(db, context.businessId, { cursor: null, limit: null }),
    db.select({ id: stockMovement.id, product: product.name, variant: productVariant.label, sku: productVariant.sku,
      delta: stockMovement.quantityDelta, reason: stockMovement.reason, unitCostXof: stockMovement.unitCostXof,
      occurredAt: stockMovement.occurredAt })
      .from(stockMovement).innerJoin(productVariant, and(eq(productVariant.businessId, stockMovement.businessId), eq(productVariant.id, stockMovement.variantId)))
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(eq(stockMovement.businessId, context.businessId)).orderBy(desc(stockMovement.occurredAt)).limit(100),
  ]);
  return { items, movements };
}

function querySuppliers(db: CommercialDatabase, businessId: string, page: { cursor: { name: string; id: string } | null; limit: number | null }) {
  const conditions = [eq(supplier.businessId, businessId), isNull(supplier.archivedAt)];
  if (page.cursor) conditions.push(afterName(supplier.name, supplier.id, page.cursor));
  const query = db.select({ id: supplier.id, name: supplier.name, phone: supplier.phone, archivedAt: supplier.archivedAt,
    purchaseCount: sql<string>`count(${purchase.id})::text`, purchaseTotalXof: sql<string>`coalesce(sum(${purchase.totalXof}),0)::text`,
    // Dette d'ouverture restante envers ce fournisseur, distincte des achats enregistrés dans Qadr Ops.
    openingDueXof: sql<string>`coalesce((select b.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op where op.business_id=b.business_id and op.opening_balance_id=b.id),0) from opening_balance b where b.business_id=${supplier.businessId} and b.supplier_id=${supplier.id}),0)::text` })
    .from(supplier).leftJoin(purchase, and(eq(purchase.businessId, supplier.businessId), eq(purchase.supplierId, supplier.id), sql`${purchase.status} <> 'canceled'`))
    .where(and(...conditions)).groupBy(supplier.id).orderBy(asc(supplier.name), asc(supplier.id));
  return page.limit === null ? query : query.limit(page.limit);
}

export async function listBusinessSuppliers(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "supplier", "read");
  return querySuppliers(db, context.businessId, { cursor: null, limit: null });
}

export async function listBusinessSuppliersPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "supplier", "read");
  const page = parsePage(raw);
  const rows = await querySuppliers(db, context.businessId, { cursor: decodeCursor(page.cursor, productCursorSchema), limit: page.limit + 1 });
  return pageOf(rows, page.limit, (row) => ({ name: row.name, id: row.id }));
}

export async function createBusinessSupplier(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, name: z.string().trim().min(1).max(160), phone: z.string().trim().max(60).optional() }).parse(raw);
  await requirePermission(db, input, "supplier", "create");
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await assertBusinessOperational(tx, input.businessId);
    await tx.insert(supplier).values({ id, businessId: input.businessId, name: input.name, phone: input.phone || null });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "supplier.created", entityType: "supplier", entityId: id, metadata: {} });
  });
  return { id };
}

const purchaseInput = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, supplierId: z.string().min(1), reference: z.string().trim().min(1).max(80),
  lines: z.array(z.object({ variantId: z.string().min(1), quantity, unitCostXof: xof })).min(1).max(100),
  paidXof: xof.default("0"), paymentMethod: z.enum(["cash", "wave", "orange_money", "mtn_momo", "other"]).default("cash"),
});

function roundedLineAmount(unitCost: bigint, qtyMicros: bigint) {
  return (unitCost * qtyMicros + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}

export async function createReceivedPurchase(db: CommercialDatabase, raw: unknown) {
  const input = purchaseInput.parse(raw);
  await requirePermission(db, input, "purchase", "create");
  const quantityByVariant = new Map<string, bigint>();
  for (const line of input.lines) {
    if (quantityByVariant.has(line.variantId)) throw new CommercialError("Une variante ne peut apparaître qu’une fois dans un achat.");
    const old = quantityByVariant.get(line.variantId) ?? 0n;
    quantityByVariant.set(line.variantId, old + parseQuantityMicros(line.quantity));
  }
  if ([...quantityByVariant.values()].some((qty) => qty <= 0n)) throw new CommercialError("Les quantités reçues doivent être supérieures à zéro.");
  const id = randomUUID();
  const request = { supplierId: input.supplierId, reference: input.reference, paidXof: input.paidXof, paymentMethod: input.paymentMethod,
    lines: input.lines.map((line) => ({ variantId: line.variantId, quantityMicros: parseQuantityMicros(line.quantity).toString(), unitCostXof: line.unitCostXof })) };
  return runIdempotent(db, { ...input, operation: "purchase.receive", request }, async (tx) => {
    const [supplierRow] = await tx.select({ id: supplier.id }).from(supplier).where(and(
      eq(supplier.businessId, input.businessId), eq(supplier.id, input.supplierId), isNull(supplier.archivedAt),
    )).limit(1);
    if (!supplierRow) throw new CommercialError("Fournisseur introuvable dans ce commerce.", 404);
    const [sameReference] = await tx.select({ id: purchase.id }).from(purchase)
      .where(and(eq(purchase.businessId, input.businessId), eq(purchase.reference, input.reference))).limit(1);
    if (sameReference) throw new CommercialError("Un achat porte déjà cette référence dans ce commerce.", 409);
    const requestedIds = [...quantityByVariant.keys()].sort();
    const variants = await tx.select().from(productVariant).where(and(eq(productVariant.businessId, input.businessId), inArray(productVariant.id, requestedIds), isNull(productVariant.archivedAt))).orderBy(asc(productVariant.id)).for("update");
    if (variants.length !== requestedIds.length) throw new CommercialError("Un produit de l’approvisionnement est introuvable.", 404);
    const costs = new Map(input.lines.map((line) => [line.variantId, BigInt(line.unitCostXof)]));
    const totals = input.lines.map((line) => roundedLineAmount(costs.get(line.variantId)!, parseQuantityMicros(line.quantity)));
    const total = totals.reduce((sum, value) => sum + value, 0n);
    const paid = BigInt(input.paidXof);
    if (paid > total) throw new CommercialError("Le règlement dépasse le total de l’approvisionnement.");
    await tx.insert(purchase).values({ id, businessId: input.businessId, supplierId: input.supplierId, reference: input.reference, status: "received", totalXof: total });
    for (const [i, line] of input.lines.entries()) {
      const variant = variants.find((row) => row.id === line.variantId)!;
      const quantityMicros = parseQuantityMicros(line.quantity);
      const oldQty = parseQuantityMicros(variant.onHand);
      const oldCost = BigInt(variant.averageCostXof.replace(".", "").padEnd(13, "0"));
      const nextAverage = weightedAverageCost({ oldQuantityMicros: oldQty, oldUnitCostScaled: oldCost,
        receivedQuantityMicros: quantityMicros, receivedUnitCostScaled: BigInt(line.unitCostXof) * UNIT_COST_SCALE });
      const lineId = randomUUID();
      await tx.insert(purchaseLine).values({ id: lineId, businessId: input.businessId, purchaseId: id, variantId: line.variantId,
        quantity: line.quantity, unitCostXof: BigInt(line.unitCostXof), lineTotalXof: totals[i] });
      await tx.update(productVariant).set({ onHand: formatMicros(oldQty + quantityMicros), averageCostXof: formatCost(nextAverage), costKnown: true, stockRevision: variant.stockRevision + 1n })
        .where(and(eq(productVariant.businessId, input.businessId), eq(productVariant.id, line.variantId)));
      await tx.insert(stockMovement).values({ id: randomUUID(), businessId: input.businessId, variantId: line.variantId,
        quantityDelta: line.quantity, reason: "purchase", purchaseLineId: lineId, unitCostXof: formatCost(BigInt(line.unitCostXof) * UNIT_COST_SCALE), createdByUserId: input.actorUserId });
    }
    if (paid > 0n) {
      const cashSessionId = input.paymentMethod === "cash" ? await attachOpenCashSession(tx, input.businessId, input.actorUserId) : null;
      await tx.insert(purchasePayment).values({ id: randomUUID(), businessId: input.businessId, purchaseId: id, amountXof: paid, method: input.paymentMethod, cashSessionId });
    }
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "purchase.received", entityType: "purchase", entityId: id, metadata: { lineCount: input.lines.length, totalXof: total.toString() } });
    return { id, reference: input.reference, totalXof: total.toString(), paidXof: paid.toString(), dueXof: (total - paid).toString() };
  });
}

type TimePage = { cursor: { at: string; id: string } | null; limit: number };

function queryPurchases(db: CommercialDatabase, businessId: string, page: TimePage) {
  const conditions = [eq(purchase.businessId, businessId)];
  if (page.cursor) conditions.push(beforeTime(purchase.occurredAt, purchase.id, page.cursor));
  return db.select({ id: purchase.id, reference: purchase.reference, status: purchase.status, totalXof: purchase.totalXof,
    occurredAt: purchase.occurredAt, supplierName: supplier.name,
    paidXof: sql<string>`coalesce((select sum(pp.amount_xof)::text from purchase_payment pp where pp.business_id=${businessId} and pp.purchase_id=${purchase.id}), '0')`,
    cursorAt: sql<string>`${purchase.occurredAt}::text` })
    .from(purchase).innerJoin(supplier, and(eq(supplier.businessId, purchase.businessId), eq(supplier.id, purchase.supplierId)))
    .where(and(...conditions)).orderBy(desc(purchase.occurredAt), desc(purchase.id)).limit(page.limit);
}

export async function listBusinessPurchases(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "purchase", "read");
  return (await queryPurchases(db, context.businessId, { cursor: null, limit: 200 })).map(withoutCursor);
}

export async function listBusinessPurchasesPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "purchase", "read");
  const page = parsePage(raw);
  const result = pageOf(await queryPurchases(db, context.businessId, { cursor: decodeCursor(page.cursor, movementCursorSchema), limit: page.limit + 1 }),
    page.limit, (row) => ({ at: row.cursorAt, id: row.id }));
  return { items: result.items.map(withoutCursor), nextCursor: result.nextCursor };
}

function queryExpenses(db: CommercialDatabase, businessId: string, page: TimePage) {
  const conditions = [eq(expense.businessId, businessId)];
  if (page.cursor) conditions.push(beforeTime(expense.occurredAt, expense.id, page.cursor));
  return db.select({ id: expense.id, category: expense.category, description: expense.description, amountXof: expense.amountXof, paymentMethod: expense.paymentMethod,
    occurredAt: expense.occurredAt, cursorAt: sql<string>`${expense.occurredAt}::text` })
    .from(expense).where(and(...conditions)).orderBy(desc(expense.occurredAt), desc(expense.id)).limit(page.limit);
}

export async function listBusinessExpenses(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "expense", "read");
  return (await queryExpenses(db, context.businessId, { cursor: null, limit: 200 })).map(withoutCursor);
}

export async function listBusinessExpensesPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "expense", "read");
  const page = parsePage(raw);
  const result = pageOf(await queryExpenses(db, context.businessId, { cursor: decodeCursor(page.cursor, movementCursorSchema), limit: page.limit + 1 }),
    page.limit, (row) => ({ at: row.cursorAt, id: row.id }));
  return { items: result.items.map(withoutCursor), nextCursor: result.nextCursor };
}

export async function createBusinessExpense(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(240), amountXof: xof,
    // Facultatif pour les anciens clients ; une dépense en espèces sort de la caisse ouverte de la personne qui l'enregistre.
    paymentMethod: z.enum(["cash", "wave", "orange_money", "mtn_momo", "other"]).optional() }).parse(raw);
  if (BigInt(input.amountXof) <= 0n) throw new CommercialError("Le montant doit être supérieur à zéro.");
  await requirePermission(db, input, "expense", "create");
  const id = randomUUID();
  return runIdempotent(db, { ...input, operation: "expense.create",
    request: { category: input.category, description: input.description, amountXof: input.amountXof, paymentMethod: input.paymentMethod } }, async (tx) => {
    const cashSessionId = input.paymentMethod === "cash" ? await attachOpenCashSession(tx, input.businessId, input.actorUserId) : null;
    await tx.insert(expense).values({ id, businessId: input.businessId, category: input.category, description: input.description, amountXof: BigInt(input.amountXof),
      paidByUserId: input.actorUserId, paymentMethod: input.paymentMethod ?? null, cashSessionId });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "expense.created", entityType: "expense", entityId: id, metadata: { amountXof: input.amountXof, category: input.category } });
    return { id };
  });
}

export async function getBusinessSettings(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "business", "read");
  const [result] = await db.select({ name: organization.name, logo: organization.logo, role: member.role, phone: businessProfile.phone,
    address: businessProfile.address, email: businessProfile.businessEmail, currency: businessProfile.currency,
    timezone: businessProfile.timezone, primaryColor: businessProfile.primaryColor,
    paperWidthMm: receiptSettings.paperWidthMm, showLogo: receiptSettings.showLogo, receiptFooter: receiptSettings.footer })
    .from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .innerJoin(member, and(eq(member.organizationId, businessProfile.businessId), eq(member.userId, context.actorUserId)))
    .leftJoin(receiptSettings, eq(receiptSettings.businessId, businessProfile.businessId)).where(eq(businessProfile.businessId, context.businessId)).limit(1);
  return result ?? null;
}

export async function updateBusinessSettings(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, name: z.string().trim().min(1).max(160), phone: z.string().trim().max(60).nullable(),
    address: z.string().trim().max(240).nullable(), email: z.union([z.string().email().max(240), z.literal("")]).nullable(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), paperWidthMm: z.union([z.literal(58), z.literal(80)]),
    showLogo: z.boolean(), receiptFooter: z.string().trim().max(300).nullable() }).parse(raw);
  await requirePermission(db, input, "business", "update");
  await db.transaction(async (tx) => {
    // Verrou exclusif sur le profil AVANT le contrôle d'état (FOR SHARE) : deux enregistrements simultanés
    // ne peuvent plus tenir chacun un verrou partagé puis attendre l'autre pour le mettre à jour (interblocage).
    // Ordre fixe ensuite : profil, organisation, réglages du reçu.
    await tx.select({ businessId: businessProfile.businessId }).from(businessProfile).where(eq(businessProfile.businessId, input.businessId)).for("update");
    await assertBusinessOperational(tx, input.businessId);
    await tx.update(organization).set({ name: input.name }).where(eq(organization.id, input.businessId));
    await tx.update(businessProfile).set({ phone: input.phone, address: input.address, businessEmail: input.email || null,
      primaryColor: input.primaryColor, updatedAt: new Date() }).where(eq(businessProfile.businessId, input.businessId));
    await tx.insert(receiptSettings).values({ businessId: input.businessId, paperWidthMm: input.paperWidthMm,
      showLogo: input.showLogo, footer: input.receiptFooter, updatedAt: new Date() }).onConflictDoUpdate({ target: receiptSettings.businessId,
      set: { paperWidthMm: input.paperWidthMm, showLogo: input.showLogo, footer: input.receiptFooter, updatedAt: new Date() } });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "business.settings_updated", entityType: "business_profile", entityId: input.businessId, metadata: {} });
  });
  return { updated: true };
}

export async function listStockMovementsForProduct(db: CommercialDatabase, context: Context & { variantId: string }) {
  await requirePermission(db, context, "inventory", "read");
  return db.select({ id: stockMovement.id, delta: stockMovement.quantityDelta, reason: stockMovement.reason, occurredAt: stockMovement.occurredAt,
    unitCostXof: stockMovement.unitCostXof })
    .from(stockMovement).where(and(eq(stockMovement.businessId, context.businessId), eq(stockMovement.variantId, context.variantId)))
    .orderBy(desc(stockMovement.occurredAt)).limit(100);
}
