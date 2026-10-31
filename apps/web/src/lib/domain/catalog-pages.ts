import { and, asc, desc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import { member, product, productCategory, productVariant, stockMovement } from "@/lib/db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { decodeCursor, encodeCursor, likePattern, movementCursorSchema, pageLimit, productCursorSchema } from "./cursor";

type Context = { businessId: string; actorUserId: string };

async function requirePermission(db: CommercialDatabase, context: Context, resource: Parameters<typeof hasBusinessPermission>[1], action: string) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId))).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, resource, action)) {
    throw new CommercialError("Vous n’avez pas l’autorisation d’effectuer cette opération.", 403);
  }
}

export const stockStatuses = ["ok", "low", "out"] as const;
export type StockStatusFilter = (typeof stockStatuses)[number];

/** Même règle que le client (`lib/client/stock.ts`) : rupture ≤ 0, faible ≤ seuil (> 0), sinon en stock. */
function statusCondition(status: StockStatusFilter): SQL {
  if (status === "out") return sql`${productVariant.onHand} <= 0`;
  if (status === "low") return sql`${productVariant.onHand} > 0 and ${productVariant.lowStockThreshold} > 0 and ${productVariant.onHand} <= ${productVariant.lowStockThreshold}`;
  return sql`${productVariant.onHand} > 0 and (${productVariant.lowStockThreshold} = 0 or ${productVariant.onHand} > ${productVariant.lowStockThreshold})`;
}

const productPageInput = z.object({
  q: z.string().trim().max(120).optional(), categoryId: z.string().min(1).max(100).optional(),
  status: z.enum(stockStatuses).optional(), cursor: z.string().max(512).optional(), limit: z.union([z.string(), z.number()]).optional(),
});

/**
 * Page de catalogue triée par nom puis identifiant de variante (ordre total et stable) avec un
 * curseur « keyset » : un produit ajouté pendant la consultation ne décale ni ne duplique les pages.
 */
export async function listProductsPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "product", "read");
  const input = productPageInput.parse(raw);
  const limit = pageLimit(input.limit);
  const cursor = decodeCursor(input.cursor, productCursorSchema);
  const base: SQL[] = [eq(productVariant.businessId, context.businessId), isNull(product.archivedAt), isNull(productVariant.archivedAt)];
  if (input.categoryId) base.push(eq(product.categoryId, input.categoryId));
  if (input.q) {
    const pattern = likePattern(input.q);
    base.push(sql`(${product.name} ilike ${pattern} or ${productVariant.sku} ilike ${pattern} or ${productVariant.label} ilike ${pattern})`);
  }
  const filtered = input.status ? [...base, statusCondition(input.status)] : base;
  const page = cursor ? [...filtered, or(gt(product.name, cursor.name), and(eq(product.name, cursor.name), gt(productVariant.id, cursor.id)))!] : filtered;

  const [rows, summaryRows, categories] = await Promise.all([
    db.select({ id: product.id, name: product.name, description: product.description, categoryId: product.categoryId,
      categoryName: productCategory.name, baseUnit: product.baseUnit, variantId: productVariant.id, variantLabel: productVariant.label,
      sku: productVariant.sku, salePriceXof: productVariant.salePriceXof, onHand: productVariant.onHand, averageCostXof: productVariant.averageCostXof,
      costKnown: productVariant.costKnown, lowStockThreshold: productVariant.lowStockThreshold })
      .from(productVariant)
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .leftJoin(productCategory, and(eq(productCategory.businessId, product.businessId), eq(productCategory.id, product.categoryId)))
      .where(and(...page)).orderBy(asc(product.name), asc(productVariant.id)).limit(limit + 1),
    // Compteurs calculés sur le même périmètre (recherche et catégorie) que la liste, hors filtre d'état.
    db.select({
      total: sql<string>`count(*)::text`,
      ok: sql<string>`count(*) filter (where ${statusCondition("ok")})::text`,
      low: sql<string>`count(*) filter (where ${statusCondition("low")})::text`,
      out: sql<string>`count(*) filter (where ${statusCondition("out")})::text`,
    }).from(productVariant)
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(...base)),
    db.select({ id: productCategory.id, name: productCategory.name }).from(productCategory)
      .where(and(eq(productCategory.businessId, context.businessId), isNull(productCategory.archivedAt))).orderBy(asc(productCategory.name)),
  ]);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const summary = summaryRows[0] ?? { total: "0", ok: "0", low: "0", out: "0" };
  return {
    items, categories,
    nextCursor: rows.length > limit && last ? encodeCursor({ name: last.name, id: last.variantId }) : null,
    summary: { total: Number(summary.total), ok: Number(summary.ok), low: Number(summary.low), out: Number(summary.out) },
  };
}

