import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import {
  auditEvent, businessProfile, customer, expense, member, organization,
  payment, paymentRefund, product, productCategory, productVariant, purchase, purchaseLine, purchasePayment,
  receiptSettings, receivablePayment, sale, saleLine, stockMovement, supplier,
} from "@/lib/db/schema";
import { parseQuantityMicros, QUANTITY_SCALE, UNIT_COST_SCALE, weightedAverageCost } from "./costing";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { getCommercialReport } from "./reports";
import { assertBusinessOperational, idempotencyKeySchema, runIdempotent } from "./operation-guard";

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

function abidjanDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function getBusinessOverview(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "report", "read");
  const today = abidjanDate();
  const [identity, todayReport, weekReport, recentSales, lowStock, recentActivity] = await Promise.all([
    db.select({ name: organization.name, logo: organization.logo, activity: businessProfile.activity, phone: businessProfile.phone, timezone: businessProfile.timezone })
      .from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
      .where(eq(businessProfile.businessId, context.businessId)).limit(1),
    getCommercialReport(db, { ...context, period: "daily", date: today }),
    getCommercialReport(db, { ...context, period: "weekly", date: today }),
    db.select({ id: sale.id, reference: sale.reference, status: sale.status, totalXof: sale.totalXof, occurredAt: sale.occurredAt,
      customerName: customer.name, paidXof: sql<string>`coalesce(sum(case when ${payment.status} = 'confirmed' then ${payment.amountXof} else 0 end),0)::text` })
      .from(sale).leftJoin(customer, and(eq(customer.businessId, sale.businessId), eq(customer.id, sale.customerId)))
      .leftJoin(payment, and(eq(payment.businessId, sale.businessId), eq(payment.saleId, sale.id)))
      .where(and(eq(sale.businessId, context.businessId), sql`${sale.status} <> 'voided'`))
      .groupBy(sale.id, customer.name).orderBy(desc(sale.occurredAt)).limit(6),
    db.select({ productId: product.id, name: product.name, variantId: productVariant.id, variant: productVariant.label,
      sku: productVariant.sku, onHand: productVariant.onHand, threshold: productVariant.lowStockThreshold })
      .from(productVariant).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(eq(productVariant.businessId, context.businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt),
        sql`${productVariant.lowStockThreshold} > 0 and ${productVariant.onHand} <= ${productVariant.lowStockThreshold}`))
      .orderBy(asc(productVariant.onHand), asc(product.name)).limit(8),
    db.select({ id: auditEvent.id, eventType: auditEvent.eventType, entityType: auditEvent.entityType, occurredAt: auditEvent.occurredAt })
      .from(auditEvent).where(eq(auditEvent.businessId, context.businessId)).orderBy(desc(auditEvent.occurredAt)).limit(5),
  ]);
  return { business: identity[0] ?? null, date: today, today: todayReport, week: weekReport,
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

export async function listBusinessSales(db: CommercialDatabase, context: Context, filters: { from?: string; to?: string } = {}) {
  await requirePermission(db, context, "sale", "read");
  const conditions = [eq(sale.businessId, context.businessId), sql`${sale.status} <> 'voided'`];
  if (filters.from) conditions.push(gte(sale.occurredAt, new Date(`${filters.from}T00:00:00.000Z`)));
  if (filters.to) conditions.push(lte(sale.occurredAt, new Date(`${filters.to}T23:59:59.999Z`)));
  const rows = await db.select({ id: sale.id, reference: sale.reference, status: sale.status, totalXof: sale.totalXof,
    occurredAt: sale.occurredAt, customerName: customer.name,
    paidXof: sql<string>`coalesce(sum(case when ${payment.status} = 'confirmed' then ${payment.amountXof} else 0 end),0)::text`,
    methods: sql<string[]>`coalesce(array_agg(distinct ${payment.method}) filter (where ${payment.status} = 'confirmed'), array[]::text[])` })
    .from(sale).leftJoin(customer, and(eq(customer.businessId, sale.businessId), eq(customer.id, sale.customerId)))
    .leftJoin(payment, and(eq(payment.businessId, sale.businessId), eq(payment.saleId, sale.id)))
    .where(and(...conditions)).groupBy(sale.id, customer.name).orderBy(desc(sale.occurredAt)).limit(200);
  return rows.map((row) => ({ ...row, dueXof: (row.totalXof - BigInt(row.paidXof)).toString() }));
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
    db.select({ id: paymentRefund.id, paymentId: paymentRefund.paymentId, amountXof: paymentRefund.amountXof, status: paymentRefund.status, occurredAt: paymentRefund.occurredAt })
      .from(paymentRefund).where(eq(paymentRefund.businessId, context.businessId)).orderBy(desc(paymentRefund.occurredAt)),
  ]);
  const salePaymentIds = new Set(payments.map((part) => part.id));
  const saleRefunds = refunds.filter((refund) => salePaymentIds.has(refund.paymentId));
  return { ...record, lines, payments, refunds: saleRefunds, dueXof: (record.totalXof - payments.filter((part) => part.status === "confirmed").reduce((sum, part) => sum + part.amountXof, 0n)).toString() };
}

