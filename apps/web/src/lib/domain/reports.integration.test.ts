import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import { createBusinessCustomer, createBusinessExpense, recordCustomerPayment } from "./business-data";
import { createOpeningBalance, postStockOpening, recordOpeningBalancePayment } from "./opening";
import { csvCell } from "../exports/csv";
import { changeBasisPoints, getCommercialReport, reportCsv, reportRange } from "./reports";

describe("périodes des rapports (fonctions pures)", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("jour : de minuit à minuit dans le fuseau du commerce", () => {
    const range = reportRange({ period: "daily", date: "2026-10-18" }, "Africa/Abidjan", now);
    expect(range).toMatchObject({ startDate: "2026-10-18", endDate: "2026-10-18", previousStartDate: "2026-10-17" });
    expect(range.start.toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    // Le fuseau est bien celui du commerce : à Lagos (UTC+1), la journée commence à 23 h UTC la veille.
    expect(reportRange({ period: "daily", date: "2026-10-18" }, "Africa/Lagos", now).start.toISOString()).toBe("2026-10-17T23:00:00.000Z");
  });
  it("semaine du lundi au dimanche, y compris à cheval sur deux années", () => {
    expect(reportRange({ period: "weekly", date: "2026-11-01" }, "Africa/Abidjan", now)).toMatchObject({ startDate: "2026-10-26", endDate: "2026-11-01", previousStartDate: "2026-10-19", previousEndDate: "2026-10-25" });
    expect(reportRange({ period: "weekly", date: "2026-10-26" }, "Africa/Abidjan", now)).toMatchObject({ startDate: "2026-10-26", endDate: "2026-11-01" });
    const yearTurn = reportRange({ period: "weekly", date: "2027-01-01" }, "Africa/Abidjan", now);
    expect(yearTurn).toMatchObject({ startDate: "2026-12-28", endDate: "2027-01-03" });
    expect(yearTurn.buckets).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });
  it("mois civil, changement d'année et mois de février", () => {
    expect(reportRange({ period: "monthly", date: "2027-01-15" }, "Africa/Abidjan", now)).toMatchObject({ startDate: "2027-01-01", endDate: "2027-01-31", previousStartDate: "2026-12-01", previousEndDate: "2026-12-31" });
    expect(reportRange({ period: "monthly", date: "2026-12-31" }, "Africa/Abidjan", now).end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(reportRange({ period: "monthly", date: "2028-02-10" }, "Africa/Abidjan", now).buckets).toHaveLength(29);
    expect(reportRange({ period: "yearly", date: "2026-06-01" }, "Africa/Abidjan", now).buckets).toHaveLength(12);
  });
  it("période personnalisée comparée à la période de même durée qui précède, et bornée", () => {
    expect(reportRange({ period: "custom", startDate: "2026-10-10", endDate: "2026-10-16" }, "Africa/Abidjan", now)).toMatchObject({ previousStartDate: "2026-10-03", previousEndDate: "2026-10-09" });
    expect(() => reportRange({ period: "custom", startDate: "2026-10-16", endDate: "2026-10-10" }, "Africa/Abidjan", now)).toThrow(/entre 1 et 366/);
    expect(() => reportRange({ period: "custom", startDate: "2026-02-30", endDate: "2026-03-01" }, "Africa/Abidjan", now)).toThrow(/invalide/);
  });
  it("variations en points de base et cellules CSV neutralisées", () => {
    expect(changeBasisPoints(150n, 100n)).toBe("5000");
    expect(changeBasisPoints(50n, 100n)).toBe("-5000");
    expect(changeBasisPoints(10n, 0n)).toBeNull();
    expect(csvCell("=SOMME(A1)")).toBe(`"'=SOMME(A1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell('Ciment "Dangote"')).toBe(`"Ciment ""Dangote"""`);
  });
});

describe("rapports commerciaux sur PGlite isolé", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const biz = "rep-biz";
  const other = "rep-other";
  const owner = "rep-owner";
  const cashier = "rep-cashier";
  const outsider = "rep-outsider";
  const now = new Date("2026-10-31T12:00:00Z");
  let costed = "";
  let uncosted = "";
  let customer = "";
  const keys = (() => { let n = 0; return (label: string) => `${label}-key-${String(++n).padStart(4, "0")}`; })();
  const at = async (table: string, id: string, iso: string, column = "occurred_at") => client.query(`update ${table} set ${column}=$2 where id=$1`, [id, iso]);
  const saleAt = async (saleId: string, iso: string) => {
    await at("sale", saleId, iso);
    await client.query("update payment set occurred_at=$2, confirmed_at=case when status='confirmed' then $2::timestamptz else null end where sale_id=$1", [saleId, iso]);
    // Sorties de stock de la vente à la même date : sinon elles gardent la date réelle d'exécution du test.
    await client.query("update stock_movement set occurred_at=$2 where sale_line_id in (select id from sale_line where sale_id=$1)", [saleId, iso]);
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, name] of [[owner, "Awa"], [cashier, "Bakary"], [outsider, "Ehouman"]]) await client.query(`insert into "user"(id,name,email) values ($1,$2,$3)`, [id, name, `${id}@rep.test`]);
    for (const id of [biz, other]) {
      await client.query("insert into organization(id,name,slug) values ($1,'Rapports',$1)", [id]);
      await client.query("insert into business_profile(business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('rm-o',$1,$2,'owner'),('rm-c',$1,$3,'cashier'),('rm-x',$4,$5,'owner')", [biz, owner, cashier, other, outsider]);
    await client.query("insert into product_category(id,business_id,name) values ('cat-boissons',$1,'Boissons')", [biz]);
    costed = (await createProduct(db, { businessId: biz, actorUserId: owner, name: "Riz 5 kg", salePriceXof: "4000", categoryId: "cat-boissons" })).variantId;
    uncosted = (await createProduct(db, { businessId: biz, actorUserId: owner, name: "Savon", salePriceXof: "500" })).variantId;
    // Stock d'ouverture : il ne crée aucun chiffre d'affaires. Le riz a un coût connu (3 000), le savon non.
    await postStockOpening(db, { businessId: biz, actorUserId: owner, idempotencyKey: keys("opening"), referenceDate: "2026-10-01",
      lines: [{ variantId: costed, quantity: "100", unitCostXof: "3000" }, { variantId: uncosted, quantity: "100" }] }, now);
    customer = (await createBusinessCustomer(db, { businessId: biz, actorUserId: owner, name: "Client" })).id;

    // Lundi 19 octobre (semaine précédente) : 1 riz en espèces.
    const s0 = await createSale(db, { businessId: biz, actorUserId: owner, idempotencyKey: keys("sale"), lines: [{ variantId: costed, quantity: "1" }], payments: [{ method: "cash", amountXof: "4000" }] });
    await saleAt(s0.id, "2026-10-19T10:00:00Z");
    // Lundi 26 octobre : 2 riz, paiement mixte 5 000 espèces + 3 000 Wave en attente, client.
    const s1 = await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: keys("sale"), customerId: customer, lines: [{ variantId: costed, quantity: "2" }],
      payments: [{ method: "cash", amountXof: "5000" }, { method: "wave", amountXof: "3000" }] });
    // Wave saisi avant la migration 0027, alors enregistré « en attente » : l'historique garde ce statut et reste exclu des encaissements.
    await client.query("update payment set status='pending', confirmed_at=null where sale_id=$1 and method='wave'", [s1.id]);
    await saleAt(s1.id, "2026-10-26T23:30:00Z");
    // Mardi 27 à 00 h 10 (Abidjan = UTC) : 4 savons à crédit (aucun paiement).
    const s2 = await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: keys("sale"), customerId: customer, lines: [{ variantId: uncosted, quantity: "4" }] });
    await saleAt(s2.id, "2026-10-27T00:10:00Z");
    // Règlement du crédit le 28 (1 500 espèces).
    await recordCustomerPayment(db, { businessId: biz, actorUserId: cashier, idempotencyKey: keys("receivable"), saleId: s2.id, amountXof: "1500", method: "cash" });
    await client.query("update payment set confirmed_at='2026-10-28T09:00:00Z', occurred_at='2026-10-28T09:00:00Z' where sale_id=$1", [s2.id]);
    // Dépenses du 27 : 2 000 espèces (transport), 1 000 Orange Money (internet).
    const e1 = await createBusinessExpense(db, { businessId: biz, actorUserId: owner, idempotencyKey: keys("expense"), category: "transport", description: "Taxi", amountXof: "2000", paymentMethod: "cash" });
    const e2 = await createBusinessExpense(db, { businessId: biz, actorUserId: owner, idempotencyKey: keys("expense"), category: "internet", description: "Forfait", amountXof: "1000", paymentMethod: "orange_money" });
    await at("expense", e1.id, "2026-10-27T08:00:00Z");
    await at("expense", e2.id, "2026-10-27T09:00:00Z");
    // Ancienne dette client de 6 000, dont 2 500 remboursés le 29 : ni vente, ni chiffre d'affaires.
    const ob = await createOpeningBalance(db, { businessId: biz, actorUserId: owner, idempotencyKey: keys("ob"), partyType: "customer", partyId: customer, amountXof: "6000", asOfDate: "2026-10-01" }, now);
    await client.query("update opening_balance set created_at='2026-10-01T00:00:00Z' where id=$1", [ob.id]);
    await recordOpeningBalancePayment(db, { businessId: biz, actorUserId: cashier, idempotencyKey: keys("obpay"), openingBalanceId: ob.id, amountXof: "2500", method: "cash" });
    await client.query("update opening_balance_payment set occurred_at='2026-10-29T10:00:00Z' where opening_balance_id=$1", [ob.id]);
    // Un autre commerce vend le même jour : il ne doit jamais apparaître dans les chiffres de biz.
    await client.query("insert into product(id,business_id,name) values ('other-p',$1,'Autre')", [other]);
    await client.query("insert into product_variant(id,business_id,product_id,sale_price_xof,on_hand) values ('other-v',$1,'other-p',99999,10)", [other]);
    const foreign = await createSale(db, { businessId: other, actorUserId: outsider, idempotencyKey: keys("sale"), lines: [{ variantId: "other-v", quantity: "1" }], payments: [{ method: "cash", amountXof: "99999" }] });
    await saleAt(foreign.id, "2026-10-27T12:00:00Z");
  });
  afterAll(async () => { await client.close(); });

  const weekly = () => getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "weekly", date: "2026-10-28" }, now);

  it("chiffre d'affaires, ventes, quantités et catégories de la semaine lundi-dimanche", async () => {
    const report = await weekly();
    expect(report).toMatchObject({ startDate: "2026-10-26", endDate: "2026-11-01", previousStartDate: "2026-10-19" });
    expect(report.sales).toMatchObject({ revenueXof: "10000", count: "2", itemsSold: "6.000000", previousRevenueXof: "4000", changePercent: "15000" });
    expect(report.sales.byCategory).toEqual([{ category: "Boissons", quantity: "2.000000", revenueXof: "8000" }, { category: null, quantity: "4.000000", revenueXof: "2000" }]);
    expect(report.trend.map((day) => day.revenueXof)).toEqual(["8000", "2000", "0", "0", "0", "0", "0"]);
    expect(report.topProducts[0]).toMatchObject({ name: "Riz 5 kg", revenueXof: "8000" });
  });

  it("le fuseau Africa/Abidjan place 23 h 30 le lundi et 00 h 10 le mardi", async () => {
    const monday = await getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "daily", date: "2026-10-26" }, now);
    const tuesday = await getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "daily", date: "2026-10-27" }, now);
    expect(monday.sales.revenueXof).toBe("8000");
    expect(tuesday.sales.revenueXof).toBe("2000");
  });

  it("encaissements réels : le Mobile Money en attente n'est jamais encaissé, le paiement mixte est compté", async () => {
    const report = await weekly();
    expect(report.collections).toMatchObject({ totalXof: "6500", atSaleXof: "5000", settlementsXof: "1500" });
    expect(report.collections.byMethod).toEqual([{ method: "cash", amountXof: "6500" }]);
    expect(report.collections.pending).toMatchObject({ totalXof: "3000", count: "1", byMethod: [{ method: "wave", amountXof: "3000", count: "1" }] });
    expect(report.settlement.mixed).toBe("1");
  });

  it("crédits : accordés, réglés, restant dû, et anciennes dettes distinctes du chiffre d'affaires", async () => {
    const report = await weekly();
    // Vente 1 : 8 000 − (5 000 + 3 000 déclarés au comptoir) = 0 ; vente 2 : 2 000 à crédit.
    expect(report.credit).toMatchObject({ grantedXof: "2000", settlementsXof: "1500", openingRecoveredXof: "2500", openingOutstandingXof: "3500" });
    // Restant dû sur ventes : 3 000 (Wave non confirmé) + 500 (savons).
    expect(report.receivablesAsOf).toMatchObject({ totalXof: "3500", count: "2" });
    expect(report.credit.totalOutstandingXof).toBe("7000");
    expect(report.collections.openingRecoveries.totalXof).toBe("2500");
    expect(report.sales.revenueXof).toBe("10000");
  });

  it("dépenses enregistrées et payées, par catégorie et par moyen", async () => {
    const report = await weekly();
    expect(report.expenses).toMatchObject({ totalXof: "3000", paidXof: "3000", count: "2" });
    expect(report.expenses.byCategory.map((row) => [row.category, row.amountXof])).toEqual([["transport", "2000"], ["internet", "1000"]]);
    expect(report.expenses.byMethod).toEqual([{ method: "cash", amountXof: "2000" }, { method: "orange_money", amountXof: "1000" }]);
    expect(report.cashFlow).toMatchObject({ inXof: "9000", outXof: "3000", netXof: "6000" });
  });

  it("marge : jamais présentée comme certaine quand un coût manque", async () => {
    const report = await weekly();
    expect(report.grossMarginEstimate).toMatchObject({ available: false, amountXof: null });
    expect(report.margin).toMatchObject({ complete: false, unknownCostLines: "1", knownCostRevenueXof: "8000", cogsKnownXof: "6000", marginOnKnownXof: "2000" });
    expect(report.operatingEstimate).toEqual({ available: false, amountXof: null });
    expect(report.comparison.margin).toBeNull();
    // Semaine précédente : un seul riz, coût connu → marge complète 1 000.
    const previous = await getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "weekly", date: "2026-10-19" }, now);
    expect(previous.margin).toMatchObject({ complete: true, amountXof: "1000" });
    expect(previous.operatingEstimate).toEqual({ available: true, amountXof: "1000" });
  });

  it("mois : stock d'ouverture sans chiffre d'affaires, produits peu vendus, employés, comparaison au mois précédent", async () => {
    const report = await getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "monthly", date: "2026-10-05" }, now);
    expect(report.sales.revenueXof).toBe("14000");
    expect(report.comparison.revenue).toMatchObject({ previousXof: "0", changePercent: null });
    expect(report.stock?.byReason.find((row) => row.reason === "opening_stock")).toMatchObject({ incomingQty: "200.000000", count: "2" });
    expect(report.stock?.byReason.find((row) => row.reason === "sale")).toMatchObject({ outgoingQty: "7.000000" });
    expect(report.slowProducts.map((row) => [row.name, row.quantitySold])).toEqual([["Riz 5 kg", "3.000000"], ["Savon", "4.000000"]]);
    const employees = Object.fromEntries(report.employees.map((row) => [row.name, row]));
    expect(employees.Bakary).toMatchObject({ saleCount: "2", revenueXof: "10000", collectedXof: "6500" });
    expect(employees.Awa).toMatchObject({ saleCount: "1", revenueXof: "4000", expensesXof: "3000" });
    expect(report.supplierDebt).toEqual({ purchasesDueXof: "0", openingDueXof: "0", totalXof: "0" });
  });

  it("isolation multi-commerce, permissions et export protégé contre les formules", async () => {
    await expect(getCommercialReport(db, { businessId: biz, actorUserId: outsider, period: "weekly", date: "2026-10-28" }, now)).rejects.toMatchObject({ status: 403 });
    await expect(getCommercialReport(db, { businessId: biz, actorUserId: cashier, period: "weekly" }, now)).rejects.toMatchObject({ status: 403 });
    const foreign = await getCommercialReport(db, { businessId: other, actorUserId: outsider, period: "weekly", date: "2026-10-28" }, now);
    expect(foreign.sales.revenueXof).toBe("99999");
    expect(foreign.employees.map((row) => row.name)).toEqual(["Ehouman"]);
    await client.query("update product set name='=HYPERLINK(\"x\")' where business_id=$1 and name='Savon'", [biz]);
    await client.query("update sale_line set product_name_snapshot='=HYPERLINK(\"x\")' where business_id=$1 and product_name_snapshot='Savon'", [biz]);
    const csv = reportCsv(await weekly());
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toMatch(/(^|,)"=/m);
  });

  it("résumé du tableau de bord : sans les sections détaillées", async () => {
    const summary = await getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "weekly", date: "2026-10-28", detail: "summary" }, now);
    expect(summary.sales.revenueXof).toBe("10000");
    expect(summary.employees).toEqual([]);
    expect(summary.stock).toBeNull();
  });
});
