import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as accountActiveBusinessRoute from "@/app/api/account/active-business/route";
import * as accountInvitationRoute from "@/app/api/account/invitations/[invitationId]/route";
import * as accountMeRoute from "@/app/api/account/me/route";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as cashCloseRoute from "@/app/api/business/cash/[sessionId]/close/route";
import * as cashMovementsRoute from "@/app/api/business/cash/[sessionId]/movements/route";
import * as cashSessionRoute from "@/app/api/business/cash/[sessionId]/route";
import * as cashValidateRoute from "@/app/api/business/cash/[sessionId]/validate/route";
import * as cashRoute from "@/app/api/business/cash/route";
import * as categoriesRoute from "@/app/api/business/categories/route";
import * as customerPaymentsRoute from "@/app/api/business/customers/payments/route";
import * as customersRoute from "@/app/api/business/customers/route";
import * as dashboardRoute from "@/app/api/business/dashboard/route";
import * as expensesRoute from "@/app/api/business/expenses/route";
import * as importApplyRoute from "@/app/api/business/imports/[importId]/apply/route";
import * as importDiscardRoute from "@/app/api/business/imports/[importId]/discard/route";
import * as importOriginalRoute from "@/app/api/business/imports/[importId]/original/route";
import * as importRoute from "@/app/api/business/imports/[importId]/route";
import * as importRowRoute from "@/app/api/business/imports/[importId]/rows/[rowId]/route";
import * as importsRoute from "@/app/api/business/imports/route";
import * as inventoryCountsRoute from "@/app/api/business/inventories/[sessionId]/counts/route";
import * as inventoryRoute from "@/app/api/business/inventories/[sessionId]/route";
import * as inventorySubmitRoute from "@/app/api/business/inventories/[sessionId]/submit/route";
import * as inventoryValidateRoute from "@/app/api/business/inventories/[sessionId]/validate/route";
import * as inventoriesRoute from "@/app/api/business/inventories/route";
import * as openingBalancePaymentsRoute from "@/app/api/business/opening-balances/[balanceId]/payments/route";
import * as openingBalancesRoute from "@/app/api/business/opening-balances/route";
import * as printDeviceRoute from "@/app/api/business/printing/devices/[deviceId]/route";
import * as printDevicesRoute from "@/app/api/business/printing/devices/route";
import * as printJobRoute from "@/app/api/business/printing/jobs/[jobId]/route";
import * as printJobsRoute from "@/app/api/business/printing/jobs/route";
import * as printingRoute from "@/app/api/business/printing/route";
import * as productRoute from "@/app/api/business/products/[productId]/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as purchasesRoute from "@/app/api/business/purchases/route";
import * as reportExportRoute from "@/app/api/business/reports/export/route";
import * as reportsRoute from "@/app/api/business/reports/route";
import * as saleRoute from "@/app/api/business/sales/[saleId]/route";
import * as salesRoute from "@/app/api/business/sales/route";
import * as settingsRoute from "@/app/api/business/settings/route";
import * as stockMovementsRoute from "@/app/api/business/stock/movements/route";
import * as stockOpeningRoute from "@/app/api/business/stock/opening/route";
import * as stockRoute from "@/app/api/business/stock/route";
import * as subscriptionPromotionRoute from "@/app/api/business/subscription/promotion/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as suppliersRoute from "@/app/api/business/suppliers/route";
import * as teamInvitationRoute from "@/app/api/business/team/invitations/[invitationId]/route";
import * as teamInvitationsRoute from "@/app/api/business/team/invitations/route";
import * as teamMemberAccessRoute from "@/app/api/business/team/members/[memberId]/access/route";
import * as teamMemberRoute from "@/app/api/business/team/members/[memberId]/route";
import * as teamRoute from "@/app/api/business/team/route";
import * as notificationPreferencesRoute from "@/app/api/notifications/preferences/route";
import * as notificationsReadRoute from "@/app/api/notifications/read/route";
import * as notificationsUnreadRoute from "@/app/api/notifications/unread-count/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as pushSubscriptionRoute from "@/app/api/notifications/push-subscriptions/[subscriptionId]/route";
import * as pushSubscriptionsRoute from "@/app/api/notifications/push-subscriptions/route";
import * as platformBusinessRoute from "@/app/api/platform/businesses/[businessId]/route";
import * as platformPromotionsRoute from "@/app/api/platform/promotions/route";
import readXlsxFile from "read-excel-file/node";
import { processNotificationOutbox } from "@/lib/domain/notifications";
import { newKey, startHttpHarness, todayAbidjan, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 11, phase 7 : isolation entre commerces au niveau des routes HTTP.
 * Un propriétaire du commerce A substitue les identifiants du commerce B dans chaque route. Il ne doit
 * ni lire, ni modifier, ni supprimer, ni exporter, ni imprimer quoi que ce soit de B ; l'état complet de
 * B (toutes les tables portant `business_id`) est comparé avant et après la campagne d'attaques.
 */

/** Chaînes propres à B : elles ne doivent apparaître dans aucune réponse faite à A. */
const SECRETS_B = ["Bêta", "+225 05 55 55 55 55"];
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const PUSH_KEYS = { p256dh: `B${"x".repeat(86)}`, auth: "a".repeat(22) };

function expectNoLeak(result: HttpResult) {
  for (const secret of SECRETS_B) expect(result.text, `la réponse ${result.status} révèle « ${secret} »`).not.toContain(secret);
}

/** Refus sans fuite, identique (statut et corps) à celui d'un identifiant qui n'existe nulle part. */
function expectSameAsUnknown(forB: HttpResult, forUnknown: HttpResult, status = 404) {
  expectNoLeak(forB);
  expect(forB.status).toBe(status);
  expect(forUnknown.status).toBe(status);
  expect(forB.text).toBe(forUnknown.text);
}

describe("mission 11, phase 7 : isolation des commerces sur les routes HTTP (PGlite, vraie session Better Auth)", () => {
  let h: HttpHarness;
  let ownerA: Actor; let ownerB: Actor; let cashierB: Actor; let platformAdmin: Actor;
  let businessA = ""; let businessB = "";
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};
  let snapshotBefore = "";

  /** État complet de B : toutes les tables à `business_id`, plus membres, invitations, sessions et appareils. */
  async function snapshot(businessId: string) {
    const tables = (await h.client.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema='public' and column_name='business_id' and table_name not in ('notification_outbox','notification_delivery') order by table_name")).rows;
    const state: Record<string, unknown> = {};
    for (const { table_name } of tables) state[table_name] = (await h.client.query(`select * from "${table_name}" where business_id=$1 order by 1`, [businessId])).rows;
    state.organization = (await h.client.query("select * from organization where id=$1", [businessId])).rows;
    state.member = (await h.client.query("select * from member where organization_id=$1 order by id", [businessId])).rows;
    state.invitation = (await h.client.query("select * from invitation where organization_id=$1 order by id", [businessId])).rows;
    state.sessions = (await h.client.query("select s.id, s.active_organization_id from session s join member m on m.user_id=s.user_id where m.organization_id=$1 order by s.id", [businessId])).rows;
    state.push = (await h.client.query("select p.* from push_subscription p join member m on m.user_id=p.user_id where m.organization_id=$1 order by p.id", [businessId])).rows;
    return JSON.stringify(state, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  }

  async function ok(result: Promise<HttpResult>, status = 201) {
    const response = await result;
    if (response.status !== status) throw new Error(`Préparation : statut ${response.status} au lieu de ${status} : ${response.text}`);
    return response.body;
  }

  beforeAll(async () => {
    h = await startHttpHarness();
    const today = todayAbidjan();

    // ---------------------------------------------------------------- Commerce A (attaquant)
    ownerA = await h.signUp("Propriétaire Alpha", "owner@alpha.test");
    businessA = await h.createBusiness(ownerA, "Quincaillerie Alpha", "hardware");
    const productA = (await ok(h.call(productsRoute.POST, { path: "/api/business/products", actor: ownerA, body: { name: "Ciment Alpha", salePriceXof: "5000" } }))).product;
    a.product = productA.id; a.variant = productA.variantId;
    await ok(h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: ownerA, body: { idempotencyKey: newKey(), referenceDate: today, lines: [{ variantId: a.variant, quantity: "20", unitCostXof: "4000" }] } }));
    a.supplier = (await ok(h.call(suppliersRoute.POST, { path: "/api/business/suppliers", actor: ownerA, body: { name: "Fournisseur Alpha" } }))).supplier.id;
    a.customer = (await ok(h.call(customersRoute.POST, { path: "/api/business/customers", actor: ownerA, body: { name: "Client Alpha" } }))).customer.id;
    await ok(h.call(cashRoute.POST, { path: "/api/business/cash", actor: ownerA, body: { idempotencyKey: newKey(), openingFloatXof: "1000" } }));
    a.sale = (await ok(h.call(salesRoute.POST, { path: "/api/business/sales", actor: ownerA, body: { idempotencyKey: newKey(), lines: [{ variantId: a.variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "5000" }] } }))).sale.id;
    await ok(h.call(printingRoute.PUT, { method: "PUT", path: "/api/business/printing", actor: ownerA, body: { enabled: true, autoPrint: false } }), 200);
    a.device = (await ok(h.call(printDevicesRoute.POST, { path: "/api/business/printing/devices", actor: ownerA, body: { name: "Imprimante Alpha", transport: "simulated", paperWidthMm: 58, agentId: null } }))).id;
    const importA = new FormData();
    importA.append("file", new File(["Désignation;Prix de vente\nSable Alpha;2000\n"], "alpha.csv", { type: "text/csv" }));
    a.import = (await ok(h.call(importsRoute.POST, { path: "/api/business/imports", actor: ownerA, form: importA }))).import.id;
    a.importRow = (await ok(h.call(importRoute.GET, { path: `/api/business/imports/${a.import}`, actor: ownerA, params: { importId: a.import } }), 200)).rows[0].id;

    // ---------------------------------------------------------------- Commerce B (victime)
    ownerB = await h.signUp("Propriétaire Bêta", "owner@beta.test");
    businessB = await h.createBusiness(ownerB, "Boutique Bêta", "general");
    cashierB = await h.addMember(ownerB, "Caissier Bêta", "caissier@beta.test", "cashier");
    b.category = (await ok(h.call(categoriesRoute.POST, { path: "/api/business/categories", actor: ownerB, body: { name: "Catégorie Bêta" } }))).category.id;
    const productB = (await ok(h.call(productsRoute.POST, { path: "/api/business/products", actor: ownerB, body: { name: "Produit Bêta", salePriceXof: "1000", categoryId: b.category } }))).product;
    b.product = productB.id; b.variant = productB.variantId;
    await ok(h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: ownerB, body: { idempotencyKey: newKey(), referenceDate: today, lines: [{ variantId: b.variant, quantity: "10", unitCostXof: "600" }] } }));
    b.customer = (await ok(h.call(customersRoute.POST, { path: "/api/business/customers", actor: ownerB, body: { name: "Client Bêta", phone: "+225 05 55 55 55 55" } }))).customer.id;
    b.debtor = (await ok(h.call(customersRoute.POST, { path: "/api/business/customers", actor: ownerB, body: { name: "Ancien débiteur Bêta" } }))).customer.id;
    b.supplier = (await ok(h.call(suppliersRoute.POST, { path: "/api/business/suppliers", actor: ownerB, body: { name: "Fournisseur Bêta" } }))).supplier.id;
    b.cash = (await ok(h.call(cashRoute.POST, { path: "/api/business/cash", actor: ownerB, body: { idempotencyKey: newKey(), openingFloatXof: "5000" } }))).session.id;
    await ok(h.call(cashRoute.POST, { path: "/api/business/cash", actor: cashierB, body: { idempotencyKey: newKey(), openingFloatXof: "0" } }));
    // Vente à crédit faite par le caissier : le propriétaire de B reçoit une notification.
    b.sale = (await ok(h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashierB, body: { idempotencyKey: newKey(), customerId: b.customer, lines: [{ variantId: b.variant, quantity: "2" }], payments: [{ method: "cash", amountXof: "500" }] } }))).sale.id;
    await ok(h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: ownerB, body: { idempotencyKey: newKey(), supplierId: b.supplier, reference: "ACH-BETA-1", lines: [{ variantId: b.variant, quantity: "5", unitCostXof: "600" }] } }));
    await ok(h.call(expensesRoute.POST, { path: "/api/business/expenses", actor: ownerB, body: { idempotencyKey: newKey(), category: "Loyer", description: "Loyer Bêta", amountXof: "20000", paymentMethod: "other" } }));
    b.balance = (await ok(h.call(openingBalancesRoute.POST, { path: "/api/business/opening-balances", actor: ownerB, body: { idempotencyKey: newKey(), partyType: "customer", partyId: b.debtor, amountXof: "7000", asOfDate: today } }))).balance.id;
    b.inventory = (await ok(h.call(inventoriesRoute.POST, { path: "/api/business/inventories", actor: ownerB, body: {} }))).session.id;
    const importB = new FormData();
    importB.append("file", new File(["Désignation;Prix de vente\nArticle importé Bêta;3000\n"], "beta.csv", { type: "text/csv" }));
    b.import = (await ok(h.call(importsRoute.POST, { path: "/api/business/imports", actor: ownerB, form: importB }))).import.id;
    b.importRow = (await ok(h.call(importRoute.GET, { path: `/api/business/imports/${b.import}`, actor: ownerB, params: { importId: b.import } }), 200)).rows[0].id;
    await ok(h.call(printingRoute.PUT, { method: "PUT", path: "/api/business/printing", actor: ownerB, body: { enabled: true, autoPrint: false } }), 200);
    b.device = (await ok(h.call(printDevicesRoute.POST, { path: "/api/business/printing/devices", actor: ownerB, body: { name: "Imprimante Bêta", transport: "simulated", paperWidthMm: 80, agentId: null } }))).id;
    b.job = (await ok(h.call(printJobsRoute.POST, { path: "/api/business/printing/jobs", actor: ownerB, body: { deviceId: b.device, kind: "receipt", saleId: b.sale } }))).job.id;
    b.invitation = (await ok(h.call(teamInvitationsRoute.POST, { path: "/api/business/team/invitations", actor: ownerB, body: { email: "futur@beta.test", role: "cashier" } }))).invitation.id;
    const team = await ok(h.call(teamRoute.GET, { path: "/api/business/team", actor: ownerB }), 200);
    b.cashierMember = team.members.find((row: { email: string }) => row.email === "caissier@beta.test").memberId;
    b.ownerMember = team.members.find((row: { email: string }) => row.email === "owner@beta.test").memberId;
    b.push = (await ok(h.call(pushSubscriptionsRoute.POST, { path: "/api/notifications/push-subscriptions", actor: ownerB, body: { endpoint: "https://fcm.googleapis.com/fcm/send/harnais-beta", keys: PUSH_KEYS } }))).id;

    // ---------------------------------------------------------------- Plateforme : code réservé à B
    platformAdmin = await h.signUp("Super Admin", "admin@qadr.test");
    await h.grantPlatformAdmin(platformAdmin);
    await ok(h.call(platformPromotionsRoute.POST, { path: "/api/platform/promotions", actor: platformAdmin, body: {
      code: "RESERVE-BETA", discountPercent: 10, discountXof: null, startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: null,
      maxRedemptions: null, active: true, eligibleBusinessIds: [businessB] } }));

    // Boîte d'envoi traitée jusqu'au bout : l'état de B ne bouge plus de lui-même pendant les attaques.
    while ((await processNotificationOutbox(h.db, { sender: null, limit: 50 })).processed > 0) { /* vider */ }
    b.notification = (await h.client.query<{ id: string }>("select id from notification where business_id=$1 and user_id=$2 limit 1", [businessB, ownerB.userId])).rows[0]?.id ?? "";
    snapshotBefore = await snapshot(businessB);
  });

  afterAll(async () => { await h?.close(); });

  describe("lecture par identifiant", () => {
    it("une vente de B est introuvable pour A, exactement comme une vente inexistante", async () => {
      const forB = await h.call(saleRoute.GET, { path: `/api/business/sales/${b.sale}`, actor: ownerA, params: { saleId: b.sale } });
      const unknown = await h.call(saleRoute.GET, { path: `/api/business/sales/${UNKNOWN_ID}`, actor: ownerA, params: { saleId: UNKNOWN_ID } });
      expectSameAsUnknown(forB, unknown);
    });

    it("une session de caisse, un inventaire et un import de B sont introuvables", async () => {
      expectSameAsUnknown(
        await h.call(cashSessionRoute.GET, { path: `/api/business/cash/${b.cash}`, actor: ownerA, params: { sessionId: b.cash } }),
        await h.call(cashSessionRoute.GET, { path: `/api/business/cash/${UNKNOWN_ID}`, actor: ownerA, params: { sessionId: UNKNOWN_ID } }));
      expectSameAsUnknown(
        await h.call(inventoryRoute.GET, { path: `/api/business/inventories/${b.inventory}`, actor: ownerA, params: { sessionId: b.inventory } }),
        await h.call(inventoryRoute.GET, { path: `/api/business/inventories/${UNKNOWN_ID}`, actor: ownerA, params: { sessionId: UNKNOWN_ID } }));
      expectSameAsUnknown(
        await h.call(importRoute.GET, { path: `/api/business/imports/${b.import}`, actor: ownerA, params: { importId: b.import } }),
        await h.call(importRoute.GET, { path: `/api/business/imports/${UNKNOWN_ID}`, actor: ownerA, params: { importId: UNKNOWN_ID } }));
    });

    it("le fichier d'origine d'un import de B est introuvable pour A, comme un import inexistant (mission 12, L2)", async () => {
      // Préalable : l'original de B est bien conservé et lisible par B lui-même.
      const own = await h.call(importOriginalRoute.GET, { path: `/api/business/imports/${b.import}/original`, actor: ownerB, params: { importId: b.import } });
      expect(own.status).toBe(200);
      expect(own.text).toContain("Article importé Bêta");
      const forB = await h.call(importOriginalRoute.GET, { path: `/api/business/imports/${b.import}/original`, actor: ownerA, params: { importId: b.import } });
      expectSameAsUnknown(forB,
        await h.call(importOriginalRoute.GET, { path: `/api/business/imports/${UNKNOWN_ID}/original`, actor: ownerA, params: { importId: UNKNOWN_ID } }));
      expect(forB.headers.get("location")).toBeNull();
      // Un identifiant de commerce glissé dans l'URL ou les en-têtes ne change rien.
      const smuggled = await h.call(importOriginalRoute.GET, { path: `/api/business/imports/${b.import}/original?businessId=${businessB}`, actor: ownerA,
        params: { importId: b.import }, headers: { "x-business-id": businessB } });
      expect(smuggled.status).toBe(404);
      expectNoLeak(smuggled);
    });

    it("les listes de A ne contiennent aucune donnée de B, même avec des paramètres pointant vers B", async () => {
      const lists = await Promise.all([
        h.call(productsRoute.GET, { path: `/api/business/products?businessId=${businessB}`, actor: ownerA }),
        h.call(productsRoute.GET, { path: "/api/business/products?limit=50", actor: ownerA, headers: { "x-business-id": businessB } }),
        h.call(salesRoute.GET, { path: "/api/business/sales", actor: ownerA }),
        h.call(customersRoute.GET, { path: "/api/business/customers", actor: ownerA }),
        h.call(suppliersRoute.GET, { path: "/api/business/suppliers", actor: ownerA }),
        h.call(purchasesRoute.GET, { path: "/api/business/purchases", actor: ownerA }),
        h.call(expensesRoute.GET, { path: "/api/business/expenses", actor: ownerA }),
        h.call(categoriesRoute.GET, { path: "/api/business/categories", actor: ownerA }),
        h.call(stockRoute.GET, { path: "/api/business/stock", actor: ownerA }),
        h.call(stockMovementsRoute.GET, { path: `/api/business/stock/movements?variantId=${b.variant}`, actor: ownerA }),
        h.call(stockOpeningRoute.GET, { path: "/api/business/stock/opening", actor: ownerA }),
        h.call(openingBalancesRoute.GET, { path: "/api/business/opening-balances?party=customer", actor: ownerA }),
        h.call(inventoriesRoute.GET, { path: "/api/business/inventories", actor: ownerA }),
        h.call(cashRoute.GET, { path: "/api/business/cash", actor: ownerA }),
        h.call(importsRoute.GET, { path: "/api/business/imports", actor: ownerA }),
        h.call(printingRoute.GET, { path: "/api/business/printing", actor: ownerA }),
        h.call(printJobsRoute.GET, { path: `/api/business/printing/jobs?saleId=${b.sale}`, actor: ownerA }),
        h.call(teamRoute.GET, { path: "/api/business/team", actor: ownerA }),
        h.call(dashboardRoute.GET, { path: "/api/business/dashboard", actor: ownerA }),
        h.call(reportsRoute.GET, { path: `/api/business/reports?period=daily&businessId=${businessB}`, actor: ownerA }),
        h.call(settingsRoute.GET, { path: "/api/business/settings", actor: ownerA }),
        h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor: ownerA }),
        h.call(notificationsRoute.GET, { path: "/api/notifications", actor: ownerA }),
        h.call(accountMeRoute.GET, { path: "/api/account/me", actor: ownerA }),
      ]);
      for (const list of lists) {
        expect(list.status, list.text).toBe(200);
        expectNoLeak(list);
        for (const id of Object.values(b)) if (id) expect(list.text).not.toContain(id);
      }
      expect(lists[15]!.body).toBeTruthy();
      expect(lists[16]!.body.jobs).toEqual([]);
      expect(lists[9]!.body.items).toEqual([]);
    });
  });

  describe("écritures avec des identifiants de B", () => {
    it("produits : ni modification, ni archivage, ni catégorie de B rattachée à un produit de A", async () => {
      const edit = { variantId: b.variant, name: "Renommé par A", description: null, categoryId: null, variantLabel: "Standard", sku: null, salePriceXof: "1", lowStockThreshold: "0" };
      expectSameAsUnknown(
        await h.call(productRoute.PATCH, { method: "PATCH", path: `/api/business/products/${b.product}`, actor: ownerA, params: { productId: b.product }, body: edit }),
        await h.call(productRoute.PATCH, { method: "PATCH", path: `/api/business/products/${UNKNOWN_ID}`, actor: ownerA, params: { productId: UNKNOWN_ID }, body: { ...edit, variantId: UNKNOWN_ID } }));
      expectSameAsUnknown(
        await h.call(productRoute.DELETE, { method: "DELETE", path: `/api/business/products/${b.product}`, actor: ownerA, params: { productId: b.product } }),
        await h.call(productRoute.DELETE, { method: "DELETE", path: `/api/business/products/${UNKNOWN_ID}`, actor: ownerA, params: { productId: UNKNOWN_ID } }));
      const ownWithForeignCategory = await h.call(productRoute.PATCH, { method: "PATCH", path: `/api/business/products/${a.product}`, actor: ownerA, params: { productId: a.product },
        body: { ...edit, variantId: a.variant, name: "Ciment Alpha", salePriceXof: "5000", categoryId: b.category } });
      expect(ownWithForeignCategory.status).toBe(404);
      expectNoLeak(ownWithForeignCategory);
    });

    it("ventes : ni produit de B vendu, ni règlement de la créance d'un client de B", async () => {
      const sale = await h.call(salesRoute.POST, { path: "/api/business/sales", actor: ownerA, body: { idempotencyKey: newKey(), lines: [{ variantId: b.variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "1000" }] } });
      const unknownSale = await h.call(salesRoute.POST, { path: "/api/business/sales", actor: ownerA, body: { idempotencyKey: newKey(), lines: [{ variantId: UNKNOWN_ID, quantity: "1" }], payments: [{ method: "cash", amountXof: "1000" }] } });
      expectSameAsUnknown(sale, unknownSale);
      const payment = { amountXof: "100", method: "cash" };
      expectSameAsUnknown(
        await h.call(customerPaymentsRoute.POST, { path: "/api/business/customers/payments", actor: ownerA, body: { ...payment, idempotencyKey: newKey(), saleId: b.sale } }),
        await h.call(customerPaymentsRoute.POST, { path: "/api/business/customers/payments", actor: ownerA, body: { ...payment, idempotencyKey: newKey(), saleId: UNKNOWN_ID } }));
    });

    it("ventes : un client de B rattaché à une vente de A est refusé sans fuite, comme un client inconnu", async () => {
      const body = (customerId: string) => ({ idempotencyKey: newKey(), customerId, lines: [{ variantId: a.variant, quantity: "1" }], payments: [] });
      const forB = await h.call(salesRoute.POST, { path: "/api/business/sales", actor: ownerA, body: body(b.customer) });
      const unknown = await h.call(salesRoute.POST, { path: "/api/business/sales", actor: ownerA, body: body(UNKNOWN_ID) });
      expectNoLeak(forB);
      expect(forB.status).toBeGreaterThanOrEqual(400);
      expect(forB.status).toBe(unknown.status);
      expect(forB.text).toBe(unknown.text);
      expect(await h.count("select count(*)::text n from sale where business_id=$1 and customer_id=$2", [businessA, b.customer])).toBe(0);
    });

    // Écart constaté (non bloquant pour l'isolation) : la contrainte composite (business_id, customer_id) refuse bien
    // la vente, mais l'erreur 23503 remonte en 500 générique (envoyée à Sentry) au lieu d'un 404 « Client introuvable ».
    // createSale (src/lib/domain/commercial.ts) ne vérifie pas le client avant l'insertion. À corriger hors phase 7.
    it("ventes : un client d'un autre commerce répond comme un client inconnu (404)", async () => {
      const sell = (customerId: string) => h.call(salesRoute.POST, { path: "/api/business/sales", actor: ownerA,
        body: { idempotencyKey: newKey(), customerId, lines: [{ variantId: a.variant, quantity: "1" }], payments: [] } });
      const forB = await sell(b.customer);
      expect(forB.status).toBe(404);
      expectSameAsUnknown(forB, await sell(UNKNOWN_ID));
    });

    it("achats, stock de départ et soldes d'ouverture : aucun fournisseur, produit ou client de B utilisable", async () => {
      const purchase = (supplierId: string, variantId: string) => ({ idempotencyKey: newKey(), supplierId, reference: `ACH-${newKey()}`, lines: [{ variantId, quantity: "1", unitCostXof: "10" }] });
      expectSameAsUnknown(
        await h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: ownerA, body: purchase(b.supplier, a.variant) }),
        await h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: ownerA, body: purchase(UNKNOWN_ID, a.variant) }));
      expectSameAsUnknown(
        await h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: ownerA, body: purchase(a.supplier, b.variant) }),
        await h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: ownerA, body: purchase(a.supplier, UNKNOWN_ID) }));
      const opening = (variantId: string) => ({ idempotencyKey: newKey(), referenceDate: todayAbidjan(), lines: [{ variantId, quantity: "99" }] });
      expectSameAsUnknown(
        await h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: ownerA, body: opening(b.variant) }),
        await h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: ownerA, body: opening(UNKNOWN_ID) }));
      const balance = (partyId: string) => ({ idempotencyKey: newKey(), partyType: "customer", partyId, amountXof: "1000", asOfDate: todayAbidjan() });
      expectSameAsUnknown(
        await h.call(openingBalancesRoute.POST, { path: "/api/business/opening-balances", actor: ownerA, body: balance(b.customer) }),
        await h.call(openingBalancesRoute.POST, { path: "/api/business/opening-balances", actor: ownerA, body: balance(UNKNOWN_ID) }));
      const settle = { amountXof: "100", method: "cash" };
      expectSameAsUnknown(
        await h.call(openingBalancePaymentsRoute.POST, { path: `/api/business/opening-balances/${b.balance}/payments`, actor: ownerA, params: { balanceId: b.balance }, body: { ...settle, idempotencyKey: newKey() } }),
        await h.call(openingBalancePaymentsRoute.POST, { path: `/api/business/opening-balances/${UNKNOWN_ID}/payments`, actor: ownerA, params: { balanceId: UNKNOWN_ID }, body: { ...settle, idempotencyKey: newKey() } }));
    });

    it("inventaires : ni comptage, ni soumission, ni validation, ni périmètre sur une catégorie de B", async () => {
      for (const [route, suffix, body] of [
        [inventoryCountsRoute.POST, "counts", { variantId: b.variant, countedQty: "0", adjustmentReason: "vol" }],
        [inventorySubmitRoute.POST, "submit", {}],
        [inventoryValidateRoute.POST, "validate", {}],
      ] as const) {
        expectSameAsUnknown(
          await h.call(route, { path: `/api/business/inventories/${b.inventory}/${suffix}`, actor: ownerA, params: { sessionId: b.inventory }, body }),
          await h.call(route, { path: `/api/business/inventories/${UNKNOWN_ID}/${suffix}`, actor: ownerA, params: { sessionId: UNKNOWN_ID }, body }));
      }
      const scoped = await h.call(inventoriesRoute.POST, { path: "/api/business/inventories", actor: ownerA, body: { categoryId: b.category } });
      expect(scoped.status).toBe(404);
      expectNoLeak(scoped);
    });

    it("caisse : ni mouvement, ni clôture, ni validation d'une session de B", async () => {
      for (const [route, suffix, body] of [
        [cashMovementsRoute.POST, "movements", { direction: "out", amountXof: "5000", reason: "Retrait" }],
        [cashCloseRoute.POST, "close", { countedCashXof: "0" }],
        [cashValidateRoute.POST, "validate", {}],
      ] as const) {
        expectSameAsUnknown(
          await h.call(route, { path: `/api/business/cash/${b.cash}/${suffix}`, actor: ownerA, params: { sessionId: b.cash }, body: { ...body, idempotencyKey: newKey() } }),
          await h.call(route, { path: `/api/business/cash/${UNKNOWN_ID}/${suffix}`, actor: ownerA, params: { sessionId: UNKNOWN_ID }, body: { ...body, idempotencyKey: newKey() } }));
      }
    });

    it("imports : un lot de B ne peut être ni corrigé, ni appliqué, ni abandonné ; aucun produit de B rattachable", async () => {
      const mapping = { headerRowNumber: 1, mapping: [{ column: 0, field: "name" }, { column: 1, field: "salePrice" }] };
      expectSameAsUnknown(
        await h.call(importRoute.PATCH, { method: "PATCH", path: `/api/business/imports/${b.import}`, actor: ownerA, params: { importId: b.import }, body: mapping }),
        await h.call(importRoute.PATCH, { method: "PATCH", path: `/api/business/imports/${UNKNOWN_ID}`, actor: ownerA, params: { importId: UNKNOWN_ID }, body: mapping }));
      expectSameAsUnknown(
        await h.call(importRowRoute.PATCH, { method: "PATCH", path: `/api/business/imports/${b.import}/rows/${b.importRow}`, actor: ownerA, params: { importId: b.import, rowId: b.importRow }, body: { decision: "skip" } }),
        await h.call(importRowRoute.PATCH, { method: "PATCH", path: `/api/business/imports/${UNKNOWN_ID}/rows/${UNKNOWN_ID}`, actor: ownerA, params: { importId: UNKNOWN_ID, rowId: UNKNOWN_ID }, body: { decision: "skip" } }));
      expectSameAsUnknown(
        await h.call(importApplyRoute.POST, { path: `/api/business/imports/${b.import}/apply`, actor: ownerA, params: { importId: b.import }, body: { idempotencyKey: newKey() } }),
        await h.call(importApplyRoute.POST, { path: `/api/business/imports/${UNKNOWN_ID}/apply`, actor: ownerA, params: { importId: UNKNOWN_ID }, body: { idempotencyKey: newKey() } }));
      expectSameAsUnknown(
        await h.call(importDiscardRoute.POST, { path: `/api/business/imports/${b.import}/discard`, actor: ownerA, params: { importId: b.import } }),
        await h.call(importDiscardRoute.POST, { path: `/api/business/imports/${UNKNOWN_ID}/discard`, actor: ownerA, params: { importId: UNKNOWN_ID } }));
      // Ligne d'un import de A rattachée à un produit de B : refusé comme un produit inexistant.
      expectSameAsUnknown(
        await h.call(importRowRoute.PATCH, { method: "PATCH", path: `/api/business/imports/${a.import}/rows/${a.importRow}`, actor: ownerA, params: { importId: a.import, rowId: a.importRow }, body: { decision: "match", matchVariantId: b.variant } }),
        await h.call(importRowRoute.PATCH, { method: "PATCH", path: `/api/business/imports/${a.import}/rows/${a.importRow}`, actor: ownerA, params: { importId: a.import, rowId: a.importRow }, body: { decision: "match", matchVariantId: UNKNOWN_ID } }));
    });

    it("impression : ni imprimante, ni ticket, ni réimpression, ni résultat de tâche de B", async () => {
      const profile = { paperWidthMm: 58, codePage: "pc850", renderMode: "text" };
      expectSameAsUnknown(
        await h.call(printDeviceRoute.PATCH, { method: "PATCH", path: `/api/business/printing/devices/${b.device}`, actor: ownerA, params: { deviceId: b.device }, body: profile }),
        await h.call(printDeviceRoute.PATCH, { method: "PATCH", path: `/api/business/printing/devices/${UNKNOWN_ID}`, actor: ownerA, params: { deviceId: UNKNOWN_ID }, body: profile }));
      expectSameAsUnknown(
        await h.call(printDeviceRoute.DELETE, { method: "DELETE", path: `/api/business/printing/devices/${b.device}`, actor: ownerA, params: { deviceId: b.device } }),
        await h.call(printDeviceRoute.DELETE, { method: "DELETE", path: `/api/business/printing/devices/${UNKNOWN_ID}`, actor: ownerA, params: { deviceId: UNKNOWN_ID } }));
      const job = (body: Record<string, unknown>) => h.call(printJobsRoute.POST, { path: "/api/business/printing/jobs", actor: ownerA, body });
      expectSameAsUnknown(await job({ deviceId: b.device, kind: "test" }), await job({ deviceId: UNKNOWN_ID, kind: "test" }));
      // Ticket de la vente de B sur l'imprimante de A : la vente n'existe pas pour A.
      expectSameAsUnknown(await job({ deviceId: a.device, kind: "receipt", saleId: b.sale }), await job({ deviceId: a.device, kind: "receipt", saleId: UNKNOWN_ID }));
      // Réimpression d'une tâche de B rattachée à une vente de A.
      expectSameAsUnknown(
        await job({ deviceId: a.device, kind: "receipt", saleId: a.sale, reprintOfJobId: b.job, idempotencyKey: newKey() }),
        await job({ deviceId: a.device, kind: "receipt", saleId: a.sale, reprintOfJobId: UNKNOWN_ID, idempotencyKey: newKey() }));
      expectSameAsUnknown(
        await h.call(printJobRoute.POST, { path: `/api/business/printing/jobs/${b.job}`, actor: ownerA, params: { jobId: b.job }, body: { status: "printed" } }),
        await h.call(printJobRoute.POST, { path: `/api/business/printing/jobs/${UNKNOWN_ID}`, actor: ownerA, params: { jobId: UNKNOWN_ID }, body: { status: "printed" } }));
    });

    it("équipe : ni rôle, ni accès, ni invitation d'un membre de B ; B ne peut pas être sélectionné", async () => {
      expectSameAsUnknown(
        await h.call(teamMemberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${b.cashierMember}`, actor: ownerA, params: { memberId: b.cashierMember }, body: { role: "admin" } }),
        await h.call(teamMemberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${UNKNOWN_ID}`, actor: ownerA, params: { memberId: UNKNOWN_ID }, body: { role: "admin" } }));
      expectSameAsUnknown(
        await h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${b.ownerMember}/access`, actor: ownerA, params: { memberId: b.ownerMember }, body: { disabled: true } }),
        await h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${UNKNOWN_ID}/access`, actor: ownerA, params: { memberId: UNKNOWN_ID }, body: { disabled: true } }));
      expectSameAsUnknown(
        await h.call(teamInvitationRoute.DELETE, { method: "DELETE", path: `/api/business/team/invitations/${b.invitation}`, actor: ownerA, params: { invitationId: b.invitation } }),
        await h.call(teamInvitationRoute.DELETE, { method: "DELETE", path: `/api/business/team/invitations/${UNKNOWN_ID}`, actor: ownerA, params: { invitationId: UNKNOWN_ID } }));
      // Invitation adressée à une autre personne : ni lue ni acceptée.
      expectSameAsUnknown(
        await h.call(accountInvitationRoute.GET, { path: `/api/account/invitations/${b.invitation}`, actor: ownerA, params: { invitationId: b.invitation } }),
        await h.call(accountInvitationRoute.GET, { path: `/api/account/invitations/${UNKNOWN_ID}`, actor: ownerA, params: { invitationId: UNKNOWN_ID } }));
      const accept = await h.call(accountInvitationRoute.POST, { path: `/api/account/invitations/${b.invitation}`, actor: ownerA, params: { invitationId: b.invitation } });
      expect(accept.status).toBeGreaterThanOrEqual(400);
      expectNoLeak(accept);
      const select = await h.call(accountActiveBusinessRoute.POST, { path: "/api/account/active-business", actor: ownerA, body: { businessId: businessB } });
      const selectUnknown = await h.call(accountActiveBusinessRoute.POST, { path: "/api/account/active-business", actor: ownerA, body: { businessId: UNKNOWN_ID } });
      expectSameAsUnknown(select, selectUnknown, 403);
      // Les routes HTTP du plugin Organization de Better Auth restent fermées (hook `before`) :
      // aucune ne permet de choisir, lire ou modifier le commerce B en contournant les services.
      for (const [method, path, body] of [
        ["POST", "/api/auth/organization/set-active", { organizationId: businessB }],
        ["POST", "/api/auth/organization/update", { organizationId: businessB, data: { name: "Commerce pris" } }],
        ["POST", "/api/auth/organization/remove-member", { organizationId: businessB, memberIdOrEmail: "owner@beta.test" }],
        ["GET", `/api/auth/organization/get-full-organization?organizationId=${businessB}`, undefined],
      ] as const) {
        const response = await h.call(method === "GET" ? authRoute.GET : authRoute.POST, { method, path, actor: ownerA, body });
        expect(response.status, path).toBe(404);
        expectNoLeak(response);
      }
    });

    it("notifications : ni lecture marquée, ni appareil supprimé chez B", async () => {
      expect(b.notification, "la vente du caissier de B doit notifier son propriétaire").not.toBe("");
      const read = await h.call(notificationsReadRoute.POST, { path: "/api/notifications/read", actor: ownerA, body: { ids: [b.notification] } });
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ updated: 0 });
      expectSameAsUnknown(
        await h.call(pushSubscriptionRoute.DELETE, { method: "DELETE", path: `/api/notifications/push-subscriptions/${b.push}`, actor: ownerA, params: { subscriptionId: b.push } }),
        await h.call(pushSubscriptionRoute.DELETE, { method: "DELETE", path: `/api/notifications/push-subscriptions/${UNKNOWN_ID}`, actor: ownerA, params: { subscriptionId: UNKNOWN_ID } }));
      // L'adresse push d'un appareil de B ne peut pas être reprise par A.
      const takeover = await h.call(pushSubscriptionsRoute.POST, { path: "/api/notifications/push-subscriptions", actor: ownerA, body: { endpoint: "https://fcm.googleapis.com/fcm/send/harnais-beta", keys: PUSH_KEYS } });
      expect(takeover.status).toBe(409);
      expectNoLeak(takeover);
      // « Oublier cet appareil » avec l'adresse d'un appareil de B : sans effet.
      const forget = await h.call(pushSubscriptionsRoute.DELETE, { method: "DELETE", path: "/api/notifications/push-subscriptions", actor: ownerA, body: { endpoint: "https://fcm.googleapis.com/fcm/send/harnais-beta" } });
      expect(forget.status).toBe(200);
      expect(forget.body).toEqual({ removed: false });
      // Compteur et préférences : uniquement ceux de A.
      const unread = await h.call(notificationsUnreadRoute.GET, { path: "/api/notifications/unread-count", actor: ownerA });
      expect(unread.status).toBe(200);
      expect(unread.body.unreadCount).toBe(await h.count("select count(*)::text n from notification where user_id=$1 and business_id=$2 and read_at is null", [ownerA.userId, businessA]));
      const preferences = await h.call(notificationPreferencesRoute.GET, { path: "/api/notifications/preferences", actor: ownerA });
      expect(preferences.status).toBe(200);
      expect(preferences.body.devices).toEqual([]);
      expectNoLeak(preferences);
      // Portée « plateforme » demandée par un commerçant : refusée comme la console.
      expect((await h.call(notificationPreferencesRoute.GET, { path: "/api/notifications/preferences?scope=platform", actor: ownerA })).status).toBe(404);
      // Préférences : un `userId` glissé dans le corps ou l'URL est ignoré, seule la session compte.
      const preferencesOfB = await h.count("select count(*)::text n from notification_preference where user_id=$1", [ownerB.userId]);
      const update = { ...preferences.body, devices: undefined, userId: ownerB.userId, locale: "ar", pushEnabled: false };
      const put = await h.call(notificationPreferencesRoute.PUT, { method: "PUT", path: `/api/notifications/preferences?userId=${ownerB.userId}`, actor: ownerA, body: update });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ locale: "ar", pushEnabled: false });
      expect(await h.count("select count(*)::text n from notification_preference where user_id=$1", [ownerB.userId])).toBe(preferencesOfB);
      expect(await h.count("select count(*)::text n from notification_preference where user_id=$1 and locale='ar'", [ownerA.userId])).toBe(1);
    });

    it("abonnement : un code réservé à B répond à A exactement comme un code inconnu", async () => {
      const reserved = await h.call(subscriptionPromotionRoute.POST, { path: "/api/business/subscription/promotion", actor: ownerA, body: { code: "RESERVE-BETA" } });
      const unknown = await h.call(subscriptionPromotionRoute.POST, { path: "/api/business/subscription/promotion", actor: ownerA, body: { code: "CODE-INEXISTANT" } });
      expectSameAsUnknown(reserved, unknown);
    });

    it("plateforme : un commerçant ne voit pas la console et ne peut pas suspendre B", async () => {
      expectSameAsUnknown(
        await h.call(platformBusinessRoute.GET, { path: `/api/platform/businesses/${businessB}`, actor: ownerA, params: { businessId: businessB } }),
        await h.call(platformBusinessRoute.GET, { path: `/api/platform/businesses/${UNKNOWN_ID}`, actor: ownerA, params: { businessId: UNKNOWN_ID } }));
      const suspend = await h.call(platformBusinessRoute.PATCH, { method: "PATCH", path: `/api/platform/businesses/${businessB}`, actor: ownerA, params: { businessId: businessB }, body: { status: "suspended", reason: "Tentative de A" } });
      expect(suspend.status).toBe(404);
    });

    it("un identifiant de commerce glissé dans le corps ou les en-têtes est ignoré : l'écriture reste chez A", async () => {
      const created = await h.call(customersRoute.POST, { path: "/api/business/customers", actor: ownerA, headers: { "x-business-id": businessB },
        body: { businessId: businessB, actorUserId: ownerB.userId, name: "Client glissé" } });
      expect(created.status).toBe(201);
      const [row] = (await h.client.query<{ business_id: string }>("select business_id from customer where id=$1", [created.body.customer.id])).rows;
      expect(row!.business_id).toBe(businessA);
      const settings = await h.call(settingsRoute.PATCH, { method: "PATCH", path: "/api/business/settings", actor: ownerA, body: {
        businessId: businessB, name: "Quincaillerie Alpha", phone: null, address: null, email: null, primaryColor: "#2563EB", paperWidthMm: 58, showLogo: true, receiptFooter: null } });
      expect(settings.status).toBe(200);
      const expense = await h.call(expensesRoute.POST, { path: "/api/business/expenses", actor: ownerA,
        body: { businessId: businessB, idempotencyKey: newKey(), category: "Divers", description: "Dépense glissée", amountXof: "100" } });
      expect(expense.status).toBe(201);
      expect(await h.count("select count(*)::text n from expense where business_id=$1 and description='Dépense glissée'", [businessA])).toBe(1);
    });
  });

  describe("exports de rapports", () => {
    it("CSV, XLSX et PDF de A ne contiennent aucune donnée de B, même avec un businessId de B en paramètre", async () => {
      for (const format of ["csv", "xlsx", "pdf"]) {
        const result = await h.call(reportExportRoute.GET, { path: `/api/business/reports/export?format=${format}&period=daily&lang=fr&businessId=${businessB}`, actor: ownerA, headers: { "x-business-id": businessB } });
        expect(result.status, `${format} : ${result.text.slice(0, 200)}`).toBe(200);
        // XLSX : zip compressé, relu cellule par cellule ; PDF : polices standard en Latin-1.
        const content = format === "xlsx" ? JSON.stringify(await readXlsxFile(Buffer.from(result.bytes), { trim: false }))
          : format === "pdf" ? Buffer.from(result.bytes).toString("latin1") : result.text;
        if (format === "xlsx") expect(content).toContain("Ciment Alpha");
        if (format === "pdf") expect(content).toContain("Quincaillerie Alpha");
        for (const secret of SECRETS_B) expect(content, format).not.toContain(secret);
        for (const id of [b.sale, b.customer, b.product, b.variant]) expect(content, format).not.toContain(id);
      }
    });
  });

  it("après toutes ces tentatives, l'état complet de B est inchangé", async () => {
    expect(await snapshot(businessB)).toBe(snapshotBefore);
  });
});
