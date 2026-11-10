import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { member, organization } from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { getCommercialReport, reportRange, type CommercialReport } from "./reports";

/*
 * Données des exports (mission 11, phase 4, docs/exports.md). Lecture seule.
 *
 * - Commerce : celui de la session (`businessId` vient de getBusinessContext), jamais de la requête.
 *   Chaque requête filtre par ce commerce, jointures comprises (clés composées `business_id, id`).
 * - Permissions : `report:read` pour tout export (comme les rapports), puis la permission de lecture de
 *   chaque domaine pour sa feuille (ventes, paiements, dépenses…). Une feuille non autorisée est absente
 *   du classeur et la synthèse le dit : un rôle ne voit pas, ligne par ligne, plus que dans l'application.
 * - Période : la même que les rapports (`reportRange`, 1 à 366 jours, fuseau du commerce). Les totaux
 *   viennent de getCommercialReport ; les lignes détaillées suivent ses définitions (docs/reports.md) et
 *   des tests vérifient que leurs sommes retombent sur les totaux du rapport.
 * - Bornes : au plus EXPORT_LIMITS.rowsPerSheet lignes par feuille. Pour une feuille de la période
 *   (ventes, paiements, stock, achats, dépenses), un dépassement refuse l'export (422) plutôt que de
 *   livrer une feuille incomplète ; les listes de référence (produits, clients, dettes, fournisseurs)
 *   sont tronquées et la troncature est écrite dans le fichier.
 * - Rien n'est stocké ni journalisé : les fichiers sont produits en mémoire par l'appelant.
 * - Taille (mission 16) : en plus des lignes, le XML du classeur est borné à `xlsxXmlBytes` (mémoire du
 *   serveur, compté pendant la génération) et tout fichier renvoyé à `fileBytes` (une fonction Vercel ne
 *   répond pas au-delà de 4,5 Mo). Au-delà : 422 `export_too_large`, jamais de fichier tronqué.
 */
export type ExportLimits = { rowsPerSheet: number; xlsxXmlBytes: number; fileBytes: number };
export const EXPORT_LIMITS: ExportLimits = { rowsPerSheet: 5_000, xlsxXmlBytes: 64 * 1024 * 1024, fileBytes: 4 * 1024 * 1024 };

const exportInputSchema = z.object({
  businessId: z.string().min(1), actorUserId: z.string().min(1),
  period: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]).default("monthly"),
  date: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(),
});

export const exportSheetKeys = ["sales", "products", "stock", "customers", "receivables", "suppliers", "purchases", "expenses", "payments"] as const;
export type ExportSheetKey = (typeof exportSheetKeys)[number];

const sheetPermission: Record<ExportSheetKey, Parameters<typeof hasBusinessPermission>[1]> = {
  sales: "sale", products: "product", stock: "inventory", customers: "customer", receivables: "customer",
  suppliers: "supplier", purchases: "purchase", expenses: "expense", payments: "payment",
};
/** Feuilles bornées par la période : un dépassement de plafond refuse l'export. */
const periodSheets = new Set<ExportSheetKey>(["sales", "stock", "purchases", "expenses", "payments"]);

export type SaleExportRow = { occurredAt: string; reference: string; status: string; customerName: string | null; cashierName: string | null; subtotalXof: string; discountXof: string; totalXof: string; paidXof: string; dueXof: string };
export type PaymentExportRow = { occurredAt: string; confirmedAt: string | null; saleReference: string; method: string; status: string; amountXof: string; settlement: boolean; collectedInPeriod: boolean; recordedBy: string | null };
export type ProductExportRow = { name: string; variant: string; sku: string | null; barcode: string | null; category: string | null; unit: string; salePriceXof: string; averageCostXof: string; costKnown: boolean; onHand: string; lowStockThreshold: string };
export type StockExportRow = { occurredAt: string; product: string; variant: string; reason: string; quantityDelta: string; unitCostXof: string | null; createdBy: string | null };
export type CustomerExportRow = { name: string; phone: string | null; notes: string | null; createdAt: string };
export type ReceivableExportRow = { name: string; phone: string | null; unpaidSales: string; salesDueXof: string; openingDueXof: string; totalDueXof: string };
export type SupplierExportRow = { name: string; phone: string | null; archived: boolean; purchaseCount: string; purchasedXof: string; purchasesDueXof: string; openingDueXof: string; totalDueXof: string };
export type PurchaseExportRow = { occurredAt: string; reference: string; supplier: string; status: string; totalXof: string; paidXof: string; dueXof: string };
export type ExpenseExportRow = { occurredAt: string; category: string; description: string; method: string | null; amountXof: string; paidBy: string | null };

