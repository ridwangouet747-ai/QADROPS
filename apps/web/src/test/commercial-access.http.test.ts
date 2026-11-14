import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as meRoute from "@/app/api/account/me/route";
import * as dashboardRoute from "@/app/api/business/dashboard/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as settingsRoute from "@/app/api/business/settings/route";
import * as checkoutRoute from "@/app/api/business/subscription/checkout/route";
import * as paymentStatusRoute from "@/app/api/business/subscription/payments/[attemptId]/route";
import * as redeemRoute from "@/app/api/business/subscription/promotion/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as teamInvitationsRoute from "@/app/api/business/team/invitations/route";
import * as promotionsBatchRoute from "@/app/api/platform/promotions/batch/route";
import * as webhookRoute from "@/app/api/webhooks/geniuspay/route";
import { configureFakeGeniusPay, FakeGeniusPay, signedWebhook, unconfigureGeniusPay } from "./fake-geniuspay";
import { HARNESS_ORIGIN, newKey, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission CTO du 2026-11-14 : parcours commercial. Un compte qui vient de créer son commerce n'a aucun droit
 * d'usage : son espace de gestion reste fermé (API et pages) jusqu'à un paiement confirmé par le serveur, un code
 * d'accès valide ou un abonnement accordé par la plateforme. Vraies routes, vraies sessions, base PGlite migrée,
 * GeniusPay simulé (seul `fetch` est remplacé). Aucun paiement réel.
 */

const pendingRefusal = { error: "Ce commerce n’a pas encore d’abonnement actif. Choisissez une formule ou saisissez un code d’accès.", code: "subscription_required" };

describe("parcours commercial : aucun accès à l'espace de gestion sans droit d'usage", () => {
  let h: HttpHarness;
  const fake = new FakeGeniusPay();
  let admin: Actor;
  let counter = 0;

  beforeAll(async () => {
    h = await startHttpHarness();
    configureFakeGeniusPay();
    vi.stubGlobal("fetch", fake.fetch);
    await h.client.query(`insert into subscription_plan (id,code,name,price_xof,duration_days,active) values ('plan-standard','STANDARD','Standard',5000,30,true)`);
    admin = await h.signUp("Super Admin", "admin@parcours.test");
    await h.grantPlatformAdmin(admin);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    unconfigureGeniusPay();
    await h?.close();
  });

  async function registered() {
    counter += 1;
    await h.client.query("delete from rate_limit_bucket where key like 'auth.sign_up.ip:%'");
    const owner = await h.signUp(`Commerçant ${counter}`, `commercant${counter}@parcours.test`);
    const businessId = await h.createBusiness(owner, `Boutique ${counter}`, "general", { access: "none" });
    return { owner, businessId };
  }
  const dashboard = (actor: Actor) => h.call(dashboardRoute.GET, { method: "GET", path: "/api/business/dashboard", actor });
  const createProduct = (actor: Actor) => h.call(productsRoute.POST, { path: "/api/business/products", actor, body: { name: "Ciment 50 kg", salePriceXof: "6500" } });
  const lifecycleOf = async (actor: Actor) =>
    ((await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor })).body.businesses as { active: boolean; lifecycle: string }[]).find((item) => item.active)?.lifecycle;
  const products = (businessId: string) => h.count("select count(*)::text n from product where business_id=$1", [businessId]);

  it("compte sans paiement : tableau de bord, écritures, réglages et équipe refusés ; suivi d'abonnement ouvert ; rien n'est écrit", async () => {
    const { owner, businessId } = await registered();
    expect(await lifecycleOf(owner)).toBe("pending");
    for (const response of [await dashboard(owner), await createProduct(owner),
      await h.call(settingsRoute.GET, { method: "GET", path: "/api/business/settings", actor: owner }),
      await h.call(teamInvitationsRoute.POST, { path: "/api/business/team/invitations", actor: owner, body: { email: "equipe@parcours.test", role: "cashier" } })]) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual(pendingRefusal);
    }
    expect(await products(businessId)).toBe(0);
    expect(await h.count("select count(*)::text n from invitation where organization_id=$1", [businessId])).toBe(0);
    const subscription = await h.call(subscriptionRoute.GET, { method: "GET", path: "/api/business/subscription", actor: owner });
    expect(subscription.status).toBe(200);
    expect(subscription.body.plans.map((plan: { code: string }) => plan.code)).toEqual(["STANDARD"]);
  });

  it("paiement en attente puis redirection de retour : toujours fermé ; seul le paiement relu chez GeniusPay ouvre l'espace", async () => {
    const { owner, businessId } = await registered();
    const opened = await h.call(checkoutRoute.POST, { path: "/api/business/subscription/checkout", actor: owner, body: { planCode: "STANDARD", idempotencyKey: newKey("abo") } });
    expect(opened.status, opened.text).toBe(201);
    const attemptId = opened.body.attemptId as string;
    // Retour du navigateur sur la page de succès sans confirmation : rien ne s'ouvre.
    const back = await h.call(paymentStatusRoute.POST, { method: "POST", path: `/api/business/subscription/payments/${attemptId}`, actor: owner, params: { attemptId } });
    expect(back.body).toMatchObject({ status: "pending", subscription: null });
    expect((await dashboard(owner)).body).toEqual(pendingRefusal);
    expect(await lifecycleOf(owner)).toBe("pending");

    const reference = (await h.client.query<{ provider_reference: string }>("select provider_reference from subscription_payment where id=$1", [attemptId])).rows[0]!.provider_reference;
    fake.set(reference, { status: "completed", payment_method: "wave" });
    expect((await h.call(webhookRoute.POST, { path: "/api/webhooks/geniuspay", ...signedWebhook("payment.success", reference) })).status).toBe(200);
    expect(await lifecycleOf(owner)).toBe("active");
    expect((await dashboard(owner)).status).toBe(200);
    expect((await createProduct(owner)).status).toBe(201);
    expect(await products(businessId)).toBe(1);
  });

  it("paiement refusé : la tentative est close, l'espace reste fermé, un nouvel essai est possible", async () => {
    const { owner } = await registered();
    const opened = await h.call(checkoutRoute.POST, { path: "/api/business/subscription/checkout", actor: owner, body: { planCode: "STANDARD", idempotencyKey: newKey("abo") } });
    const reference = (await h.client.query<{ provider_reference: string }>("select provider_reference from subscription_payment where id=$1", [opened.body.attemptId])).rows[0]!.provider_reference;
    fake.set(reference, { status: "failed" });
    await h.call(webhookRoute.POST, { path: "/api/webhooks/geniuspay", ...signedWebhook("payment.failed", reference) });
    expect((await dashboard(owner)).body).toEqual(pendingRefusal);
    const retry = await h.call(checkoutRoute.POST, { path: "/api/business/subscription/checkout", actor: owner, body: { planCode: "STANDARD", idempotencyKey: newKey("abo") } });
    expect(retry.status, retry.text).toBe(201);
  });

  it("code d'accès valide : accès temporaire ouvert par le serveur ; un code inconnu ne change rien", async () => {
    const { owner } = await registered();
    const unknown = await h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor: owner, body: { code: "INCONNU-0000" } });
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect((await dashboard(owner)).body).toEqual(pendingRefusal);
    const batch = await h.call(promotionsBatchRoute.POST, { path: "/api/platform/promotions/batch", actor: admin, body: {
      planId: "plan-standard", grantDays: 14, quantity: 1, maxRedemptions: 1, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: null, campaign: "Pilote" } });
    expect(batch.status, batch.text).toBe(201);
    const applied = await h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor: owner, body: { code: batch.body.codes[0].code } });
    expect(applied.status, applied.text).toBe(200);
    expect(await lifecycleOf(owner)).toBe("trial");
    expect((await dashboard(owner)).status).toBe(200);
  });

  it("abonnement échu : la lecture de l'historique reste ouverte, les écritures sont refusées", async () => {
    const { owner, businessId } = await registered();
    await h.grantTrialAccess(businessId);
    expect((await createProduct(owner)).status).toBe(201);
    await h.client.query("update business_subscription set ends_at = $2, trial_ends_at = $2 where business_id = $1", [businessId, new Date(Date.now() - 60_000)]);
    expect(await lifecycleOf(owner)).toBe("expired");
    expect((await dashboard(owner)).status).toBe(200);
    const refused = await createProduct(owner);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/abonnement de ce commerce a expiré/);
    expect(await products(businessId)).toBe(1);
  });

  it("données du navigateur falsifiées : un commerce ou un statut glissés dans la requête n'ouvrent rien", async () => {
    const { owner } = await registered();
    const { businessId: opened } = await registered();
    await h.grantTrialAccess(opened);
    const forged = await h.call(productsRoute.POST, { path: "/api/business/products", actor: owner,
      body: { name: "Article imposé", salePriceXof: "100", businessId: opened, subscriptionStatus: "active" }, headers: { "x-business-id": opened, origin: HARNESS_ORIGIN } });
    expect(forged.body).toEqual(pendingRefusal);
    expect(await products(opened)).toBe(0);
  });
});
