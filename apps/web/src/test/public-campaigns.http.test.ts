import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as businessSubscriptionRoute from "@/app/api/business/subscription/route";
import * as redeemRoute from "@/app/api/business/subscription/promotion/route";
import * as campaignRoute from "@/app/api/platform/campaigns/[campaignId]/route";
import * as campaignStatusRoute from "@/app/api/platform/campaigns/[campaignId]/status/route";
import * as campaignsRoute from "@/app/api/platform/campaigns/route";
import * as promotionsBatchRoute from "@/app/api/platform/promotions/batch/route";
import * as promotionsRoute from "@/app/api/platform/promotions/route";
import * as checkRoute from "@/app/api/public/campaigns/check/route";
import { publicCampaignCheckLimiter } from "@/lib/rate-limit";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 12, lot L1a : campagnes promotionnelles publiques, séparées des codes privés (D-12-4).
 * Routes réelles, sessions Better Auth réelles, base PGlite migrée ; seul `@/lib/db/client` est remplacé.
 */
describe("mission 12 : campagnes publiques d’acquisition", () => {
  let h: HttpHarness;
  let admin: Actor; let merchant: Actor;
  let starter = ""; let pro = ""; let retired = "";
  let merchantBusiness = "";
  const day = 86_400_000;

  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();
  const description = { fr: "Un mois offert pour démarrer.", en: "One month free to get started.", ar: "شهر مجاني للبدء." };
  const campaignBody = (overrides: Record<string, unknown> = {}) => ({
    code: `LANCE-${randomUUID().slice(0, 8).toUpperCase()}`, name: "Lancement Abidjan", description, planIds: [starter],
    grantDays: 30, discountPercent: null, discountXof: null, startsAt: iso(-1), endsAt: null, maxRedemptions: null, active: true, ...overrides,
  });
  async function createCampaign(overrides: Record<string, unknown> = {}) {
    const body = campaignBody(overrides);
    const result = await h.call(campaignsRoute.POST, { path: "/api/platform/campaigns", actor: admin, body });
    expect(result.status, result.text).toBe(201);
    return { id: result.body.id as string, code: body.code as string };
  }
  const check = (body: unknown, ip = "203.0.113.10") => h.call(checkRoute.POST, { path: "/api/public/campaigns/check", body, headers: { "x-forwarded-for": ip } });
  const newcomer = (label: string) => h.signUp(`Commerçant ${label}`, `${label}-${randomUUID().slice(0, 6)}@campagne.test`);
  const register = (actor: Actor, promotion?: unknown, creationKey?: string) => h.call(accountBusinessesRoute.POST, {
    path: "/api/account/businesses", actor, body: { name: `Boutique ${actor.name}`, activity: "general", ...(promotion ? { promotion } : {}), ...(creationKey ? { creationKey } : {}) },
  });
  const redemptions = (promotionId: string) => h.count("select count(*)::text n from promotion_redemption where promotion_id=$1", [promotionId]);

  beforeAll(async () => {
    h = await startHttpHarness();
    for (const [code, name, price, active] of [["STARTER", "Essentiel", "5000", true], ["PRO", "Pro", "15000", true], ["OLD", "Ancienne", "3000", false]] as const) {
      const id = randomUUID();
      await h.client.query("insert into subscription_plan (id, code, name, price_xof, duration_days, active, features) values ($1,$2,$3,$4,30,$5,'{}')", [id, code, name, price, active]);
      if (code === "STARTER") starter = id; else if (code === "PRO") pro = id; else retired = id;
    }
    admin = await h.signUp("Super Admin", "admin@campagnes.test");
    await h.grantPlatformAdmin(admin);
    merchant = await h.signUp("Commerçant inscrit", "inscrit@campagnes.test");
    merchantBusiness = await h.createBusiness(merchant, "Commerce déjà inscrit");
  });
  beforeEach(() => publicCampaignCheckLimiter.reset());
  afterAll(async () => { await h?.close(); });

  it("vérification : un code valide affiche l’offre sans rien consommer", async () => {
    const campaign = await createCampaign();
    const result = await check({ code: campaign.code.toLowerCase() });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.body).toMatchObject({ valid: true, code: campaign.code, description, advantage: { grantDays: 30, discountPercent: null, discountXof: null },
      plans: [{ code: "STARTER", name: "Essentiel" }], plan: { code: "STARTER", name: "Essentiel", discountAmountXof: null } });
    expect(await redemptions(campaign.id)).toBe(0);
  });

  it("réponses génériques identiques : inconnu, expiré, en pause, révoqué, complet, formule non éligible, code privé", async () => {
    const expired = await createCampaign({ startsAt: iso(-10), endsAt: iso(-1) });
    const paused = await createCampaign();
    expect((await h.call(campaignStatusRoute.POST, { path: `/api/platform/campaigns/${paused.id}/status`, actor: admin, params: { campaignId: paused.id }, body: { action: "pause", reason: "Campagne suspendue" } })).status).toBe(200);
    const revoked = await createCampaign();
    expect((await h.call(campaignStatusRoute.POST, { path: `/api/platform/campaigns/${revoked.id}/status`, actor: admin, params: { campaignId: revoked.id }, body: { action: "revoke", reason: "Campagne arrêtée" } })).status).toBe(200);
    const full = await createCampaign({ maxRedemptions: 1 });
    expect((await register(await newcomer("plein"), { code: full.code })).body.business.promotion.status).toBe("applied");
    const starterOnly = await createCampaign();
    const scheduled = await createCampaign({ startsAt: iso(5) });
    const batch = await h.call(promotionsBatchRoute.POST, { path: "/api/platform/promotions/batch", actor: admin, body: {
      planId: starter, grantDays: 7, quantity: 1, maxRedemptions: 1, startsAt: iso(-1), endsAt: null, campaign: "Code privé de test" } });
    expect(batch.status, batch.text).toBe(201);
    const privateCode = batch.body.codes[0].code as string;

    const attempts = [
      { code: "INCONNU-404" }, { code: expired.code }, { code: paused.code }, { code: revoked.code }, { code: full.code },
      { code: starterOnly.code, planCode: "PRO" }, { code: starterOnly.code, planCode: "OLD" }, { code: scheduled.code }, { code: privateCode },
      { code: "x" }, { code: "A".repeat(80) },
    ];
    const responses = await Promise.all(attempts.map((body, index) => check(body, `198.51.100.${index}`)));
    for (const [index, response] of responses.entries()) {
      expect(response.status, JSON.stringify(attempts[index])).toBe(200);
      expect(response.text, JSON.stringify(attempts[index])).toBe(responses[0]!.text);
    }
    expect(responses[0]!.body).toEqual({ valid: false });
  });

  it("plusieurs formules : la vérification les liste, la formule choisie donne sa remise ; inactives exclues", async () => {
    const campaign = await createCampaign({ planIds: [starter, pro], grantDays: null, discountPercent: 20 });
    const open = await check({ code: campaign.code });
    expect(open.body).toMatchObject({ valid: true, plan: null, plans: [{ code: "STARTER" }, { code: "PRO" }] });
    const chosen = await check({ code: campaign.code, planCode: "pro" });
    expect(chosen.body.plan).toEqual({ code: "PRO", name: "Pro", discountAmountXof: "3000" });
    // Remise seule : abonnement en attente sur la formule choisie, remise conservée dans la réclamation.
    const actor = await newcomer("remise");
    const created = await register(actor, { code: campaign.code, planCode: "PRO" });
    expect(created.status, created.text).toBe(201);
    expect(created.body.business.promotion).toMatchObject({ status: "applied", plan: { code: "PRO" }, grantDays: null, subscriptionStatus: "pending", discountAmountXof: "3000" });
    // Sans formule alors qu'il faut choisir : commerce créé, avantage non appliqué.
    const undecided = await register(await newcomer("indecis"), { code: campaign.code });
    expect(undecided.status).toBe(201);
    expect(undecided.body.business.promotion).toEqual({ status: "unavailable" });
    const inactive = await h.call(campaignsRoute.POST, { path: "/api/platform/campaigns", actor: admin, body: campaignBody({ planIds: [retired] }) });
    expect(inactive.status).toBe(409);
  });

  it("réclamation à la création du commerce : essai créé par le serveur, durée jamais prise du navigateur", async () => {
    const campaign = await createCampaign({ grantDays: 21 });
    const actor = await newcomer("essai");
    const created = await register(actor, { code: campaign.code, grantDays: 3650 } as unknown);
    expect(created.status).toBe(400); // champ inconnu refusé : seul le code et la formule sont lus
    const accepted = await register(actor, { code: campaign.code });
    expect(accepted.status, accepted.text).toBe(201);
    const outcome = accepted.body.business.promotion;
    expect(outcome).toMatchObject({ status: "applied", replayed: false, plan: { code: "STARTER" }, grantDays: 21, subscriptionStatus: "trialing" });
    expect(Math.round((Date.parse(outcome.endsAt) - Date.now()) / day)).toBe(21);
    const businessId = accepted.body.business.id as string;
    const overview = await h.call(businessSubscriptionRoute.GET, { path: "/api/business/subscription", actor });
    expect(overview.body).toMatchObject({ lifecycle: "trial", subscription: { status: "trialing", origin: "promotion", planCode: "STARTER" } });
    const audit = await h.client.query<{ event_type: string }>("select event_type from audit_event where business_id=$1 and event_type like 'subscription.campaign%'", [businessId]);
    expect(audit.rows.map((row) => row.event_type)).toEqual(["subscription.campaign_claimed"]);
    const row = (await h.client.query<{ redeemed_by_user_id: string }>("select redeemed_by_user_id from promotion_redemption where business_id=$1", [businessId])).rows[0]!;
    expect(row.redeemed_by_user_id).toBe(actor.userId);
  });

  it("deux inscriptions simultanées pour la dernière place : une seule gagne, l’autre commerce est créé sans avantage", async () => {
    const campaign = await createCampaign({ maxRedemptions: 2 });
    expect((await register(await newcomer("premier"), { code: campaign.code })).body.business.promotion.status).toBe("applied");
    const [a, b] = await Promise.all([newcomer("course-a"), newcomer("course-b")]);
    const results = await Promise.all([register(a, { code: campaign.code }), register(b, { code: campaign.code })]);
    for (const result of results) expect(result.status, result.text).toBe(201);
    expect(results.map((result) => result.body.business.promotion.status).sort()).toEqual(["applied", "unavailable"]);
    expect(await redemptions(campaign.id)).toBe(2);
    expect((await check({ code: campaign.code })).body).toEqual({ valid: false });
    const refused = await h.count("select count(*)::text n from audit_event where event_type='subscription.campaign_claim_refused' and metadata->>'reason'='exhausted' and metadata->>'promotionId'=$1", [campaign.id]);
    expect(refused).toBe(1);
  });

  it("double soumission : le rejeu renvoie la même réclamation ; deux commerces d’un même compte ne réclament qu’une fois", async () => {
    const campaign = await createCampaign();
    const actor = await newcomer("double");
    const key = `cle-creation-${randomUUID().replace(/-/g, "")}`;
    const first = await register(actor, { code: campaign.code }, key);
    const second = await register(actor, { code: campaign.code }, key);
    expect(second.status).toBe(201);
    expect(second.body.business).toMatchObject({ id: first.body.business.id, replayed: true, promotion: { status: "applied", replayed: true, code: campaign.code } });
    expect(await redemptions(campaign.id)).toBe(1);
    // Même compte, autre commerce (sans clé, ou en même temps) : jamais une seconde réclamation.
    const both = await Promise.all([register(actor, { code: campaign.code }), register(actor, { code: campaign.code })]);
    for (const result of both) expect(result.body.business.promotion).toEqual({ status: "unavailable" });
    expect(await redemptions(campaign.id)).toBe(1);
  });

  it("inscription interrompue puis nouvelle tentative : la vérification ne consomme rien, la création réussit ensuite", async () => {
    const campaign = await createCampaign({ maxRedemptions: 1 });
    for (let attempt = 0; attempt < 3; attempt++) expect((await check({ code: campaign.code })).body.valid).toBe(true);
    expect(await redemptions(campaign.id)).toBe(0);
    const actor = await newcomer("reprise");
    const key = `cle-reprise-${randomUUID().replace(/-/g, "")}`;
    const created = await register(actor, { code: campaign.code }, key);
    expect(created.body.business.promotion.status).toBe("applied");
    // Réponse perdue : le navigateur renvoie la même création, rien n'est consommé deux fois.
    const retried = await register(actor, { code: campaign.code }, key);
    expect(retried.body.business.promotion).toMatchObject({ status: "applied", replayed: true });
    expect(await redemptions(campaign.id)).toBe(1);
  });

  it("séparation stricte : un code public est refusé dans l’application, un code privé avant l’inscription", async () => {
    const campaign = await createCampaign();
    const refused = await h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor: merchant, body: { code: campaign.code } });
    expect(refused.status).toBe(404);
    expect(refused.body).toMatchObject({ code: "invalid" });
    const unknown = await h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor: merchant, body: { code: "INCONNU-0000" } });
    expect(refused.body).toEqual(unknown.body);
    expect(await redemptions(campaign.id)).toBe(0);

    const batch = await h.call(promotionsBatchRoute.POST, { path: "/api/platform/promotions/batch", actor: admin, body: {
      planId: starter, grantDays: 7, quantity: 2, maxRedemptions: 5, startsAt: iso(-1), endsAt: null, campaign: "Codes privés" } });
    const [privateA, privateB] = batch.body.codes.map((item: { code: string }) => item.code) as string[];
    const actor = await newcomer("prive");
    const created = await register(actor, { code: privateA });
    expect(created.status).toBe(201);
    expect(created.body.business.promotion).toEqual({ status: "unavailable" });
    expect(await h.count("select count(*)::text n from promotion_redemption where business_id=$1", [created.body.business.id])).toBe(0);

    // Les codes privés continuent de fonctionner dans l’application.
    const applied = await h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor: merchant, body: { code: privateB } });
    expect(applied.status, applied.text).toBe(200);
    expect(applied.body).toMatchObject({ kind: "access", replayed: false, grantDays: 7 });
    // La liste des codes privés ne montre pas les campagnes publiques.
    const privateList = await h.call(promotionsRoute.GET, { path: "/api/platform/promotions", actor: admin });
    expect(privateList.body.some((item: { code: string }) => item.code === campaign.code)).toBe(false);
    void merchantBusiness;
  });

  it("limite de tentatives par adresse IP : 429 après 20 vérifications, une autre adresse reste servie", async () => {
    for (let index = 0; index < 20; index++) expect((await check({ code: `ESSAI-${index}` }, "192.0.2.50")).status).toBe(200);
    const blocked = await check({ code: "ESSAI-21" }, "192.0.2.50");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "rate_limited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await check({ code: "ESSAI-21" }, "192.0.2.51")).status).toBe(200);
  });

  it("administration : création, modification, compteur, réclamations, désactivation, tout est audité", async () => {
    const campaign = await createCampaign({ maxRedemptions: 5 });
    await register(await newcomer("compteur"), { code: campaign.code });
    const list = await h.call(campaignsRoute.GET, { path: "/api/platform/campaigns", actor: admin });
    expect(list.body.find((item: { id: string }) => item.id === campaign.id)).toMatchObject({ useCount: 1, remaining: 4, state: "active", plans: [{ code: "STARTER" }] });
    const detail = await h.call(campaignRoute.GET, { path: `/api/platform/campaigns/${campaign.id}`, actor: admin, params: { campaignId: campaign.id } });
    expect(detail.body.redemptions).toHaveLength(1);
    expect(detail.body.redemptions[0]).toMatchObject({ planName: "Essentiel", subscriptionStatus: "trialing" });

    const patch = (body: Record<string, unknown>) => h.call(campaignRoute.PATCH, { method: "PATCH", path: `/api/platform/campaigns/${campaign.id}`, actor: admin, params: { campaignId: campaign.id }, body: campaignBody({ code: campaign.code, maxRedemptions: 5, ...body }) });
    expect((await patch({ maxRedemptions: 0 })).status).toBe(400);
    expect((await patch({ code: "NOUVEAU-CODE" })).status).toBe(409);
    const updated = await patch({ planIds: [starter, pro], grantDays: 14 });
    expect(updated.status, updated.text).toBe(200);
    expect((await check({ code: campaign.code, planCode: "PRO" })).body.advantage.grantDays).toBe(14);
    expect((await h.call(campaignsRoute.POST, { path: "/api/platform/campaigns", actor: admin, body: campaignBody({ grantDays: null }) })).status).toBe(400);
    expect((await h.call(campaignsRoute.POST, { path: "/api/platform/campaigns", actor: admin, body: campaignBody({ code: campaign.code }) })).status).toBe(409);

    const status = (action: string) => h.call(campaignStatusRoute.POST, { path: `/api/platform/campaigns/${campaign.id}/status`, actor: admin, params: { campaignId: campaign.id }, body: { action, reason: "Décision commerciale" } });
    expect((await status("pause")).status).toBe(200);
    expect((await check({ code: campaign.code })).body).toEqual({ valid: false });
    expect((await status("resume")).status).toBe(200);
    expect((await check({ code: campaign.code, planCode: "STARTER" })).body.valid).toBe(true);
    const events = await h.client.query<{ event_type: string }>("select event_type from audit_event where entity_id=$1 order by occurred_at", [campaign.id]);
    expect(events.rows.map((row) => row.event_type)).toEqual(["platform.campaign_created", "platform.campaign_updated", "platform.campaign_paused", "platform.campaign_resumed"]);
    // Les codes privés ne se pilotent pas par cette route, et inversement.
    expect((await h.call(campaignStatusRoute.POST, { path: "/api/platform/campaigns/x/status", actor: admin, params: { campaignId: "x" }, body: { action: "pause", reason: "Inconnue ici" } })).status).toBe(404);
  });

  it("non-Super-Admin : 404 (connecté) ou 401 (anonyme) sur toute l’administration des campagnes, sans écriture", async () => {
    const campaign = await createCampaign();
    const before = await h.count("select count(*)::text n from promotion_code");
    const calls = (actor: Actor | null) => [
      h.call(campaignsRoute.GET, { path: "/api/platform/campaigns", actor }),
      h.call(campaignsRoute.POST, { path: "/api/platform/campaigns", actor, body: campaignBody() }),
      h.call(campaignRoute.GET, { path: `/api/platform/campaigns/${campaign.id}`, actor, params: { campaignId: campaign.id } }),
      h.call(campaignRoute.PATCH, { method: "PATCH", path: `/api/platform/campaigns/${campaign.id}`, actor, params: { campaignId: campaign.id }, body: campaignBody({ code: campaign.code, maxRedemptions: 1_000_000 }) }),
      h.call(campaignStatusRoute.POST, { path: `/api/platform/campaigns/${campaign.id}/status`, actor, params: { campaignId: campaign.id }, body: { action: "revoke", reason: "Tentative hors plateforme" } }),
    ];
    for (const result of await Promise.all(calls(merchant))) expect(result.status, result.text).toBe(404);
    for (const result of await Promise.all(calls(null))) expect(result.status, result.text).toBe(401);
    expect(await h.count("select count(*)::text n from promotion_code")).toBe(before);
    expect((await check({ code: campaign.code })).body.valid).toBe(true);
  });
});