export async function listBusinessCustomers(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "customer", "read");
  const result = await db.execute(sql`select c.id, c.name, c.phone, c.notes, c.created_at as "createdAt",
    count(s.id)::text as "saleCount", coalesce(sum(case when s.id is not null then greatest(s.total_xof-coalesce(p.paid,0),0) else 0 end),0)::text as "balanceXof"
    from customer c left join sale s on s.business_id=c.business_id and s.customer_id=c.id and s.status <> 'voided'
    left join (select business_id,sale_id,sum(amount_xof) as paid from payment where business_id=${context.businessId} and status='confirmed' group by business_id,sale_id) p
      on p.business_id=s.business_id and p.sale_id=s.id
    where c.business_id=${context.businessId} group by c.id order by c.name`) as unknown as { rows: { id: string; name: string; phone: string | null; notes: string | null; createdAt: Date; saleCount: string; balanceXof: string }[] };
  return result.rows;
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
    await tx.insert(payment).values({ id, businessId: input.businessId, saleId: input.saleId, method: input.method,
      amountXof: amount, status: "confirmed", recordedByUserId: input.actorUserId, idempotencyKey: `receivable:${input.idempotencyKey}`, confirmedAt: new Date() });
    await tx.insert(receivablePayment).values({ id: randomUUID(), businessId: input.businessId, saleId: input.saleId, paymentId: id, appliedAmountXof: amount });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "receivable.payment_recorded", entityType: "sale", entityId: input.saleId, metadata: { amountXof: amount.toString(), method: input.method } });
    return { paymentId: id, remainingXof: (balance - amount).toString() };
  });
}

export async function getStockWorkspace(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "inventory", "read");
  const [items, movements] = await Promise.all([
    db.select({ variantId: productVariant.id, productId: product.id, name: product.name, category: productCategory.name,
      label: productVariant.label, sku: productVariant.sku, unit: product.baseUnit, onHand: productVariant.onHand,
      threshold: productVariant.lowStockThreshold, averageCostXof: productVariant.averageCostXof })
      .from(productVariant).innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .leftJoin(productCategory, and(eq(productCategory.businessId, product.businessId), eq(productCategory.id, product.categoryId)))
      .where(and(eq(productVariant.businessId, context.businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt))).orderBy(asc(product.name)),
    db.select({ id: stockMovement.id, product: product.name, variant: productVariant.label, sku: productVariant.sku,
      delta: stockMovement.quantityDelta, reason: stockMovement.reason, unitCostXof: stockMovement.unitCostXof,
      occurredAt: stockMovement.occurredAt })
      .from(stockMovement).innerJoin(productVariant, and(eq(productVariant.businessId, stockMovement.businessId), eq(productVariant.id, stockMovement.variantId)))
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(eq(stockMovement.businessId, context.businessId)).orderBy(desc(stockMovement.occurredAt)).limit(100),
  ]);
  return { items, movements };
}

export async function listBusinessSuppliers(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "supplier", "read");
  const rows = await db.select({ id: supplier.id, name: supplier.name, phone: supplier.phone, archivedAt: supplier.archivedAt,
    purchaseCount: sql<string>`count(${purchase.id})::text`, purchaseTotalXof: sql<string>`coalesce(sum(${purchase.totalXof}),0)::text` })
    .from(supplier).leftJoin(purchase, and(eq(purchase.businessId, supplier.businessId), eq(purchase.supplierId, supplier.id), sql`${purchase.status} <> 'canceled'`))
    .where(and(eq(supplier.businessId, context.businessId), isNull(supplier.archivedAt))).groupBy(supplier.id).orderBy(asc(supplier.name));
  return rows;
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
    if (paid > 0n) await tx.insert(purchasePayment).values({ id: randomUUID(), businessId: input.businessId, purchaseId: id, amountXof: paid, method: input.paymentMethod });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "purchase.received", entityType: "purchase", entityId: id, metadata: { lineCount: input.lines.length, totalXof: total.toString() } });
    return { id, reference: input.reference, totalXof: total.toString(), paidXof: paid.toString(), dueXof: (total - paid).toString() };
  });
}

export async function listBusinessPurchases(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "purchase", "read");
  return db.select({ id: purchase.id, reference: purchase.reference, status: purchase.status, totalXof: purchase.totalXof,
    occurredAt: purchase.occurredAt, supplierName: supplier.name,
    paidXof: sql<string>`coalesce((select sum(pp.amount_xof)::text from purchase_payment pp where pp.business_id=${context.businessId} and pp.purchase_id=${purchase.id}), '0')` })
    .from(purchase).innerJoin(supplier, and(eq(supplier.businessId, purchase.businessId), eq(supplier.id, purchase.supplierId)))
    .where(eq(purchase.businessId, context.businessId)).orderBy(desc(purchase.occurredAt)).limit(200);
}

export async function listBusinessExpenses(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, "expense", "read");
  return db.select({ id: expense.id, category: expense.category, description: expense.description, amountXof: expense.amountXof, occurredAt: expense.occurredAt })
    .from(expense).where(eq(expense.businessId, context.businessId)).orderBy(desc(expense.occurredAt)).limit(200);
}

export async function createBusinessExpense(db: CommercialDatabase, raw: unknown) {
  const input = z.object({ ...contextShape, idempotencyKey: idempotencyKeySchema, category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(240), amountXof: xof }).parse(raw);
  if (BigInt(input.amountXof) <= 0n) throw new CommercialError("Le montant doit être supérieur à zéro.");
  await requirePermission(db, input, "expense", "create");
  const id = randomUUID();
  return runIdempotent(db, { ...input, operation: "expense.create",
    request: { category: input.category, description: input.description, amountXof: input.amountXof } }, async (tx) => {
    await tx.insert(expense).values({ id, businessId: input.businessId, category: input.category, description: input.description, amountXof: BigInt(input.amountXof), paidByUserId: input.actorUserId });
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
