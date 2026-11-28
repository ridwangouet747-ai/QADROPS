import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale, type CommercialDatabase } from "./commercial";
import {
  createBusinessCustomer, createBusinessExpense, createBusinessSupplier, createReceivedPurchase, getBusinessOverview, getBusinessSale,
  getStockWorkspace, listBusinessCustomers, listBusinessCustomersPage, listBusinessExpenses, listBusinessExpensesPage,
  listBusinessPurchases, listBusinessPurchasesPage, listBusinessSales, listBusinessSalesPage, listBusinessSuppliers,
  listBusinessSuppliersPage, listStockItemsPage, recordCustomerPayment,
} from "./business-data";
import { INVENTORY_MAX_LINES, listInventorySessions, startInventory, submitInventory, validateInventory } from "./inventory";
import { createPlatformPlan, getPlatformBusiness, getPlatformOverview, listPlatformBusinesses, listPlatformSubscriptions } from "./platform";
import { getCommercialReport, getDashboardReports } from "./reports";
import { effectiveSubscriptionStatus, expireDueSubscriptions } from "./subscription-lifecycle";

/*
 * Mission 11, phase 6 (performance et base) : chaque optimisation garde exactement le comportement
 * précédent. Ces tests figent les écritures groupées, la pagination par curseur (avec isolation A/B),
 * l'équivalence des rapports bornés à la période, le plafond d'inventaire et les lectures sans écriture.
 */

type Page<T> = { items: T[]; nextCursor: string | null };

/** Parcourt toutes les pages d'une liste et vérifie qu'aucune page ne dépasse la limite. */
async function walk<T>(fetchPage: (raw: Record<string, string>) => Promise<Page<T>>, limit = 2) {
  const all: T[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const page: Page<T> = await fetchPage(cursor ? { limit: String(limit), cursor } : { limit: String(limit) });
    expect(page.items.length).toBeLessThanOrEqual(limit);
    all.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) return all;
  }
  throw new Error("Pagination sans fin");
}

