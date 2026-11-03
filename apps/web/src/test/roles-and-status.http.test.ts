import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as accountActiveBusinessRoute from "@/app/api/account/active-business/route";
import * as cashCloseRoute from "@/app/api/business/cash/[sessionId]/close/route";
import * as cashSessionRoute from "@/app/api/business/cash/[sessionId]/route";
import * as cashValidateRoute from "@/app/api/business/cash/[sessionId]/validate/route";
import * as cashRoute from "@/app/api/business/cash/route";
import * as categoriesRoute from "@/app/api/business/categories/route";
import * as customersRoute from "@/app/api/business/customers/route";
import * as dashboardRoute from "@/app/api/business/dashboard/route";
import * as expensesRoute from "@/app/api/business/expenses/route";
import * as importsRoute from "@/app/api/business/imports/route";
import * as inventoriesRoute from "@/app/api/business/inventories/route";
import * as printDevicesRoute from "@/app/api/business/printing/devices/route";
import * as printJobsRoute from "@/app/api/business/printing/jobs/route";
import * as printingRoute from "@/app/api/business/printing/route";
import * as productRoute from "@/app/api/business/products/[productId]/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as purchasesRoute from "@/app/api/business/purchases/route";
import * as reportExportRoute from "@/app/api/business/reports/export/route";
import * as reportsRoute from "@/app/api/business/reports/route";
import * as salesRoute from "@/app/api/business/sales/route";
import * as settingsRoute from "@/app/api/business/settings/route";
import * as stockOpeningRoute from "@/app/api/business/stock/opening/route";
import * as subscriptionPromotionRoute from "@/app/api/business/subscription/promotion/route";
import * as suppliersRoute from "@/app/api/business/suppliers/route";
import * as teamInvitationsRoute from "@/app/api/business/team/invitations/route";
import * as teamMemberAccessRoute from "@/app/api/business/team/members/[memberId]/access/route";
import * as teamMemberRoute from "@/app/api/business/team/members/[memberId]/route";
import * as teamRoute from "@/app/api/business/team/route";
import * as platformBusinessRoute from "@/app/api/platform/businesses/[businessId]/route";
import { newKey, startHttpHarness, todayAbidjan, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 11, phase 7 : rôles, membre désactivé et commerce suspendu ou expiré, vérifiés sur les routes
 * HTTP avec de vraies sessions Better Auth.
 */
describe("mission 11, phase 7 : rôles et états du commerce sur les routes HTTP", () => {
  let h: HttpHarness;
  let owner: Actor; let manager: Actor; let cashier: Actor; let platformAdmin: Actor;
  let business = "";
  const ids: Record<string, string> = {};

  async function ok(result: Promise<HttpResult>, status = 201) {
    const response = await result;
    if (response.status !== status) throw new Error(`Préparation : statut ${response.status} au lieu de ${status} : ${response.text}`);
    return response.body;
  }

  /** Commerce complet : propriétaire, un produit en stock et une caisse ouverte. */
  async function seedBusiness(name: string, email: string) {
    const actor = await h.signUp(`Propriétaire ${name}`, email);
    const id = await h.createBusiness(actor, name);
    const product = (await ok(h.call(productsRoute.POST, { path: "/api/business/products", actor, body: { name: `Article ${name}`, salePriceXof: "1500" } }))).product;
    await ok(h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor, body: { idempotencyKey: newKey(), referenceDate: todayAbidjan(), lines: [{ variantId: product.variantId, quantity: "50", unitCostXof: "1000" }] } }));
    const supplier = (await ok(h.call(suppliersRoute.POST, { path: "/api/business/suppliers", actor, body: { name: `Fournisseur ${name}` } }))).supplier.id;
    await ok(h.call(printingRoute.PUT, { method: "PUT", path: "/api/business/printing", actor, body: { enabled: true, autoPrint: false } }), 200);
    const device = (await ok(h.call(printDevicesRoute.POST, { path: "/api/business/printing/devices", actor, body: { name: "Imprimante", transport: "simulated", paperWidthMm: 58, agentId: null } }))).id;
    return { actor, id, productId: product.id as string, variantId: product.variantId as string, supplier: supplier as string, device: device as string };
  }

  beforeAll(async () => {
    h = await startHttpHarness();
    const seeded = await seedBusiness("Delta", "owner@delta.test");
    owner = seeded.actor; business = seeded.id;
    ids.product = seeded.productId; ids.variant = seeded.variantId; ids.supplier = seeded.supplier; ids.device = seeded.device;
    manager = await h.addMember(owner, "Gérant Delta", "gerant@delta.test", "admin");
    cashier = await h.addMember(owner, "Caissier Delta", "caissier@delta.test", "cashier");
    ids.ownerCash = (await ok(h.call(cashRoute.POST, { path: "/api/business/cash", actor: owner, body: { idempotencyKey: newKey(), openingFloatXof: "0" } }))).session.id;
    const team = await ok(h.call(teamRoute.GET, { path: "/api/business/team", actor: owner }), 200);
    const memberId = (email: string) => team.members.find((row: { email: string }) => row.email === email).memberId as string;
    ids.ownerMember = memberId("owner@delta.test"); ids.cashierMember = memberId("caissier@delta.test"); ids.managerMember = memberId("gerant@delta.test");
    platformAdmin = await h.signUp("Super Admin", "admin@qadr.test");
    await h.grantPlatformAdmin(platformAdmin);
  });

  afterAll(async () => { await h?.close(); });

  describe("sans session", () => {
    it("toute route métier répond 401 sans cookie ou avec un cookie forgé", async () => {
      for (const cookie of [null, "better-auth.session_token=forge.signature"]) {
        const actor = cookie ? { ...owner, cookie } : null;
        for (const result of await Promise.all([
          h.call(productsRoute.GET, { path: "/api/business/products", actor }),
          h.call(salesRoute.POST, { path: "/api/business/sales", actor, body: { idempotencyKey: newKey(), lines: [{ variantId: ids.variant, quantity: "1" }] } }),
          h.call(reportExportRoute.GET, { path: "/api/business/reports/export?format=csv", actor }),
          h.call(teamRoute.GET, { path: "/api/business/team", actor }),
        ])) {
          expect(result.status).toBe(401);
          expect(result.body).toEqual({ error: "Authentification requise." });
        }
      }
    });
  });

  describe("caissier", () => {
    it("vend, crée un client et ouvre sa caisse", async () => {
      expect((await h.call(productsRoute.GET, { path: "/api/business/products", actor: cashier })).status).toBe(200);
      expect((await h.call(cashRoute.POST, { path: "/api/business/cash", actor: cashier, body: { idempotencyKey: newKey(), openingFloatXof: "2000" } })).status).toBe(201);
      expect((await h.call(salesRoute.POST, { path: "/api/business/sales", actor: cashier, body: { idempotencyKey: newKey(), lines: [{ variantId: ids.variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "1500" }] } })).status).toBe(201);
      expect((await h.call(customersRoute.POST, { path: "/api/business/customers", actor: cashier, body: { name: "Client du caissier" } })).status).toBe(201);
    });

    it("ne fait aucune action réservée au propriétaire ou au gérant (403, sans effet)", async () => {
      // Seule trace attendue : le refus du code d'abonnement, journalisé exprès contre l'énumération des codes.
      const auditSql = "select count(*)::text n from audit_event where business_id=$1 and event_type <> 'subscription.promotion_rejected'";
      const before = await h.count(auditSql, [business]);
      const productEdit = { variantId: ids.variant, name: "Renommé", description: null, categoryId: null, variantLabel: "Standard", sku: null, salePriceXof: "1", lowStockThreshold: "0" };
      const refused: [string, Promise<HttpResult>][] = [
        ["créer un produit", h.call(productsRoute.POST, { path: "/api/business/products", actor: cashier, body: { name: "Interdit", salePriceXof: "1" } })],
        ["modifier un produit", h.call(productRoute.PATCH, { method: "PATCH", path: `/api/business/products/${ids.product}`, actor: cashier, params: { productId: ids.product }, body: productEdit })],
        ["archiver un produit", h.call(productRoute.DELETE, { method: "DELETE", path: `/api/business/products/${ids.product}`, actor: cashier, params: { productId: ids.product } })],
        ["créer une catégorie", h.call(categoriesRoute.POST, { path: "/api/business/categories", actor: cashier, body: { name: "Interdite" } })],
        ["lire les rapports", h.call(reportsRoute.GET, { path: "/api/business/reports?period=daily", actor: cashier })],
        ["exporter en XLSX", h.call(reportExportRoute.GET, { path: "/api/business/reports/export?format=xlsx", actor: cashier })],
        ["exporter en CSV", h.call(reportExportRoute.GET, { path: "/api/business/reports/export?format=csv", actor: cashier })],
        ["tableau de bord", h.call(dashboardRoute.GET, { path: "/api/business/dashboard", actor: cashier })],
        ["modifier les réglages", h.call(settingsRoute.PATCH, { method: "PATCH", path: "/api/business/settings", actor: cashier, body: { name: "Piraté", phone: null, address: null, email: null, primaryColor: "#000000", paperWidthMm: 58, showLogo: false, receiptFooter: null } })],
        ["voir l'équipe", h.call(teamRoute.GET, { path: "/api/business/team", actor: cashier })],
        ["inviter", h.call(teamInvitationsRoute.POST, { path: "/api/business/team/invitations", actor: cashier, body: { email: "complice@delta.test", role: "admin" } })],
        ["changer un rôle", h.call(teamMemberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${ids.cashierMember}`, actor: cashier, params: { memberId: ids.cashierMember }, body: { role: "admin" } })],
        ["désactiver le propriétaire", h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${ids.ownerMember}/access`, actor: cashier, params: { memberId: ids.ownerMember }, body: { disabled: true } })],
        ["lire les dépenses", h.call(expensesRoute.GET, { path: "/api/business/expenses", actor: cashier })],
        ["créer une dépense", h.call(expensesRoute.POST, { path: "/api/business/expenses", actor: cashier, body: { idempotencyKey: newKey(), category: "Divers", description: "Interdite", amountXof: "100" } })],
        ["créer un fournisseur", h.call(suppliersRoute.POST, { path: "/api/business/suppliers", actor: cashier, body: { name: "Interdit" } })],
        ["recevoir un achat", h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor: cashier, body: { idempotencyKey: newKey(), supplierId: ids.supplier, reference: "ACH-INTERDIT", lines: [{ variantId: ids.variant, quantity: "1", unitCostXof: "1" }] } })],
        ["stock de départ", h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: cashier, body: { idempotencyKey: newKey(), referenceDate: todayAbidjan(), lines: [{ variantId: ids.variant, quantity: "1" }] } })],
        ["démarrer un inventaire", h.call(inventoriesRoute.POST, { path: "/api/business/inventories", actor: cashier, body: {} })],
        ["importer un catalogue", (() => { const form = new FormData(); form.append("file", new File(["Désignation;Prix\nX;1\n"], "x.csv", { type: "text/csv" })); return h.call(importsRoute.POST, { path: "/api/business/imports", actor: cashier, form }); })()],
        ["configurer l'impression", h.call(printingRoute.PUT, { method: "PUT", path: "/api/business/printing", actor: cashier, body: { enabled: false, autoPrint: false } })],
        ["déclarer une imprimante", h.call(printDevicesRoute.POST, { path: "/api/business/printing/devices", actor: cashier, body: { name: "Interdite", transport: "simulated", paperWidthMm: 58, agentId: null } })],
        ["appliquer un code d'abonnement", h.call(subscriptionPromotionRoute.POST, { path: "/api/business/subscription/promotion", actor: cashier, body: { code: "PEU-IMPORTE" } })],
        ["lire la caisse du propriétaire", h.call(cashSessionRoute.GET, { path: `/api/business/cash/${ids.ownerCash}`, actor: cashier, params: { sessionId: ids.ownerCash } })],
        ["clôturer la caisse du propriétaire", h.call(cashCloseRoute.POST, { path: `/api/business/cash/${ids.ownerCash}/close`, actor: cashier, params: { sessionId: ids.ownerCash }, body: { idempotencyKey: newKey(), countedCashXof: "0" } })],
        ["valider une caisse", h.call(cashValidateRoute.POST, { path: `/api/business/cash/${ids.ownerCash}/validate`, actor: cashier, params: { sessionId: ids.ownerCash }, body: { idempotencyKey: newKey() } })],
        ["console plateforme", h.call(platformBusinessRoute.GET, { path: `/api/platform/businesses/${business}`, actor: cashier, params: { businessId: business } })],
      ];
      for (const [label, pending] of refused) {
        const result = await pending;
        // La console plateforme se cache (404) ; toutes les autres refusent explicitement (403).
        expect(result.status, `${label} : ${result.text}`).toBe(label === "console plateforme" ? 404 : 403);
        expect(result.text).not.toMatch(/stack|select |insert |postgres/i);
      }
      expect(await h.count(auditSql, [business])).toBe(before);
      expect(await h.count("select count(*)::text n from audit_event where business_id=$1 and event_type='subscription.promotion_rejected'", [business])).toBe(1);
      expect(await h.count("select count(*)::text n from product where business_id=$1 and archived_at is null and name='Article Delta'", [business])).toBe(1);
    });
  });

  describe("gérant (admin)", () => {
    it("gère le catalogue et l'équipe, sans pouvoir toucher au propriétaire ni nommer un propriétaire", async () => {
      expect((await h.call(productsRoute.POST, { path: "/api/business/products", actor: manager, body: { name: "Article du gérant", salePriceXof: "700" } })).status).toBe(201);
      expect((await h.call(teamInvitationsRoute.POST, { path: "/api/business/team/invitations", actor: manager, body: { email: "nouveau@delta.test", role: "cashier" } })).status).toBe(201);
      const promote = await h.call(teamInvitationsRoute.POST, { path: "/api/business/team/invitations", actor: manager, body: { email: "coproprio@delta.test", role: "owner" } });
      expect(promote.status).toBe(403);
      const demote = await h.call(teamMemberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${ids.ownerMember}`, actor: manager, params: { memberId: ids.ownerMember }, body: { role: "cashier" } });
      expect(demote.status).toBe(403);
      const disable = await h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${ids.ownerMember}/access`, actor: manager, params: { memberId: ids.ownerMember }, body: { disabled: true } });
      expect(disable.status).toBe(403);
      const self = await h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${ids.managerMember}/access`, actor: manager, params: { memberId: ids.managerMember }, body: { disabled: true } });
      expect(self.status).toBe(403);
      expect(await h.count("select count(*)::text n from member where organization_id=$1 and role='owner'", [business])).toBe(1);
    });
  });

  describe("membre désactivé", () => {
    it("perd immédiatement l'accès, ne peut pas resélectionner le commerce, puis le retrouve après réactivation", async () => {
      const disabled = await h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${ids.cashierMember}/access`, actor: owner, params: { memberId: ids.cashierMember }, body: { disabled: true } });
      expect(disabled.status).toBe(200);
      // Sa session n'a plus de commerce actif.
      const read = await h.call(productsRoute.GET, { path: "/api/business/products", actor: cashier });
      expect(read.status).toBe(403);
      const reselect = await h.call(accountActiveBusinessRoute.POST, { path: "/api/account/active-business", actor: cashier, body: { businessId: business } });
      expect(reselect.status).toBe(403);
      expect(reselect.body.error).toBe("Votre accès à ce commerce a été désactivé.");
      // Même une session restée sur ce commerce (ancienne session, autre appareil) est refusée à chaque requête.
      const otherDevice = await h.signIn(cashier);
      await h.client.query("update session set active_organization_id=$1 where user_id=$2", [business, cashier.userId]);
      for (const result of await Promise.all([
        h.call(productsRoute.GET, { path: "/api/business/products", actor: otherDevice }),
        h.call(salesRoute.POST, { path: "/api/business/sales", actor: otherDevice, body: { idempotencyKey: newKey(), lines: [{ variantId: ids.variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "1500" }] } }),
        h.call(cashRoute.GET, { path: "/api/business/cash", actor: otherDevice }),
      ])) {
        expect(result.status).toBe(403);
        expect(result.body.error).toBe("Votre accès à ce commerce a été désactivé.");
      }
      const enabled = await h.call(teamMemberAccessRoute.POST, { path: `/api/business/team/members/${ids.cashierMember}/access`, actor: owner, params: { memberId: ids.cashierMember }, body: { disabled: false } });
      expect(enabled.status).toBe(200);
      expect((await h.call(accountActiveBusinessRoute.POST, { path: "/api/account/active-business", actor: cashier, body: { businessId: business } })).status).toBe(200);
      expect((await h.call(productsRoute.GET, { path: "/api/business/products", actor: cashier })).status).toBe(200);
    });
  });

  describe("commerce suspendu ou expiré", () => {
    /** Tentatives d'écriture courantes ; toutes doivent être refusées sans rien écrire. */
    function writes(actor: Actor, seeded: { productId: string; variantId: string; supplier: string; device: string }) {
      const productEdit = { variantId: seeded.variantId, name: "Renommé", description: null, categoryId: null, variantLabel: "Standard", sku: null, salePriceXof: "1", lowStockThreshold: "0" };
      return [
        h.call(productsRoute.POST, { path: "/api/business/products", actor, body: { name: "Bloqué", salePriceXof: "1" } }),
        h.call(productRoute.PATCH, { method: "PATCH", path: `/api/business/products/${seeded.productId}`, actor, params: { productId: seeded.productId }, body: productEdit }),
        h.call(salesRoute.POST, { path: "/api/business/sales", actor, body: { idempotencyKey: newKey(), lines: [{ variantId: seeded.variantId, quantity: "1" }], payments: [{ method: "cash", amountXof: "1500" }] } }),
        h.call(customersRoute.POST, { path: "/api/business/customers", actor, body: { name: "Bloqué" } }),
        h.call(expensesRoute.POST, { path: "/api/business/expenses", actor, body: { idempotencyKey: newKey(), category: "Divers", description: "Bloquée", amountXof: "100" } }),
        h.call(purchasesRoute.POST, { path: "/api/business/purchases", actor, body: { idempotencyKey: newKey(), supplierId: seeded.supplier, reference: `ACH-${newKey()}`, lines: [{ variantId: seeded.variantId, quantity: "1", unitCostXof: "1" }] } }),
        h.call(cashRoute.POST, { path: "/api/business/cash", actor, body: { idempotencyKey: newKey(), openingFloatXof: "0" } }),
        h.call(inventoriesRoute.POST, { path: "/api/business/inventories", actor, body: {} }),
        h.call(printJobsRoute.POST, { path: "/api/business/printing/jobs", actor, body: { deviceId: seeded.device, kind: "test" } }),
      ];
    }

    async function expectBlocked(actor: Actor, businessId: string, seeded: Parameters<typeof writes>[1], message: RegExp) {
      const audit = await h.count("select count(*)::text n from audit_event where business_id=$1", [businessId]);
      for (const result of await Promise.all(writes(actor, seeded))) {
        expect(result.status, result.text).toBe(403);
        expect(result.body.error).toMatch(message);
      }
      expect(await h.count("select count(*)::text n from audit_event where business_id=$1", [businessId])).toBe(audit);
      // Les lectures et exports restent possibles : les données ne sont jamais confisquées.
      for (const result of await Promise.all([
        h.call(productsRoute.GET, { path: "/api/business/products", actor }),
        h.call(reportsRoute.GET, { path: "/api/business/reports?period=daily", actor }),
        h.call(reportExportRoute.GET, { path: "/api/business/reports/export?format=csv&period=daily", actor }),
      ])) expect(result.status).toBe(200);
    }

    it("suspendu par la console plateforme : écritures refusées, lectures permises, puis reprise après réactivation", async () => {
      const seeded = await seedBusiness("Gamma", "owner@gamma.test");
      const suspend = await h.call(platformBusinessRoute.PATCH, { method: "PATCH", path: `/api/platform/businesses/${seeded.id}`, actor: platformAdmin, params: { businessId: seeded.id }, body: { status: "suspended", reason: "Contrôle de la phase 7" } });
      expect(suspend.status).toBe(200);
      await expectBlocked(seeded.actor, seeded.id, seeded, /suspendu/);
      const resume = await h.call(platformBusinessRoute.PATCH, { method: "PATCH", path: `/api/platform/businesses/${seeded.id}`, actor: platformAdmin, params: { businessId: seeded.id }, body: { status: "active", reason: "Fin du contrôle" } });
      expect(resume.status).toBe(200);
      expect((await h.call(productsRoute.POST, { path: "/api/business/products", actor: seeded.actor, body: { name: "Après reprise", salePriceXof: "10" } })).status).toBe(201);
    });

    it("abonnement expiré (état posé par l'expiration) : écritures refusées, lectures permises", async () => {
      const seeded = await seedBusiness("Epsilon", "owner@epsilon.test");
      await h.client.query("update business_profile set status='expired' where business_id=$1", [seeded.id]);
      await expectBlocked(seeded.actor, seeded.id, seeded, /abonnement de ce commerce a expiré/);
    });

    it("période d'essai terminée sans renouvellement : écritures refusées dès l'échéance", async () => {
      const seeded = await seedBusiness("Zeta", "owner@zeta.test");
      await h.client.query("insert into subscription_plan (id,code,name,price_xof,duration_days) values ('plan-phase7','PHASE7','Forfait test',5000,30) on conflict do nothing");
      await h.client.query("insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,trial_ends_at,origin) values ($1,$2,'plan-phase7','trialing',now() - interval '15 days',now() - interval '1 minute',now() - interval '1 minute','promotion')",
        [newKey("abonnement"), seeded.id]);
      await expectBlocked(seeded.actor, seeded.id, seeded, /abonnement de ce commerce a expiré/);
    });
  });
});
