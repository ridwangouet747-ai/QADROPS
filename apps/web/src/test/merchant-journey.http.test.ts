import readXlsxFile from "read-excel-file/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as accountMeRoute from "@/app/api/account/me/route";
import * as cashCloseRoute from "@/app/api/business/cash/[sessionId]/close/route";
import * as cashSessionRoute from "@/app/api/business/cash/[sessionId]/route";
import * as cashValidateRoute from "@/app/api/business/cash/[sessionId]/validate/route";
import * as cashRoute from "@/app/api/business/cash/route";
import * as customerPaymentsRoute from "@/app/api/business/customers/payments/route";
import * as customersRoute from "@/app/api/business/customers/route";
import * as expensesRoute from "@/app/api/business/expenses/route";
import * as inventoryCountsRoute from "@/app/api/business/inventories/[sessionId]/counts/route";
import * as inventorySubmitRoute from "@/app/api/business/inventories/[sessionId]/submit/route";
import * as inventoryValidateRoute from "@/app/api/business/inventories/[sessionId]/validate/route";
import * as inventoriesRoute from "@/app/api/business/inventories/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as purchasesRoute from "@/app/api/business/purchases/route";
import * as reportExportRoute from "@/app/api/business/reports/export/route";
import * as reportsRoute from "@/app/api/business/reports/route";
import * as saleRoute from "@/app/api/business/sales/[saleId]/route";
import * as salesRoute from "@/app/api/business/sales/route";
import * as stockOpeningRoute from "@/app/api/business/stock/opening/route";
import * as stockRoute from "@/app/api/business/stock/route";
import * as suppliersRoute from "@/app/api/business/suppliers/route";
import { newKey, startHttpHarness, todayAbidjan, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 11, phase 7 : parcours de bout en bout d'un commerçant, enchaîné au niveau HTTP (sans navigateur :
 * Playwright n'est pas installé). Chaque étape appelle la vraie route avec une vraie session et vérifie les
 * totaux et les stocks attendus. Les montants XOF sont des entiers transmis en chaînes, jamais des flottants.
 *
 * Données : Ciment 50 kg (5 500 F, coût 4 800 F, 100 sacs) et Fer à béton 8 (2 500 F, coût 2 000 F, 40 barres).
 */

const INTEGER_STRING = /^-?(0|[1-9]\d*)$/;
/** Coût unitaire moyen (pondéré) : décimal exact à 12 chiffres, lui aussi transmis en chaîne. */
const DECIMAL_STRING = /^-?(0|[1-9]\d*)\.\d{12}$/;

/**
 * Tout champ `…Xof` d'une réponse est une chaîne, jamais un nombre JSON : un montant est un entier ;
 * seuls les coûts unitaires (`averageCostXof`, `unitCostXof`, `unitCostSnapshotXof`) sont des décimaux exacts.
 */
function expectXofStrings(value: unknown, path = "réponse"): void {
  if (Array.isArray(value)) { value.forEach((item, index) => expectXofStrings(item, `${path}[${index}]`)); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/Xof$/.test(key) && item !== null) {
      expect(typeof item, `${path}.${key}`).toBe("string");
      expect(item, `${path}.${key}`).toMatch(/[cC]ost(Snapshot)?Xof$/.test(key) && String(item).includes(".") ? DECIMAL_STRING : INTEGER_STRING);
    }
    expectXofStrings(item, `${path}.${key}`);
  }
}