describe("performance : écritures groupées, pagination et rapports bornés (PGlite isolé)", () => {
  const client = new PGlite();
  const queries: string[] = [];
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const countedDb = drizzle(client, { schema: databaseSchema, logger: { logQuery: (query) => { queries.push(query); } } }) as unknown as CommercialDatabase;
  const A = "perf-biz-a";
  const B = "perf-biz-b";
  const ownerA = "perf-owner-a";
  const ownerB = "perf-owner-b";
  const ctxA = { businessId: A, actorUserId: ownerA };
  const ctxB = { businessId: B, actorUserId: ownerB };
  const variantsA: string[] = [];
  let variantB = "";

  const backdateSale = async (saleId: string, iso: string) => {
    await client.query("update sale set occurred_at=$2 where id=$1", [saleId, iso]);
    await client.query("update payment set occurred_at=$2, confirmed_at=case when status='confirmed' then $2::timestamptz else null end where sale_id=$1", [saleId, iso]);
    await client.query("update stock_movement set occurred_at=$2 where sale_line_id in (select id from sale_line where sale_id=$1)", [saleId, iso]);
  };
  const backdatePayment = (paymentId: string, iso: string) => client.query("update payment set occurred_at=$2, confirmed_at=$2 where id=$1", [paymentId, iso]);

  beforeAll(async () => {
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query(`insert into "user"(id,name,email) values ($1,'Awa A','awa@perf.test'),($2,'Bakary B','bakary@perf.test')`, [ownerA, ownerB]);
    for (const id of [A, B]) {
      await client.query("insert into organization(id,name,slug) values ($1,'Perf',$1)", [id]);
      await client.query("insert into business_profile(business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('perf-m-a',$1,$2,'owner'),('perf-m-b',$3,$4,'owner')", [A, ownerA, B, ownerB]);
    for (let index = 1; index <= 20; index += 1) {
      variantsA.push((await createProduct(db, { ...ctxA, name: `Article ${String(index).padStart(2, "0")}`, salePriceXof: "100" })).variantId);
    }
    variantB = (await createProduct(db, { ...ctxB, name: "Article B", salePriceXof: "100" })).variantId;
    await client.query("update product_variant set on_hand='1000', average_cost_xof='40', cost_known=true");
  });

  afterAll(async () => { await client.close(); });

  it("vente de 20 lignes : un seul verrou trié, stock, mouvements et paiements écrits en lots", async () => {
    const before = await client.query<{ id: string; on_hand: string; stock_revision: string }>("select id, on_hand, stock_revision from product_variant where business_id=$1", [A]);
    // Depuis 0027, le Wave déclaré par le caissier est confirmé à la saisie (aucune passerelle) ; le client reste facultatif mais conservé ici.
    const customerId = (await createBusinessCustomer(db, { ...ctxA, name: "Client caisse" })).id;
    queries.length = 0;
    const sale = await createSale(countedDb, { ...ctxA, customerId, idempotencyKey: "perf-sale-20-lines",
      lines: [...variantsA].reverse().map((variantId) => ({ variantId, quantity: "2" })),
      payments: [{ method: "cash", amountXof: "3000" }, { method: "wave", amountXof: "1000" }] });
    const used = queries.length;
    // Avant la phase 6 : 71 requêtes (3 par ligne) ; désormais un nombre fixe, indépendant du nombre de lignes.
    expect(used).toBeLessThanOrEqual(20);
    const locks = queries.filter((query) => /"product_variant"/.test(query) && /for update/i.test(query));
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatch(/order by "product_variant"\."id"/i);

    const after = await client.query<{ id: string; on_hand: string; stock_revision: string }>("select id, on_hand, stock_revision from product_variant where business_id=$1", [A]);
    const old = new Map(before.rows.map((row) => [row.id, row]));
    for (const row of after.rows) {
      expect(Number(row.on_hand)).toBe(Number(old.get(row.id)!.on_hand) - 2);
      expect(BigInt(row.stock_revision)).toBe(BigInt(old.get(row.id)!.stock_revision) + 1n);
    }
    const movements = await client.query<{ quantity_delta: string; sale_line_id: string; variant_id: string }>(
      "select m.quantity_delta, m.sale_line_id, m.variant_id from stock_movement m join sale_line l on l.business_id=m.business_id and l.id=m.sale_line_id where l.sale_id=$1", [sale.id]);
    expect(movements.rows).toHaveLength(20);
    expect(new Set(movements.rows.map((row) => row.variant_id))).toEqual(new Set(variantsA));
    expect(movements.rows.every((row) => Number(row.quantity_delta) === -2)).toBe(true);
    const payments = await client.query<{ method: string; status: string; idempotency_key: string; amount_xof: string }>(
      "select method, status, idempotency_key, amount_xof::text from payment where sale_id=$1 order by idempotency_key", [sale.id]);
    expect(payments.rows).toEqual([
      { method: "cash", status: "confirmed", idempotency_key: "perf-sale-20-lines:0", amount_xof: "3000" },
      { method: "wave", status: "confirmed", idempotency_key: "perf-sale-20-lines:1", amount_xof: "1000" },
    ]);
    // Une répétition réseau ne réécrit rien.
    const replay = await createSale(db, { ...ctxA, customerId, idempotencyKey: "perf-sale-20-lines",
      lines: [...variantsA].reverse().map((variantId) => ({ variantId, quantity: "2" })),
      payments: [{ method: "cash", amountXof: "3000" }, { method: "wave", amountXof: "1000" }] });
    expect(replay).toMatchObject({ id: sale.id, replayed: true });
    expect((await client.query("select 1 from stock_movement where business_id=$1", [A])).rows).toHaveLength(20);
  });

  it("rapports bornés à la période : mêmes chiffres que les requêtes historiques non bornées (D-3)", async () => {
    const customerId = (await createBusinessCustomer(db, { ...ctxA, name: "Client crédit" })).id;
    const [v1, v2, v3] = variantsA;
    // Août : vente à crédit, 200 payés à la vente, 300 réglés en septembre, 500 en octobre.
    const s1 = await createSale(db, { ...ctxA, customerId, idempotencyKey: "perf-d3-s1", lines: [{ variantId: v1!, quantity: "10" }], payments: [{ method: "cash", amountXof: "200" }] });
    await backdateSale(s1.id, "2026-08-10T10:00:00Z");
    // Septembre : vente mixte (espèces + Wave déclaré, confirmé à la saisie), soldée en octobre ; vente payée comptant ; vente le même instant.
    const s2 = await createSale(db, { ...ctxA, customerId, idempotencyKey: "perf-d3-s2", lines: [{ variantId: v2!, quantity: "10" }], payments: [{ method: "cash", amountXof: "100" }, { method: "wave", amountXof: "100" }] });
    await backdateSale(s2.id, "2026-09-12T10:00:00Z");
    const s3 = await createSale(db, { ...ctxA, idempotencyKey: "perf-d3-s3", lines: [{ variantId: v3!, quantity: "5" }], payments: [{ method: "cash", amountXof: "500" }] });
    await backdateSale(s3.id, "2026-09-20T08:00:00Z");
    const s3bis = await createSale(db, { ...ctxA, idempotencyKey: "perf-d3-s3bis", lines: [{ variantId: v3!, quantity: "1" }], payments: [{ method: "cash", amountXof: "100" }] });
    await backdateSale(s3bis.id, "2026-09-20T08:00:00Z");
    // Octobre : nouvelle vente à crédit, hors de la période de septembre.
    const s4 = await createSale(db, { ...ctxA, customerId, idempotencyKey: "perf-d3-s4", lines: [{ variantId: v1!, quantity: "3" }], payments: [] });
    await backdateSale(s4.id, "2026-10-03T10:00:00Z");
    const p1 = await recordCustomerPayment(db, { ...ctxA, idempotencyKey: "perf-d3-p1", saleId: s1.id, amountXof: "300", method: "cash" });
    await backdatePayment(p1.paymentId, "2026-09-05T10:00:00Z");
    const p2 = await recordCustomerPayment(db, { ...ctxA, idempotencyKey: "perf-d3-p2", saleId: s1.id, amountXof: "500", method: "wave" });
    await backdatePayment(p2.paymentId, "2026-10-05T10:00:00Z");
    const p3 = await recordCustomerPayment(db, { ...ctxA, idempotencyKey: "perf-d3-p3", saleId: s2.id, amountXof: "400", method: "cash" });
    await backdatePayment(p3.paymentId, "2026-10-02T10:00:00Z");

    const collected = "('confirmed','partially_refunded','refunded')";
    const sold = "('completed','partially_refunded','refunded')";
    // Requêtes d'avant la phase 6, recopiées telles quelles : agrégats sur tout l'historique des paiements du commerce.
    const legacy = async (start: Date, end: Date) => {
      const one = async (text: string) => (await client.query<Record<string, string>>(text, [A, start.toISOString(), end.toISOString()])).rows[0]!;
      const settlement = await one(`select
        count(*) filter (where coalesce(p.paid, 0) >= s.total_xof)::text as paid,
        count(*) filter (where coalesce(p.paid, 0) > 0 and coalesce(p.paid, 0) < s.total_xof)::text as partial,
        count(*) filter (where coalesce(p.paid, 0) = 0 and s.customer_id is not null)::text as credit,
        count(*) filter (where coalesce(p.methods, 0) >= 2)::text as mixed
        from sale s left join (select sale_id, sum(amount_xof) filter (where status in ${collected} and confirmed_at < $3::timestamptz) as paid,
          count(distinct method) filter (where status <> 'failed') as methods from payment where business_id = $1 group by sale_id) p on p.sale_id = s.id
        where s.business_id = $1 and s.status <> 'voided' and s.occurred_at >= $2::timestamptz and s.occurred_at < $3::timestamptz`);
      const receivables = await one(`select count(*)::text as count, coalesce(sum(s.total_xof - coalesce(p.paid, 0)), 0)::text as total
        from sale s left join (select sale_id, sum(amount_xof) as paid from payment where business_id = $1 and status in ${collected} and confirmed_at < $3::timestamptz group by sale_id) p on p.sale_id = s.id
        where s.business_id = $1 and s.customer_id is not null and s.status <> 'voided' and s.occurred_at < $3::timestamptz and s.total_xof > coalesce(p.paid, 0) and $2::timestamptz is not null`);
      const core = await one(`select
        (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = $1 and p.status in ${collected} and p.confirmed_at >= $2::timestamptz and p.confirmed_at < $3::timestamptz)::text as collected,
        (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = $1 and p.status in ${collected} and p.confirmed_at >= $2::timestamptz and p.confirmed_at < $3::timestamptz
          and exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id))::text as settlements,
        (select coalesce(sum(greatest(s.total_xof - coalesce((select sum(p.amount_xof) from payment p where p.business_id = s.business_id and p.sale_id = s.id and p.status <> 'failed'
            and not exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id)), 0), 0)), 0)
          from sale s where s.business_id = $1 and s.customer_id is not null and s.occurred_at >= $2::timestamptz and s.occurred_at < $3::timestamptz and s.status in ${sold})::text as credit_granted`);
      return { settlement, receivables, core };
    };

    const now = new Date("2026-10-31T12:00:00Z");
    for (const date of ["2026-08-15", "2026-09-15", "2026-10-15"]) {
      const report = await getCommercialReport(db, { ...ctxA, period: "monthly", date }, now);
      const reference = await legacy(new Date(`${report.startDate}T00:00:00Z`), new Date(report.receivablesAsOf.asOf));
      expect(report.settlement, date).toEqual({ paid: reference.settlement.paid, partial: reference.settlement.partial, credit: reference.settlement.credit, mixed: reference.settlement.mixed });
      expect(report.receivablesAsOf, date).toMatchObject({ totalXof: reference.receivables.total, count: reference.receivables.count });
      expect(report.collections, date).toMatchObject({ totalXof: reference.core.collected, settlementsXof: reference.core.settlements });
      expect(report.credit.grantedXof, date).toBe(reference.core.credit_granted);
    }
    // Contrôle à la main sur septembre : les règlements d'octobre ne comptent pas, ceux de septembre si.
    const september = await getCommercialReport(db, { ...ctxA, period: "monthly", date: "2026-09-15" }, now);
    // 100 + 100 (Wave) + 500 + 100 à la vente, 300 de règlement : 1 100.
    expect(september.collections).toMatchObject({ totalXof: "1100", settlementsXof: "300" });
    expect(september.settlement).toEqual({ paid: "2", partial: "1", credit: "0", mixed: "1" });
    // Fin septembre : vente d'août (1 000 − 200 − 300) et vente de septembre (1 000 − 100), Wave en attente exclu.
    // Wave de septembre (100) confirmé à la saisie depuis 0027 : reste 1 300.
    expect(september.receivablesAsOf).toMatchObject({ totalXof: "1300", count: "2" });
  });

  it("tableau de bord : résumés groupés identiques au rapport du jour et de la semaine", async () => {
    const now = new Date("2026-09-20T15:00:00Z");
    const grouped = await getDashboardReports(db, { ...ctxA, timezone: "Africa/Abidjan", date: "2026-09-20" }, now);
    expect(grouped.today).toEqual(await getCommercialReport(db, { ...ctxA, period: "daily", date: "2026-09-20", detail: "summary" }, now));
    expect(grouped.week).toEqual(await getCommercialReport(db, { ...ctxA, period: "weekly", date: "2026-09-20", detail: "summary" }, now));
    const overview = await getBusinessOverview(db, ctxA);
    expect(Object.keys(overview).sort()).toEqual(["business", "date", "lowStock", "recentActivity", "recentSales", "today", "week"]);
    expect(overview.business).toMatchObject({ name: "Perf", timezone: "Africa/Abidjan" });
    await expect(getBusinessOverview(db, { businessId: A, actorUserId: ownerB })).rejects.toMatchObject({ status: 403 });
  });

  it("détail d'une vente : seuls les remboursements de ses paiements, filtrés en SQL", async () => {
    const mine = await createSale(db, { ...ctxA, idempotencyKey: "perf-refund-mine", lines: [{ variantId: variantsA[4]!, quantity: "1" }], payments: [{ method: "cash", amountXof: "100" }] });
    const other = await createSale(db, { ...ctxA, idempotencyKey: "perf-refund-other", lines: [{ variantId: variantsA[5]!, quantity: "1" }], payments: [{ method: "cash", amountXof: "100" }] });
    for (const [id, saleId] of [["perf-rf-1", mine.id], ["perf-rf-2", other.id]]) {
      await client.query("insert into payment_refund(id,business_id,payment_id,amount_xof,status,reference,created_by_user_id) values ($1,$2,(select id from payment where sale_id=$3 limit 1),30,'confirmed',$1,$4)", [id, A, saleId, ownerA]);
    }
    const detail = await getBusinessSale(db, { ...ctxA, saleId: mine.id });
    expect(detail.refunds.map((refund) => refund.id)).toEqual(["perf-rf-1"]);
    await expect(getBusinessSale(db, { ...ctxB, saleId: mine.id })).rejects.toMatchObject({ status: 404 });
  });

  it("pagination par curseur des clients, fournisseurs, stock, ventes, achats et dépenses, isolée par commerce", async () => {
    for (const name of ["Awa", "Awa", "Bintou", "Coulibaly", "Diane"]) await createBusinessCustomer(db, { ...ctxA, name });
    for (const name of ["Zeinab", "Yao"]) await createBusinessCustomer(db, { ...ctxB, name });
    // Soldes clients : identiques à la requête d'avant la phase 6 (agrégat sur tous les paiements du commerce).
    const legacyCustomers = await client.query<{ id: string; saleCount: string; balanceXof: string; openingDueXof: string }>(`select c.id, count(s.id)::text as "saleCount",
      (coalesce(sum(case when s.id is not null then greatest(s.total_xof-coalesce(p.paid,0),0) else 0 end),0) + coalesce(max(ob.remaining),0))::text as "balanceXof",
      coalesce(max(ob.remaining),0)::text as "openingDueXof"
      from customer c left join sale s on s.business_id=c.business_id and s.customer_id=c.id and s.status <> 'voided'
      left join (select b.customer_id, b.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op where op.business_id=b.business_id and op.opening_balance_id=b.id),0) as remaining
        from opening_balance b where b.business_id=$1 and b.customer_id is not null) ob on ob.customer_id=c.id
      left join (select business_id,sale_id,sum(amount_xof) as paid from payment where business_id=$1 and status='confirmed' group by business_id,sale_id) p
        on p.business_id=s.business_id and p.sale_id=s.id
      where c.business_id=$1 group by c.id order by c.name, c.id`, [A]);
    const currentCustomers = (await listBusinessCustomers(db, ctxA)).map(({ id, saleCount, balanceXof, openingDueXof }) => ({ id, saleCount, balanceXof, openingDueXof }));
    expect(currentCustomers).toEqual(legacyCustomers.rows);
    expect(currentCustomers.some((row) => row.balanceXof !== "0")).toBe(true);
    for (const name of ["Fournisseur", "Fournisseur", "Grossiste"]) await createBusinessSupplier(db, { ...ctxA, name });
    const supplierB = (await createBusinessSupplier(db, { ...ctxB, name: "Fournisseur B" })).id;
    const supplierA = (await listBusinessSuppliers(db, ctxA))[0]!.id;
    for (let index = 1; index <= 3; index += 1) {
      await createReceivedPurchase(db, { ...ctxA, supplierId: supplierA, idempotencyKey: `perf-purchase-${index}`, reference: `PERF-${index}`, lines: [{ variantId: variantsA[index]!, quantity: "1", unitCostXof: "40" }] });
      await createBusinessExpense(db, { ...ctxA, idempotencyKey: `perf-expense-${index}`, category: "transport", description: `Course ${index}`, amountXof: "50" });
    }
    await createReceivedPurchase(db, { ...ctxB, supplierId: supplierB, idempotencyKey: "perf-purchase-b", reference: "PERF-B", lines: [{ variantId: variantB, quantity: "1", unitCostXof: "40" }] });
    await createBusinessExpense(db, { ...ctxB, idempotencyKey: "perf-expense-b", category: "transport", description: "Course B", amountXof: "50" });
    await createSale(db, { ...ctxB, idempotencyKey: "perf-sale-b", lines: [{ variantId: variantB, quantity: "1" }], payments: [{ method: "cash", amountXof: "100" }] });
    // Égalités de date : l'identifiant départage, aucune ligne n'est perdue ni répétée entre deux pages.
    await client.query("update purchase set occurred_at='2026-09-01T10:00:00Z' where business_id=$1", [A]);
    await client.query("update expense set occurred_at='2026-09-01T10:00:00Z' where business_id=$1", [A]);

    const lists = [
      { name: "clients", full: (ctx: typeof ctxA) => listBusinessCustomers(db, ctx), page: (ctx: typeof ctxA, raw: object) => listBusinessCustomersPage(db, ctx, raw), key: (row: { id: string }) => row.id },
      { name: "fournisseurs", full: (ctx: typeof ctxA) => listBusinessSuppliers(db, ctx), page: (ctx: typeof ctxA, raw: object) => listBusinessSuppliersPage(db, ctx, raw), key: (row: { id: string }) => row.id },
      { name: "stock", full: async (ctx: typeof ctxA) => (await getStockWorkspace(db, ctx)).items, page: (ctx: typeof ctxA, raw: object) => listStockItemsPage(db, ctx, raw), key: (row: { variantId: string }) => row.variantId },
      { name: "ventes", full: (ctx: typeof ctxA) => listBusinessSales(db, ctx), page: (ctx: typeof ctxA, raw: object) => listBusinessSalesPage(db, ctx, raw), key: (row: { id: string }) => row.id },
      { name: "achats", full: (ctx: typeof ctxA) => listBusinessPurchases(db, ctx), page: (ctx: typeof ctxA, raw: object) => listBusinessPurchasesPage(db, ctx, raw), key: (row: { id: string }) => row.id },
      { name: "dépenses", full: (ctx: typeof ctxA) => listBusinessExpenses(db, ctx), page: (ctx: typeof ctxA, raw: object) => listBusinessExpensesPage(db, ctx, raw), key: (row: { id: string }) => row.id },
    ] as const;

    for (const list of lists) {
      const key = list.key as (row: unknown) => string;
      const fullA = (await list.full(ctxA)) as unknown[];
      const fullB = (await list.full(ctxB)) as unknown[];
      expect(fullA.length, list.name).toBeGreaterThan(2);
      // Même contenu et même ordre que la liste historique, sans recouvrement entre pages.
      const pagedA = await walk((raw) => list.page(ctxA, raw) as Promise<Page<unknown>>);
      expect(pagedA, list.name).toEqual(fullA);
      expect(new Set(pagedA.map(key)).size, list.name).toBe(pagedA.length);
      const idsB = new Set(fullB.map(key));
      expect(fullA.some((row) => idsB.has(key(row))), list.name).toBe(false);
      // Un curseur obtenu dans A, rejoué dans B, ne fait jamais apparaître une ligne de A.
      const first = (await list.page(ctxA, { limit: "1" })) as Page<unknown>;
      expect(first.nextCursor, list.name).not.toBeNull();
      const crossed = (await list.page(ctxB, { limit: "100", cursor: first.nextCursor! })) as Page<unknown>;
      expect(crossed.items.every((row) => idsB.has(key(row))), list.name).toBe(true);
      // Un membre de B ne lit pas les pages de A ; un curseur falsifié est refusé.
      await expect(list.page({ businessId: A, actorUserId: ownerB }, { limit: "2" }), list.name).rejects.toMatchObject({ status: 403 });
      await expect(list.page(ctxA, { limit: "2", cursor: "pas-un-curseur" }), list.name).rejects.toMatchObject({ status: 400 });
    }
    // Les ventes paginées gardent les filtres de dates de la liste historique.
    const septemberSales = await walk((raw) => listBusinessSalesPage(db, ctxA, { ...raw, from: "2026-09-01", to: "2026-09-30" }));
    expect(septemberSales).toEqual(await listBusinessSales(db, ctxA, { from: "2026-09-01", to: "2026-09-30" }));
    expect(septemberSales).toHaveLength(3);
  });
});

describe("inventaire : plafond de lignes et validation par lots (PGlite isolé)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const C = "perf-inventory-biz";
  const counter = "perf-inventory-counter";
  const verifier = "perf-inventory-verifier";

  beforeAll(async () => {
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query(`insert into "user"(id,name,email) values ($1,'Compteur','counter@perf.test'),($2,'Vérificateur','verifier@perf.test')`, [counter, verifier]);
    await client.query("insert into organization(id,name,slug) values ($1,'Inventaire',$1)", [C]);
    await client.query("insert into business_profile(business_id,activity,timezone) values ($1,'hardware','Africa/Abidjan')", [C]);
    await client.query("insert into member(id,organization_id,user_id,role) values ('perf-inv-1',$1,$2,'owner'),('perf-inv-2',$1,$3,'stock_manager')", [C, counter, verifier]);
    await client.query("insert into product_category(id,business_id,name) values ('perf-lot',$1,'Lot')", [C]);
    const count = INVENTORY_MAX_LINES + 1;
    await client.query(`insert into product(id,business_id,name,category_id) select 'perf-p-' || lpad(g::text, 5, '0'), $1, 'Article ' || g, case when g <= 1200 then 'perf-lot' end from generate_series(1, $2::int) g`, [C, count]);
    await client.query(`insert into product_variant(id,business_id,product_id,sale_price_xof,on_hand) select 'perf-v-' || lpad(g::text, 5, '0'), $1, 'perf-p-' || lpad(g::text, 5, '0'), 100, 10 from generate_series(1, $2::int) g`, [C, count]);
  });

  afterAll(async () => { await client.close(); });

  it("refuse un comptage au-delà du plafond avec un code stable, puis accepte une catégorie", async () => {
    await expect(startInventory(db, { businessId: C, actorUserId: counter })).rejects.toMatchObject({ status: 422, code: "inventory_too_large" });
    expect((await client.query("select 1 from inventory_session")).rows).toHaveLength(0);
    await client.query("update product set archived_at=now() where id='perf-p-02001'");
    await expect(startInventory(db, { businessId: C, actorUserId: counter })).resolves.toMatchObject({ scopeCount: INVENTORY_MAX_LINES });
  });

  it("valide 1 200 lignes par lots : 600 ajustements, stock et mouvements exacts, compteurs en une requête", async () => {
    const session = await startInventory(db, { businessId: C, actorUserId: counter, categoryId: "perf-lot" });
    expect(session.scopeCount).toBe(1200);
    // Comptage saisi directement (fixture) : une ligne sur deux présente un écart de +1, avec motif.
    await client.query(`insert into inventory_line(id,business_id,session_id,variant_id,counted_at,theoretical_qty,counted_qty,expected_stock_revision,counted_by_user_id,adjustment_reason)
      select 'perf-line-' || sv.variant_id, sv.business_id, sv.session_id, sv.variant_id, now(), v.on_hand,
        case when right(sv.variant_id, 1)::int % 2 = 1 then v.on_hand + 1 else v.on_hand end, v.stock_revision, $3,
        case when right(sv.variant_id, 1)::int % 2 = 1 then 'Recompté' end
      from inventory_scope_variant sv join product_variant v on v.business_id = sv.business_id and v.id = sv.variant_id
      where sv.business_id = $1 and sv.session_id = $2`, [C, session.id, counter]);
    const sessions = await listInventorySessions(db, { businessId: C, actorUserId: counter });
    expect(sessions.find((item) => item.id === session.id)).toMatchObject({ scopeCount: 1200, countedCount: 1200, categoryName: "Lot" });
    await submitInventory(db, { businessId: C, actorUserId: counter, sessionId: session.id });
    await expect(validateInventory(db, { businessId: C, actorUserId: verifier, sessionId: session.id })).resolves.toMatchObject({ status: "validated", adjustedCount: 600 });
    const stock = await client.query<{ on_hand: string; n: string; rev: string }>(`select on_hand::text, count(*)::text as n, max(stock_revision)::text as rev from product_variant
      where business_id=$1 and product_id in (select id from product where category_id='perf-lot') group by on_hand order by on_hand`, [C]);
    expect(stock.rows).toEqual([{ on_hand: "10.000000", n: "600", rev: "0" }, { on_hand: "11.000000", n: "600", rev: "1" }]);
    const movements = await client.query<{ n: string; total: string }>("select count(*)::text as n, sum(quantity_delta)::text as total from stock_movement where business_id=$1 and reason='inventory_adjustment'", [C]);
    expect(movements.rows[0]).toEqual({ n: "600", total: "600.000000" });
    // Rejouer la validation ne réécrit rien.
    await expect(validateInventory(db, { businessId: C, actorUserId: verifier, sessionId: session.id })).resolves.toMatchObject({ replayed: true });
  });
});

