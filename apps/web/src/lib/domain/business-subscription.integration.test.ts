import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { errorResponse } from "./business-context";
import { getBusinessSubscriptionOverview } from "./business-subscription";
import type { CommercialDatabase } from "./commercial";
import { createPlatformPlan, generateAccessCodes, redeemSubscriptionPromotion, setPlatformBusinessStatus, setPromotionStatus } from "./platform";

/*
 * Complément mission 08 : saisie d'un code Qadr Agency par le commerçant. Chaque refus doit avoir un
 * code stable (traduit par l'interface), ne rien révéler des codes réservés à d'autres commerces, et
 * rester tracé et limité.
 */
describe("code d’accès saisi par le commerçant", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const admin = "promo-admin";
  const user = { a: "promo-owner-a", cashierA: "promo-cashier-a", b: "promo-owner-b", c: "promo-owner-c", d: "promo-owner-d", e: "promo-owner-e" };
  const biz = { a: "promo-biz-a", b: "promo-biz-b", c: "promo-biz-c", d: "promo-biz-d", e: "promo-biz-e" };
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
  let planId = "";
  const codes = async (options: { grantDays?: number; quantity?: number; maxRedemptions?: number; startsAt?: string; endsAt?: string | null; eligibleBusinessIds?: string[]; campaign?: string } = {}) =>
    (await generateAccessCodes(db, admin, { planId, grantDays: options.grantDays ?? 14, quantity: options.quantity ?? 1, maxRedemptions: options.maxRedemptions ?? 1,
      startsAt: options.startsAt ?? day(-1), endsAt: options.endsAt === undefined ? day(30) : options.endsAt, campaign: options.campaign ?? "Test commerçant",
      ...(options.eligibleBusinessIds ? { eligibleBusinessIds: options.eligibleBusinessIds } : {}) })).codes;

  beforeAll(async () => {
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query(`insert into "user" (id,name,email) values ($1,'Admin','admin@promo.test'),($2,'Awa','awa@promo.test'),($3,'Caissier','caisse@promo.test'),($4,'Bakary','bakary@promo.test'),($5,'Cécile','cecile@promo.test'),($6,'Djénéba','djeneba@promo.test'),($7,'Ehouman','ehouman@promo.test')`,
      [admin, user.a, user.cashierA, user.b, user.c, user.d, user.e]);
    await client.query("insert into platform_admin (user_id) values ($1)", [admin]);
    for (const [key, id] of Object.entries(biz)) {
      await client.query("insert into organization (id,name,slug,created_at) values ($1,$2,$3,now())", [id, `Commerce ${key.toUpperCase()}`, `promo-${key}`]);
      await client.query("insert into business_profile (business_id,activity,status) values ($1,'general','active')", [id]);
    }
    await client.query("insert into member (id,organization_id,user_id,role) values ('pm-a',$1,$2,'owner'),('pm-ca',$1,$3,'cashier'),('pm-b',$4,$5,'owner'),('pm-c',$6,$7,'admin'),('pm-d',$8,$9,'owner'),('pm-e',$10,$11,'owner')",
      [biz.a, user.a, user.cashierA, biz.b, user.b, biz.c, user.c, biz.d, user.d, biz.e, user.e]);
    planId = (await createPlatformPlan(db, admin, { code: "ESSAI", name: "Essentiel", priceXof: "5000", durationDays: 30, features: { pos: true, reports: true, inventory: true, procurement: false, productLimit: null, userLimit: null } })).id;
  });
  afterAll(async () => { await client.close(); });

  it("affiche un commerce sans abonnement comme « en attente », activable par le propriétaire seulement", async () => {
    await expect(getBusinessSubscriptionOverview(db, user.a, biz.a)).resolves.toMatchObject({ lifecycle: "pending", canRedeem: true, subscription: null, pending: null });
    await expect(getBusinessSubscriptionOverview(db, user.cashierA, biz.a)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    // Isolation : un propriétaire ne lit pas l'abonnement d'un commerce dont il n'est pas membre.
    await expect(getBusinessSubscriptionOverview(db, user.b, biz.a)).rejects.toMatchObject({ status: 403 });
  });

  it("applique un code valide, confirme côté serveur le forfait, la durée et l’échéance", async () => {
    const [code] = await codes({ grantDays: 21 });
    const result = await redeemSubscriptionPromotion(db, user.a, biz.a, { code: code!.code.toLowerCase() });
    expect(result).toMatchObject({ kind: "access", replayed: false, status: "trialing", grantDays: 21, plan: { code: "ESSAI", name: "Essentiel" } });
    const overview = await getBusinessSubscriptionOverview(db, user.a, biz.a);
    expect(overview).toMatchObject({ lifecycle: "trial", subscription: { status: "trialing", inForce: true, planName: "Essentiel", origin: "promotion" } });
    expect(overview.subscription!.remainingDays).toBe(21);
    expect(overview.subscription!.endsAt!.getTime()).toBe(new Date(result.endsAt!).getTime());
  });

  it("rend le même résultat si le code est appliqué deux fois par le même commerce", async () => {
    const [code] = await codes({ maxRedemptions: 3 });
    const first = await redeemSubscriptionPromotion(db, user.b, biz.b, { code: code!.code });
    const again = await redeemSubscriptionPromotion(db, user.b, biz.b, { code: code!.code });
    expect(again).toMatchObject({ replayed: true, redemptionId: first.redemptionId });
    const [{ uses }] = (await client.query<{ uses: number }>("select count(*)::int uses from promotion_redemption where code_snapshot = $1", [code!.code])).rows as [{ uses: number }];
    expect(uses).toBe(1);
  });

  it("traite deux demandes simultanées comme une seule application", async () => {
    const [code] = await codes({ maxRedemptions: 5 });
    const results = await Promise.all([redeemSubscriptionPromotion(db, user.c, biz.c, { code: code!.code }), redeemSubscriptionPromotion(db, user.c, biz.c, { code: code!.code })]);
    expect(results.map((item) => item.replayed).sort()).toEqual([false, true]);
    expect(results[0].redemptionId).toBe(results[1].redemptionId);
  });

  it("n’accorde un code à usage unique qu’à un seul de deux commerces concurrents", async () => {
    const [code] = await codes({ maxRedemptions: 1 });
    const settled = await Promise.allSettled([redeemSubscriptionPromotion(db, user.d, biz.d, { code: code!.code }), redeemSubscriptionPromotion(db, user.e, biz.e, { code: code!.code })]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.find((item) => item.status === "rejected")).toMatchObject({ reason: { status: 409, code: "already_used" } });
  });

  it("distingue code expiré, révoqué, épuisé et pas encore actif", async () => {
    const [expired] = await codes({ startsAt: day(-10), endsAt: day(-1), maxRedemptions: 5 });
    await expect(redeemSubscriptionPromotion(db, user.b, biz.b, { code: expired!.code })).rejects.toMatchObject({ code: "expired" });
    const [revoked] = await codes({ maxRedemptions: 5 });
    await setPromotionStatus(db, admin, revoked!.id, { action: "revoke", reason: "Code diffusé publiquement" });
    await expect(redeemSubscriptionPromotion(db, user.b, biz.b, { code: revoked!.code })).rejects.toMatchObject({ code: "revoked" });
    const [shared] = await codes({ maxRedemptions: 2 });
    await redeemSubscriptionPromotion(db, user.a, biz.a, { code: shared!.code });
    await redeemSubscriptionPromotion(db, user.c, biz.c, { code: shared!.code });
    await expect(redeemSubscriptionPromotion(db, user.b, biz.b, { code: shared!.code })).rejects.toMatchObject({ status: 409, code: "exhausted" });
    const [future] = await codes({ startsAt: day(2), maxRedemptions: 5 });
    await expect(redeemSubscriptionPromotion(db, user.b, biz.b, { code: future!.code })).rejects.toMatchObject({ code: "not_active" });
  });

  it("répond à un code réservé à un autre commerce exactement comme à un code inconnu, et l’accepte pour le commerce éligible", async () => {
    const [reserved] = await codes({ maxRedemptions: 5, eligibleBusinessIds: [biz.e] });
    const unknown = await redeemSubscriptionPromotion(db, user.b, biz.b, { code: "QADR-ZZZZ-ZZZZ-ZZZZ" }).catch((error: unknown) => error);
    const foreign = await redeemSubscriptionPromotion(db, user.b, biz.b, { code: reserved!.code }).catch((error: unknown) => error);
    expect(foreign).toMatchObject({ status: 404, code: "invalid" });
    expect({ status: (foreign as { status: number }).status, message: (foreign as Error).message }).toEqual({ status: (unknown as { status: number }).status, message: (unknown as Error).message });
    // Même révoqué, un code réservé à autrui ne révèle pas son état.
    await setPromotionStatus(db, admin, reserved!.id, { action: "suspend", reason: "Pause de la campagne" }).catch(() => undefined);
    await expect(redeemSubscriptionPromotion(db, user.e, biz.e, { code: (await codes({ maxRedemptions: 5, eligibleBusinessIds: [biz.e] }))[0]!.code })).resolves.toMatchObject({ replayed: false });
  });

  it("refuse un utilisateur non autorisé et un commerce suspendu", async () => {
    const [code] = await codes({ maxRedemptions: 5 });
    await expect(redeemSubscriptionPromotion(db, user.cashierA, biz.a, { code: code!.code })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(redeemSubscriptionPromotion(db, user.b, biz.a, { code: code!.code })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await setPlatformBusinessStatus(db, admin, biz.d, { status: "suspended", reason: "Contrôle de conformité" });
    await expect(redeemSubscriptionPromotion(db, user.d, biz.d, { code: code!.code })).rejects.toMatchObject({ status: 403, code: "business_suspended" });
    await expect(getBusinessSubscriptionOverview(db, user.d, biz.d)).resolves.toMatchObject({ lifecycle: "suspended", canRedeem: false });
  });

  it("refuse un code d’un autre forfait pendant un abonnement en cours", async () => {
    const otherPlan = (await createPlatformPlan(db, admin, { code: "PRO2", name: "Équipe", priceXof: "15000", durationDays: 30, features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } })).id;
    const [code] = (await generateAccessCodes(db, admin, { planId: otherPlan, grantDays: 7, quantity: 1, maxRedemptions: 1, startsAt: day(-1), endsAt: null, campaign: "Autre forfait" })).codes;
    await expect(redeemSubscriptionPromotion(db, user.a, biz.a, { code: code!.code })).rejects.toMatchObject({ status: 409, code: "incompatible_subscription" });
  });

  it("trace chaque refus sans le code saisi, puis bloque temporairement après dix refus", async () => {
    const rejected = await client.query<{ metadata: Record<string, unknown> }>("select metadata from audit_event where business_id = $1 and event_type = 'subscription.promotion_rejected'", [biz.b]);
    expect(rejected.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected.rows)).not.toContain("QADR-ZZZZ");
    for (let attempt = rejected.rows.length; attempt < 10; attempt += 1) await redeemSubscriptionPromotion(db, user.b, biz.b, { code: `QADR-NOPE-${attempt}` }).catch(() => undefined);
    await expect(redeemSubscriptionPromotion(db, user.b, biz.b, { code: "QADR-ENCORE-UNE" })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("expose le code d’erreur dans la réponse HTTP, jamais d’erreur brute", async () => {
    const failure = await redeemSubscriptionPromotion(db, user.cashierA, biz.a, { code: "QADR-AAAA-BBBB-CCCC" }).catch((error: unknown) => error);
    const response = errorResponse(failure);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Seul l’administrateur du commerce peut utiliser ce code.", code: "forbidden" });
    const crash = errorResponse(new Error("relation \"promotion_code\" does not exist"));
    await expect(crash.json()).resolves.toEqual({ error: "Une erreur empêche le traitement de la requête." });
  });
});