type SheetRows = {
  sales: SaleExportRow; products: ProductExportRow; stock: StockExportRow; customers: CustomerExportRow; receivables: ReceivableExportRow;
  suppliers: SupplierExportRow; purchases: PurchaseExportRow; expenses: ExpenseExportRow; payments: PaymentExportRow;
};
export type ExportSheets = { [K in ExportSheetKey]: { rows: SheetRows[K][]; truncated: boolean } | null };

export type ExportData = {
  businessName: string;
  report: CommercialReport;
  sheets: ExportSheets;
  /** Feuilles absentes faute de permission pour ce rôle. */
  omitted: ExportSheetKey[];
  /** Listes de référence tronquées au plafond. */
  truncated: ExportSheetKey[];
  limit: number;
};

const collected = sql.raw(`('confirmed','partially_refunded','refunded')`);

async function rows<T>(db: CommercialDatabase, query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

/** Données du rapport seul (PDF) : mêmes contrôles que l'écran Rapports, plus le nom du commerce. */
export async function getReportExport(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = exportInputSchema.parse(raw);
  const report = await getCommercialReport(db, { ...input, detail: "full" }, now);
  const [business] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, input.businessId)).limit(1);
  return { report, businessName: business?.name ?? "" };
}

/** Données du classeur : rapport complet de la période et lignes détaillées autorisées pour ce rôle. */
export async function getWorkbookExport(db: CommercialDatabase, raw: unknown, now = new Date(), limits: { rowsPerSheet: number } = EXPORT_LIMITS): Promise<ExportData> {
  const input = exportInputSchema.parse(raw);
  // getCommercialReport vérifie l'appartenance et `report:read`, valide la période et le fuseau.
  const { report, businessName } = await getReportExport(db, input, now);
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
  )).limit(1);
  if (!membership) throw new CommercialError("Vous n’avez pas l’autorisation de consulter les rapports.", 403, "forbidden");
  const { start, end } = reportRange(input, report.timezone, now);
  const b = input.businessId;
  const tz = report.timezone;
  const cap = limits.rowsPerSheet;
  const stamp = (column: ReturnType<typeof sql>) => sql`to_char(${column} at time zone ${tz}, 'YYYY-MM-DD HH24:MI')`;

  const queries: { [K in ExportSheetKey]: () => Promise<SheetRows[K][]> } = {
    sales: () => rows<SaleExportRow>(db, sql`select ${stamp(sql`s.occurred_at`)} as "occurredAt", s.reference, s.status,
        c.name as "customerName", u.name as "cashierName", s.subtotal_xof::text as "subtotalXof", s.discount_xof::text as "discountXof", s.total_xof::text as "totalXof",
        coalesce(p.paid, 0)::text as "paidXof",
        (case when s.status = 'voided' then 0 else greatest(s.total_xof - coalesce(p.paid, 0), 0) end)::text as "dueXof"
      from sale s
      left join customer c on c.business_id = s.business_id and c.id = s.customer_id
      left join member m on m.organization_id = s.business_id and m.user_id = s.cashier_user_id
      left join "user" u on u.id = m.user_id
      left join (select sale_id, sum(amount_xof) as paid from payment where business_id = ${b} and status in ${collected} and confirmed_at < ${end} group by sale_id) p on p.sale_id = s.id
      where s.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end}
      order by s.occurred_at, s.reference limit ${cap + 1}`),
    payments: () => rows<PaymentExportRow>(db, sql`select ${stamp(sql`p.occurred_at`)} as "occurredAt", ${stamp(sql`p.confirmed_at`)} as "confirmedAt",
        s.reference as "saleReference", p.method, p.status, p.amount_xof::text as "amountXof",
        exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id) as settlement,
        (p.status in ${collected} and p.confirmed_at >= ${start} and p.confirmed_at < ${end}) as "collectedInPeriod", u.name as "recordedBy"
      from payment p
      join sale s on s.business_id = p.business_id and s.id = p.sale_id
      left join member m on m.organization_id = p.business_id and m.user_id = p.recorded_by_user_id
      left join "user" u on u.id = m.user_id
      where p.business_id = ${b} and ((p.occurred_at >= ${start} and p.occurred_at < ${end}) or (p.confirmed_at >= ${start} and p.confirmed_at < ${end}))
      order by coalesce(p.confirmed_at, p.occurred_at), p.id limit ${cap + 1}`),
    products: () => rows<ProductExportRow>(db, sql`select p.name, v.label as variant, v.sku, v.barcode, c.name as category, p.base_unit as unit,
        v.sale_price_xof::text as "salePriceXof", round(v.average_cost_xof)::bigint::text as "averageCostXof", v.cost_known as "costKnown",
        v.on_hand::text as "onHand", v.low_stock_threshold::text as "lowStockThreshold"
      from product_variant v
      join product p on p.business_id = v.business_id and p.id = v.product_id
      left join product_category c on c.business_id = p.business_id and c.id = p.category_id
      where v.business_id = ${b} and v.archived_at is null and p.archived_at is null
      order by p.name, v.label, v.id limit ${cap + 1}`),
    stock: () => rows<StockExportRow>(db, sql`select ${stamp(sql`m.occurred_at`)} as "occurredAt", p.name as product, v.label as variant, m.reason,
        m.quantity_delta::text as "quantityDelta", round(m.unit_cost_xof)::bigint::text as "unitCostXof", u.name as "createdBy"
      from stock_movement m
      join product_variant v on v.business_id = m.business_id and v.id = m.variant_id
      join product p on p.business_id = v.business_id and p.id = v.product_id
      left join member mb on mb.organization_id = m.business_id and mb.user_id = m.created_by_user_id
      left join "user" u on u.id = mb.user_id
      where m.business_id = ${b} and m.occurred_at >= ${start} and m.occurred_at < ${end}
      order by m.occurred_at, m.id limit ${cap + 1}`),
    customers: () => rows<CustomerExportRow>(db, sql`select c.name, c.phone, c.notes, to_char(c.created_at at time zone ${tz}, 'YYYY-MM-DD') as "createdAt"
      from customer c where c.business_id = ${b} order by c.name, c.id limit ${cap + 1}`),
    // Mêmes définitions que receivablesAsOf et openingCustomerRows de reports.ts, ventilées par client.
    receivables: () => rows<ReceivableExportRow>(db, sql`with sales_due as (
        select s.customer_id, count(*) as unpaid, sum(s.total_xof - coalesce(p.paid, 0)) as due
        from sale s left join (select sale_id, sum(amount_xof) as paid from payment where business_id = ${b} and status in ${collected} and confirmed_at < ${end} group by sale_id) p on p.sale_id = s.id
        where s.business_id = ${b} and s.customer_id is not null and s.status <> 'voided' and s.occurred_at < ${end} and s.total_xof > coalesce(p.paid, 0)
        group by s.customer_id
      ), opening_due as (
        select ob.customer_id, greatest(ob.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op
          where op.business_id = ob.business_id and op.opening_balance_id = ob.id and op.occurred_at < ${end}), 0), 0) as due
        from opening_balance ob where ob.business_id = ${b} and ob.party_type = 'customer' and ob.created_at < ${end}
      )
      select c.name, c.phone, coalesce(sd.unpaid, 0)::text as "unpaidSales", coalesce(sd.due, 0)::text as "salesDueXof",
        coalesce(od.due, 0)::text as "openingDueXof", (coalesce(sd.due, 0) + coalesce(od.due, 0))::text as "totalDueXof"
      from customer c left join sales_due sd on sd.customer_id = c.id left join opening_due od on od.customer_id = c.id
      where c.business_id = ${b} and coalesce(sd.due, 0) + coalesce(od.due, 0) > 0
      order by coalesce(sd.due, 0) + coalesce(od.due, 0) desc, c.name, c.id limit ${cap + 1}`),
    // Mêmes définitions que supplierDebt de reports.ts (achats reçus − paiements + ancienne dette), par fournisseur.
    suppliers: () => rows<SupplierExportRow>(db, sql`with bought as (
        select supplier_id, coalesce(sum(total_xof) filter (where occurred_at < ${end}), 0) as to_end,
          coalesce(sum(total_xof) filter (where occurred_at >= ${start} and occurred_at < ${end}), 0) as in_period,
          count(*) filter (where occurred_at >= ${start} and occurred_at < ${end}) as count_in_period
        from purchase where business_id = ${b} and status = 'received' group by supplier_id
      ), paid as (
        select pu.supplier_id, sum(pp.amount_xof) as paid from purchase_payment pp join purchase pu on pu.business_id = pp.business_id and pu.id = pp.purchase_id
        where pp.business_id = ${b} and pu.status = 'received' and pp.occurred_at < ${end} group by pu.supplier_id
      ), opening as (
        select ob.supplier_id, greatest(ob.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op
          where op.business_id = ob.business_id and op.opening_balance_id = ob.id and op.occurred_at < ${end}), 0), 0) as due
        from opening_balance ob where ob.business_id = ${b} and ob.party_type = 'supplier' and ob.created_at < ${end}
      ), due as (
        select s.id, s.name, s.phone, s.archived_at is not null as archived, coalesce(bo.count_in_period, 0) as purchase_count, coalesce(bo.in_period, 0) as purchased,
          coalesce(bo.to_end, 0) - coalesce(pa.paid, 0) as purchases_due, coalesce(op.due, 0) as opening_due
        from supplier s left join bought bo on bo.supplier_id = s.id left join paid pa on pa.supplier_id = s.id left join opening op on op.supplier_id = s.id
        where s.business_id = ${b}
      )
      select name, phone, archived, purchase_count::text as "purchaseCount", purchased::text as "purchasedXof", purchases_due::text as "purchasesDueXof",
        opening_due::text as "openingDueXof", (purchases_due + opening_due)::text as "totalDueXof"
      from due where not archived or purchases_due + opening_due <> 0 or purchased <> 0
      order by name, id limit ${cap + 1}`),
    purchases: () => rows<PurchaseExportRow>(db, sql`select ${stamp(sql`pu.occurred_at`)} as "occurredAt", pu.reference, s.name as supplier, pu.status,
        pu.total_xof::text as "totalXof", paid.amount::text as "paidXof",
        (case when pu.status = 'received' then greatest(pu.total_xof - paid.amount, 0) else 0 end)::text as "dueXof"
      from purchase pu
      join supplier s on s.business_id = pu.business_id and s.id = pu.supplier_id
      cross join lateral (select coalesce(sum(pp.amount_xof), 0) as amount from purchase_payment pp
        where pp.business_id = pu.business_id and pp.purchase_id = pu.id and pp.occurred_at < ${end}) paid
      where pu.business_id = ${b} and pu.occurred_at >= ${start} and pu.occurred_at < ${end}
      order by pu.occurred_at, pu.reference limit ${cap + 1}`),
    expenses: () => rows<ExpenseExportRow>(db, sql`select ${stamp(sql`e.occurred_at`)} as "occurredAt", e.category, e.description, e.payment_method as method,
        e.amount_xof::text as "amountXof", u.name as "paidBy"
      from expense e
      left join member m on m.organization_id = e.business_id and m.user_id = e.paid_by_user_id
      left join "user" u on u.id = m.user_id
      where e.business_id = ${b} and e.occurred_at >= ${start} and e.occurred_at < ${end}
      order by e.occurred_at, e.id limit ${cap + 1}`),
  };

  const sheets = {} as Record<ExportSheetKey, { rows: unknown[]; truncated: boolean } | null>;
  const omitted: ExportSheetKey[] = [];
  const truncated: ExportSheetKey[] = [];
  // Une requête à la fois : un export est rare, inutile d'ouvrir neuf connexions d'un coup (constat D-1).
  for (const key of exportSheetKeys) {
    if (!hasBusinessPermission(membership.role, sheetPermission[key], "read")) { sheets[key] = null; omitted.push(key); continue; }
    const found: unknown[] = await queries[key]();
    if (found.length > cap) {
      if (periodSheets.has(key)) {
        throw new CommercialError(`Plus de ${cap} lignes à exporter pour une même feuille : choisissez une période plus courte.`, 422, "export_too_large");
      }
      truncated.push(key);
      sheets[key] = { rows: found.slice(0, cap), truncated: true };
    } else sheets[key] = { rows: found, truncated: false };
  }
  return { businessName, report, sheets: sheets as ExportSheets, omitted, truncated, limit: cap };
}