describe("abonnements : statut affiché calculé en lecture, sans écriture (PGlite isolé)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const admin = "perf-platform-admin";
  const D = "perf-sub-biz";
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

  beforeAll(async () => {
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query(`insert into "user"(id,name,email) values ($1,'Admin','admin@perf.test'),('perf-sub-owner','Owner','owner@perf.test')`, [admin]);
    await client.query("insert into platform_admin(user_id) values ($1)", [admin]);
    await client.query("insert into organization(id,name,slug) values ($1,'Essai échu',$1)", [D]);
    await client.query("insert into business_profile(business_id,activity,status) values ($1,'general','active')", [D]);
    await client.query("insert into member(id,organization_id,user_id,role) values ('perf-sub-m',$1,'perf-sub-owner','owner')", [D]);
    const plan = (await createPlatformPlan(db, admin, { code: "PERF", name: "Perf", priceXof: "5000", durationDays: 30, features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } })).id;
    await client.query("insert into business_subscription(id,business_id,plan_id,status,starts_at,ends_at,origin) values ('perf-sub-lapsed',$1,$2,'trialing',$3,$4,'promotion')", [D, plan, day(-30), day(-1)]);
  });

  afterAll(async () => { await client.close(); });

  it("effectiveSubscriptionStatus : essai ou abonnement actif échu lu « expired », le reste inchangé", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const fixed = "fixed_duration";
    expect(effectiveSubscriptionStatus({ status: "trialing", endsAt: now, durationKind: fixed }, now)).toBe("expired");
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: new Date("2026-10-01T00:00:00Z"), durationKind: fixed }, now)).toBe("expired");
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: new Date("2026-12-01T00:00:00Z"), durationKind: fixed }, now)).toBe("active");
    expect(effectiveSubscriptionStatus({ status: "suspended", endsAt: new Date("2026-10-01T00:00:00Z"), durationKind: fixed }, now)).toBe("suspended");
    // Accès permanent : jamais lu « expired », même des années plus tard.
    expect(effectiveSubscriptionStatus({ status: "active", endsAt: null, durationKind: "lifetime" }, new Date("2046-01-01T00:00:00Z"))).toBe("active");
  });

  it("la console affiche l'essai échu comme expiré sans écrire ; seul le passage planifié écrit", async () => {
    await getPlatformOverview(db, admin);
    const listed = await listPlatformSubscriptions(db, admin);
    expect(listed.subscriptions.find((item) => item.id === "perf-sub-lapsed")).toMatchObject({ status: "expired", remainingDays: 0 });
    expect((await listPlatformBusinesses(db, admin)).find((item) => item.businessId === D)).toMatchObject({ lifecycle: "expired", subscription: { status: "expired" } });
    expect((await getPlatformBusiness(db, admin, D)).subscriptions[0]).toMatchObject({ status: "expired" });
    expect((await listPlatformSubscriptions(db, admin, { status: "expired" })).subscriptions.map((item) => item.id)).toEqual(["perf-sub-lapsed"]);
    expect((await listPlatformSubscriptions(db, admin, { status: "trialing" })).subscriptions).toHaveLength(0);
    const stored = await client.query<{ status: string }>("select status from business_subscription where id='perf-sub-lapsed'");
    expect(stored.rows[0]!.status).toBe("trialing");
    expect((await client.query("select 1 from audit_event where event_type='subscription.expired'")).rows).toHaveLength(0);
    await expect(expireDueSubscriptions(db)).resolves.toEqual({ expired: 1 });
    expect((await listPlatformSubscriptions(db, admin)).subscriptions.find((item) => item.id === "perf-sub-lapsed")).toMatchObject({ status: "expired" });
  });
});