describe("mission 11, phase 7 : parcours complet d'un commerçant sur les routes HTTP", () => {
  let h: HttpHarness;
  let owner: Actor; let manager: Actor; let cashier: Actor;
  const ids: Record<string, string> = {};
  const today = todayAbidjan();

  async function expectStatus(pending: Promise<HttpResult>, status: number) {
    const result = await pending;
    expect(result.status, result.text).toBe(status);
    expectXofStrings(result.body);
    return result.body;
  }

  /** Stock disponible d'un article, lu par la route de stock (quantité à 6 décimales). */
  async function onHand(variantId: string) {
    const stock = await expectStatus(h.call(stockRoute.GET, { path: "/api/business/stock", actor: owner }), 200);
    return stock.items.find((item: { variantId: string }) => item.variantId === variantId).onHand as string;
  }

  beforeAll(async () => { h = await startHttpHarness(); });
  afterAll(async () => { await h?.close(); });

  it("1. inscription et création du commerce (onboarding)", async () => {
    owner = await h.signUp("Awa Koné", "awa@parcours.test");
    const before = await expectStatus(h.call(accountMeRoute.GET, { path: "/api/account/me", actor: owner }), 200);
    expect(before.businesses).toEqual([]);
    ids.business = await h.createBusiness(owner, "Quincaillerie Awa", "hardware");
    const after = await expectStatus(h.call(accountMeRoute.GET, { path: "/api/account/me", actor: owner }), 200);
    expect(after.businesses.map((row: { id: string }) => row.id)).toEqual([ids.business]);
    manager = await h.addMember(owner, "Gérant Moussa", "moussa@parcours.test", "admin");
    cashier = await h.addMember(owner, "Caissière Fanta", "fanta@parcours.test", "cashier");
  });

  it("2. création des articles et stock de départ (mouvement d'ouverture, pas un achat)", async () => {
    const ciment = (await expectStatus(h.call(productsRoute.POST, { path: "/api/business/products", actor: owner, body: { name: "Ciment 50 kg", salePriceXof: "5500", baseUnit: "sac" } }), 201)).product;
    const fer = (await expectStatus(h.call(productsRoute.POST, { path: "/api/business/products", actor: owner, body: { name: "Fer à béton 8", salePriceXof: "2500", baseUnit: "barre" } }), 201)).product;
    ids.ciment = ciment.variantId; ids.fer = fer.variantId;
    const opening = { idempotencyKey: newKey("ouverture"), referenceDate: today, lines: [
      { variantId: ids.ciment, quantity: "100", unitCostXof: "4800" }, { variantId: ids.fer, quantity: "40", unitCostXof: "2000" }] };
    await expectStatus(h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: owner, body: opening }), 201);
    // Rejouée (réponse perdue) : même résultat, aucun second mouvement.
    expect((await expectStatus(h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: owner, body: opening }), 200)).opening.replayed).toBe(true);
    expect(await onHand(ids.ciment)).toBe("100.000000");
    expect(await onHand(ids.fer)).toBe("40.000000");
    expect(await h.count("select count(*)::text n from stock_movement where business_id=$1 and reason='purchase'", [ids.business])).toBe(0);
    expect(await h.count("select count(*)::text n from purchase where business_id=$1", [ids.business])).toBe(0);
  });

  it("3. ouverture de caisse par la caissière", async () => {
    const opened = await expectStatus(h.call(cashRoute.POST, { path: "/api/business/cash", actor: cashier, body: { idempotencyKey: newKey("caisse"), openingFloatXof: "10000" } }), 201);
    ids.cash = opened.session.id;
    expect(opened.session.openingFloatXof).toBe("10000");
  });

  it("4. vente en espèces avec clé d'idempotence, rejouée deux fois : une seule vente, un seul déstockage", async () => {
    const body = { idempotencyKey: newKey("vente"), lines: [{ variantId: ids.ciment, quantity: "3" }], payments: [{ method: "cash", amountXof: "16500" }] };
    const first = await expectStatus(h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashier, body }), 201);
    expect(first.sale).toMatchObject({ totalXof: "16500", paidXof: "16500", dueXof: "0", replayed: false });
    for (let replay = 0; replay < 2; replay += 1) {
      const again = await expectStatus(h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashier, body }), 200);
      expect(again.sale).toMatchObject({ id: first.sale.id, reference: first.sale.reference, totalXof: "16500", replayed: true });
    }
    // Même clé, contenu différent : refus explicite, jamais une seconde vente.
    await expectStatus(h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashier, body: { ...body, lines: [{ variantId: ids.ciment, quantity: "4" }], payments: [{ method: "cash", amountXof: "22000" }] } }), 409);
    expect(await h.count("select count(*)::text n from sale where business_id=$1", [ids.business])).toBe(1);
    expect(await h.count("select count(*)::text n from payment where business_id=$1", [ids.business])).toBe(1);
    expect(await onHand(ids.ciment)).toBe("97.000000");
    ids.cashSale = first.sale.id; ids.cashSaleReference = first.sale.reference;
  });

  it("5. vente à crédit, paiement partiel puis solde de la dette client", async () => {
    ids.customer = (await expectStatus(h.call(customersRoute.POST, { path: "/api/business/customers", actor: cashier, body: { name: "Koffi Bamba", phone: "+225 07 11 22 33 44" } }), 201)).customer.id;
    // Sans client, une vente non soldée est refusée.
    await expectStatus(h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashier, body: { idempotencyKey: newKey(), lines: [{ variantId: ids.fer, quantity: "2" }], payments: [{ method: "cash", amountXof: "2000" }] } }), 400);
    const credit = await expectStatus(h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashier, body: {
      idempotencyKey: newKey("credit"), customerId: ids.customer, lines: [{ variantId: ids.fer, quantity: "2" }], payments: [{ method: "cash", amountXof: "2000" }] } }), 201);
    expect(credit.sale).toMatchObject({ totalXof: "5000", paidXof: "2000", dueXof: "3000" });
    ids.creditSale = credit.sale.id; ids.creditSaleReference = credit.sale.reference;

    const partial = { idempotencyKey: newKey("reglement"), saleId: ids.creditSale, amountXof: "1000", method: "cash" };
    expect((await expectStatus(h.call(customerPaymentsRoute.POST, { path: "/api/business/customers/payments", actor: cashier, body: partial }), 201)).remainingXof).toBe("2000");
    // Le même règlement renvoyé (double tap) ne réduit pas deux fois la dette.
    expect(await expectStatus(h.call(customerPaymentsRoute.POST, { path: "/api/business/customers/payments", actor: cashier, body: partial }), 201)).toMatchObject({ remainingXof: "2000", replayed: true });
    // Trop-perçu refusé.
    await expectStatus(h.call(customerPaymentsRoute.POST, { path: "/api/business/customers/payments", actor: cashier, body: { idempotencyKey: newKey(), saleId: ids.creditSale, amountXof: "2001", method: "wave" } }), 409);
    expect((await expectStatus(h.call(customerPaymentsRoute.POST, { path: "/api/business/customers/payments", actor: cashier, body: { idempotencyKey: newKey("solde"), saleId: ids.creditSale, amountXof: "2000", method: "wave" } }), 201)).remainingXof).toBe("0");

    const sale = (await expectStatus(h.call(saleRoute.GET, { path: `/api/business/sales/${ids.creditSale}`, actor: owner, params: { saleId: ids.creditSale } }), 200)).sale;
    expect(sale.dueXof).toBe("0");
    expect(sale.payments.map((part: { amountXof: string }) => part.amountXof).sort()).toEqual(["1000", "2000", "2000"]);
    const customers = (await expectStatus(h.call(customersRoute.GET, { path: "/api/business/customers", actor: owner }), 200)).customers;
    expect(customers.find((row: { id: string }) => row.id === ids.customer)).toMatchObject({ balanceXof: "0", saleCount: "1" });
    expect(await onHand(ids.fer)).toBe("38.000000");
  });

  it("6. achat fournisseur reçu, payé en partie", async () => {
    const supplier = (await expectStatus(h.call(suppliersRoute.POST, { path: "/api/business/suppliers", actor: owner, body: { name: "Cimenterie du Sud" } }), 201)).supplier.id;
    const body = { idempotencyKey: newKey("achat"), supplierId: supplier, reference: "BL-2026-001", lines: [{ variantId: ids.ciment, quantity: "50", unitCostXof: "4700" }], paidXof: "200000", paymentMethod: "orange_money" };
    const purchase = (await expectStatus(h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: owner, body }), 201)).purchase;
    expect(purchase).toMatchObject({ totalXof: "235000", paidXof: "200000", dueXof: "35000" });
    expect((await expectStatus(h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: owner, body }), 201)).purchase.replayed).toBe(true);
    expect(await onHand(ids.ciment)).toBe("147.000000");
    const suppliers = (await expectStatus(h.call(suppliersRoute.GET, { path: "/api/business/suppliers", actor: owner }), 200)).suppliers;
    expect(suppliers.find((row: { id: string }) => row.id === supplier)).toMatchObject({ purchaseCount: "1", purchaseTotalXof: "235000" });
  });

  it("7. dépense", async () => {
    const body = { idempotencyKey: newKey("depense"), category: "Transport", description: "Livraison du ciment", amountXof: "3000", paymentMethod: "other" };
    await expectStatus(h.call(expensesRoute.POST, { path: "/api/business/expenses", actor: owner, body }), 201);
    await expectStatus(h.call(expensesRoute.POST, { path: "/api/business/expenses", actor: owner, body }), 201);
    const expenses = (await expectStatus(h.call(expensesRoute.GET, { path: "/api/business/expenses", actor: owner }), 200)).expenses;
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountXof).toBe("3000");
  });

  it("8. inventaire : comptage, écart justifié, validation par une autre personne", async () => {
    const session = (await expectStatus(h.call(inventoriesRoute.POST, { path: "/api/business/inventories", actor: owner, body: {} }), 201)).session;
    expect(session.scopeCount).toBe(2);
    const count = (body: Record<string, string>) => h.call(inventoryCountsRoute.POST, { path: `/api/business/inventories/${session.id}/counts`, actor: owner, params: { sessionId: session.id }, body });
    // Un écart sans motif est refusé.
    await expectStatus(count({ variantId: ids.ciment, countedQty: "146" }), 400);
    await expectStatus(count({ variantId: ids.ciment, countedQty: "146", adjustmentReason: "Sac déchiré" }), 200);
    await expectStatus(count({ variantId: ids.fer, countedQty: "38" }), 200);
    await expectStatus(h.call(inventorySubmitRoute.POST, { path: `/api/business/inventories/${session.id}/submit`, actor: owner, params: { sessionId: session.id } }), 200);
    // Le compteur ne valide pas son propre comptage.
    await expectStatus(h.call(inventoryValidateRoute.POST, { path: `/api/business/inventories/${session.id}/validate`, actor: owner, params: { sessionId: session.id } }), 403);
    await expectStatus(h.call(inventoryValidateRoute.POST, { path: `/api/business/inventories/${session.id}/validate`, actor: manager, params: { sessionId: session.id } }), 200);
    expect(await onHand(ids.ciment)).toBe("146.000000");
    expect(await onHand(ids.fer)).toBe("38.000000");
  });

  it("9. clôture de caisse sans écart, puis validation par la propriétaire", async () => {
    // Fonds 10 000 + vente comptant 16 500 + acompte crédit 2 000 + règlement espèces 1 000 (le règlement Wave reste hors caisse).
    const live = (await expectStatus(h.call(cashSessionRoute.GET, { path: `/api/business/cash/${ids.cash}`, actor: cashier, params: { sessionId: ids.cash } }), 200)).session;
    expect(live.expectedCashXof).toBe("29500");
    const close = { idempotencyKey: newKey("cloture"), countedCashXof: "29500" };
    const closed = (await expectStatus(h.call(cashCloseRoute.POST, { path: `/api/business/cash/${ids.cash}/close`, actor: cashier, params: { sessionId: ids.cash }, body: close }), 201)).session;
    expect(closed).toMatchObject({ status: "closed", expectedXof: "29500", countedXof: "29500", differenceXof: "0" });
    await expectStatus(h.call(cashCloseRoute.POST, { path: `/api/business/cash/${ids.cash}/close`, actor: cashier, params: { sessionId: ids.cash }, body: close }), 200);
    // Une vente en espèces après la clôture n'entre plus dans cette caisse.
    expect(await h.count("select count(*)::text n from cash_session where business_id=$1 and status='open'", [ids.business])).toBe(0);
    const validated = (await expectStatus(h.call(cashValidateRoute.POST, { path: `/api/business/cash/${ids.cash}/validate`, actor: owner, params: { sessionId: ids.cash }, body: { idempotencyKey: newKey("validation") } }), 201)).session;
    expect(validated.status).toBe("validated");
  });

  it("10. rapport du jour : chaque total se retrouve à partir des étapes précédentes", async () => {
    const report = (await expectStatus(h.call(reportsRoute.GET, { path: `/api/business/reports?period=daily&date=${today}`, actor: owner }), 200)).report;
    expect(report.sales).toMatchObject({ revenueXof: "21500", count: "2" });
    // 16 500 + 2 000 + 1 000 en espèces, 2 000 par Wave ; dont 3 000 de règlements de crédit.
    expect(report.collections).toMatchObject({ totalXof: "21500", settlementsXof: "3000" });
    expect(report.receivablesAsOf.totalXof).toBe("0");
    expect(report.expenses.totalXof).toBe("3000");
    expect(report.purchases).toMatchObject({ totalXof: "235000", paidXof: "200000" });
    // Coût des ventes : 3 × 4 800 + 2 × 2 000 = 18 400 ; marge 21 500 − 18 400 = 3 100 ; moins 3 000 de dépenses.
    expect(report.grossMarginEstimate).toMatchObject({ available: true, amountXof: "3100" });
    expect(report.operatingEstimate).toEqual({ available: true, amountXof: "100" });
  });

  it("11. exports CSV et XLSX du jour, cohérents avec le rapport", async () => {
    const csv = await h.call(reportExportRoute.GET, { path: `/api/business/reports/export?format=csv&period=daily&date=${today}`, actor: owner });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="qadr-ops-rapport-/);
    const revenueLine = csv.text.split(/\r?\n/).find((line) => line.startsWith("Chiffre d’affaires (XOF)") || line.startsWith("\"Chiffre d’affaires (XOF)\""));
    expect(revenueLine).toBeDefined();
    expect(revenueLine!.split(/[;,]/)[1]?.replaceAll("\"", "")).toBe("21500");

    const xlsx = await h.call(reportExportRoute.GET, { path: `/api/business/reports/export?format=xlsx&period=daily&date=${today}&lang=fr`, actor: owner });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const sheets = await readXlsxFile(Buffer.from(xlsx.bytes), { trim: false });
    const sales = sheets.find((sheet) => sheet.sheet === "Ventes")!.data;
    const flat = JSON.stringify(sales);
    expect(flat).toContain(ids.cashSaleReference);
    expect(flat).toContain(ids.creditSaleReference);
    expect(JSON.stringify(sheets.find((sheet) => sheet.sheet === "Dépenses")!.data)).toContain("Livraison du ciment");
  });
});