export const movementReasons = ["sale", "purchase", "inventory_adjustment", "manual_adjustment", "return", "opening_stock"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const movementPageInput = z.object({
  q: z.string().trim().max(120).optional(), variantId: z.string().min(1).max(100).optional(),
  reason: z.enum(movementReasons).optional(), direction: z.enum(["in", "out"]).optional(),
  from: isoDate.optional(), to: isoDate.optional(), cursor: z.string().max(512).optional(), limit: z.union([z.string(), z.number()]).optional(),
});

/**
 * Historique des mouvements du plus récent au plus ancien (date puis identifiant), sans limite
 * de profondeur : la page suivante reprend strictement après le dernier mouvement affiché.
 * Les bornes de période sont des jours civils d'Abidjan (UTC+0).
 */
export async function listStockMovementsPage(db: CommercialDatabase, context: Context, raw: unknown) {
  await requirePermission(db, context, "inventory", "read");
  const input = movementPageInput.parse(raw);
  if (input.from && input.to && input.from > input.to) throw new CommercialError("La date de début doit précéder la date de fin.", 400);
  const limit = pageLimit(input.limit, 30);
  const cursor = decodeCursor(input.cursor, movementCursorSchema);
  const base: SQL[] = [eq(stockMovement.businessId, context.businessId)];
  if (input.variantId) base.push(eq(stockMovement.variantId, input.variantId));
  if (input.reason) base.push(eq(stockMovement.reason, input.reason));
  if (input.direction) base.push(input.direction === "in" ? sql`${stockMovement.quantityDelta} > 0` : sql`${stockMovement.quantityDelta} < 0`);
  if (input.from) base.push(sql`${stockMovement.occurredAt} >= ${`${input.from}T00:00:00Z`}::timestamptz`);
  if (input.to) base.push(sql`${stockMovement.occurredAt} < (${`${input.to}T00:00:00Z`}::timestamptz + interval '1 day')`);
  if (input.q) {
    const pattern = likePattern(input.q);
    base.push(sql`(${product.name} ilike ${pattern} or ${productVariant.sku} ilike ${pattern})`);
  }
  // Le curseur porte l'horodatage exact de PostgreSQL (microsecondes) : un Date JS l'arrondirait à la
  // milliseconde et pourrait sauter des mouvements enregistrés dans la même milliseconde.
  const page = cursor ? [...base, sql`(${stockMovement.occurredAt} < ${cursor.at}::timestamptz or (${stockMovement.occurredAt} = ${cursor.at}::timestamptz and ${stockMovement.id} < ${cursor.id}))`] : base;

  const [rows, summaryRows] = await Promise.all([
    db.select({ id: stockMovement.id, variantId: stockMovement.variantId, product: product.name, variant: productVariant.label, sku: productVariant.sku,
      unit: product.baseUnit, delta: stockMovement.quantityDelta, reason: stockMovement.reason, unitCostXof: stockMovement.unitCostXof, occurredAt: stockMovement.occurredAt, cursorAt: sql<string>`${stockMovement.occurredAt}::text` })
      .from(stockMovement)
      .innerJoin(productVariant, and(eq(productVariant.businessId, stockMovement.businessId), eq(productVariant.id, stockMovement.variantId)))
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(...page)).orderBy(desc(stockMovement.occurredAt), desc(stockMovement.id)).limit(limit + 1),
    db.select({
      total: sql<string>`count(*)::text`,
      in: sql<string>`count(*) filter (where ${stockMovement.quantityDelta} > 0)::text`,
      out: sql<string>`count(*) filter (where ${stockMovement.quantityDelta} < 0)::text`,
    }).from(stockMovement)
      .innerJoin(productVariant, and(eq(productVariant.businessId, stockMovement.businessId), eq(productVariant.id, stockMovement.variantId)))
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(...base)),
  ]);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const items = pageRows.map((row) => ({ id: row.id, variantId: row.variantId, product: row.product, variant: row.variant, sku: row.sku, unit: row.unit,
    delta: row.delta, reason: row.reason, unitCostXof: row.unitCostXof, occurredAt: row.occurredAt.toISOString() }));
  const summary = summaryRows[0] ?? { total: "0", in: "0", out: "0" };
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.cursorAt, id: last.id }) : null,
    summary: { total: Number(summary.total), in: Number(summary.in), out: Number(summary.out) },
  };
}
