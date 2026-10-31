import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct } from "./commercial";
import type { CommercialDatabase } from "./commercial";
import { assertPlanQuota, countSeats } from "./plan-limits";
import {
  createPlatformPlan, generateAccessCodes, generatePromotionCode, getPlatformBusiness, getPlatformOverview, getPlatformSettings,
  grantPlatformAdmin, listPlatformAudit, listPlatformBusinesses, listPlatformPlans, listPlatformPromotions, listPlatformSubscriptions,
  redeemSubscriptionPromotion, revokePlatformAdmin, setPlatformBusinessStatus, setPromotionStatus, updatePlatformPlan, updatePlatformSubscription,
} from "./platform";
import { canTransition, expireDueSubscriptions } from "./subscription-lifecycle";

/*
 * Mission 08 : console Super Admin sur PGlite isolé. Données insérées directement en SQL (comptes,
 * commerces, membres) pour tester les services de la plateforme sans Better Auth.
 */
describe("console Super Admin (mission 08)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const admin = "console-admin";
  const owner = { a: "console-owner-a", b: "console-owner-b", c: "console-owner-c" };
  const business = { a: "console-biz-a", b: "console-biz-b", c: "console-biz-c" };
  const plans: Record<string, string> = {};
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

  beforeAll(async () => {
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query(`insert into "user" (id,name,email) values ($1,'Aïcha Admin','aicha@qadr.test'),($2,'Awa Boutique','awa@boutique.test'),($3,'Bakary Phones','bakary@phones.test'),($4,'Cécile Mode','cecile@mode.test'),('console-second','Second Admin','second@qadr.test')`, [admin, owner.a, owner.b, owner.c]);
    await client.query("insert into platform_admin (user_id) values ($1)", [admin]);
    await client.query("insert into organization (id,name,slug,created_at) values ($1,'Boutique Awa','console-a',$4),($2,'Bakary Phones','console-b',$5),($3,'Cécile Mode','console-c',$6)", [business.a, business.b, business.c, day(-2), day(-20), day(-40)]);
    await client.query("insert into business_profile (business_id,activity,status) values ($1,'general','active'),($2,'phones','active'),($3,'clothing','active')", [business.a, business.b, business.c]);
    await client.query("insert into member (id,organization_id,user_id,role) values ('cm-a',$1,$2,'owner'),('cm-b',$3,$4,'owner'),('cm-c',$5,$6,'owner')", [business.a, owner.a, business.b, owner.b, business.c, owner.c]);
    plans.starter = (await createPlatformPlan(db, admin, { code: "ESSENTIEL", name: "Essentiel", description: "Pour démarrer", priceXof: "5000", durationDays: 30, storageMb: 500, features: { pos: true, reports: false, inventory: true, procurement: false, productLimit: 2, userLimit: 2 } })).id;
    plans.pro = (await createPlatformPlan(db, admin, { code: "EQUIPE", name: "Équipe", priceXof: "15000", durationDays: 30, features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } })).id;
    await client.query("insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,origin) values ('sub-b',$1,$2,'active',$3,$4,'payment'),('sub-c-pending',$5,$2,'pending',$3,$4,'manual')", [business.b, plans.pro, day(-10), day(20), business.c]);
    await client.query("insert into subscription_payment (id,business_id,subscription_id,amount_xof,method,status,idempotency_key,occurred_at,confirmed_at) values ('pay-ok',$1,'sub-b',15000,'wave','confirmed','k1',$2,$2),('pay-wait',$1,'sub-b',15000,'wave','pending','k2',$2,null),('pay-ref',$1,'sub-b',4000,'wave','refunded','k3',$2,null)", [business.b, day(-1)]);
  });
  afterAll(async () => { await client.close(); });

  describe("accès", () => {
    it("refuse toutes les fonctions de la console à un propriétaire de commerce", async () => {
      const denied = [
        getPlatformOverview(db, owner.a), listPlatformBusinesses(db, owner.a), getPlatformSettings(db, owner.a), listPlatformAudit(db, owner.a),
        generateAccessCodes(db, owner.a, { planId: plans.pro, grantDays: 7, quantity: 1, maxRedemptions: 1, startsAt: day(-1).toISOString(), endsAt: null, campaign: "Pirate" }),
        updatePlatformSubscription(db, owner.b, "sub-b", { action: "extend", days: 30, reason: "Je me l’offre" }),
        setPlatformBusinessStatus(db, owner.a, business.b, { status: "suspended", reason: "Concurrence" }),
      ];
      for (const attempt of denied) await expect(attempt).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("tableau de bord", () => {
    it("compte les commerces par état réel et distingue facturé, encaissé, en attente et remboursé", async () => {
      const overview = await getPlatformOverview(db, admin, { periodDays: 30 });
      expect(overview.businesses).toMatchObject({ total: 3, active: 1, trial: 0, suspended: 0, pending: 2 });
      expect(overview.subscriptions).toMatchObject({ pending: 1, inForce: 1 });
      expect(overview.revenue).toMatchObject({ billedXof: "34000", collectedXof: "15000", pendingXof: "15000", refundedXof: "4000", confirmedPayments: 1 });
      expect(overview.signups.inPeriod).toBe(2);
      expect(overview.signups.series).toHaveLength(30);
      expect(overview.signups.series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
      expect(overview.planDistribution.find((plan) => plan.planId === plans.pro)?.count).toBe(1);
      expect(overview.recentSignups[0]).toMatchObject({ name: "Boutique Awa", ownerName: "Awa Boutique" });
      const weekly = await getPlatformOverview(db, admin, { periodDays: 90 });
      expect(weekly.signups.step).toBe(7);
      expect(weekly.signups.series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    });
  });

  describe("commerces", () => {
    it("recherche par propriétaire, filtre par état et affiche propriétaire, membres et forfait", async () => {
      const byOwner = await listPlatformBusinesses(db, admin, { search: "bakary@phones" });
      expect(byOwner).toHaveLength(1);
      expect(byOwner[0]).toMatchObject({ businessId: business.b, owner: { name: "Bakary Phones" }, memberCount: 1, lifecycle: "active" });
      expect(byOwner[0]!.subscription).toMatchObject({ planName: "Équipe" });
      expect((await listPlatformBusinesses(db, admin, { status: "pending" })).map((row) => row.businessId).sort()).toEqual([business.a, business.c].sort());
      expect(await listPlatformBusinesses(db, admin, { planId: plans.pro })).toHaveLength(2);
    });

    it("exige un motif, suspend, bloque les opérations, puis réactive avec le statut d’origine et un historique complet", async () => {
      await expect(setPlatformBusinessStatus(db, admin, business.b, { status: "suspended" })).rejects.toThrow();
      await expect(setPlatformBusinessStatus(db, admin, business.b, { status: "suspended", reason: "abc" })).rejects.toThrow();
      await setPlatformBusinessStatus(db, admin, business.b, { status: "suspended", reason: "Fraude suspectée sur les paiements" });
      await expect(setPlatformBusinessStatus(db, admin, business.b, { status: "suspended", reason: "Encore une fois" })).rejects.toMatchObject({ status: 409 });
      await expect(createProduct(db, { businessId: business.b, actorUserId: owner.b, name: "Coque", salePriceXof: "1000" })).rejects.toMatchObject({ status: 403 });
      await setPlatformBusinessStatus(db, admin, business.b, { status: "active", reason: "Vérification terminée, rien d’anormal" });
      const detail = await getPlatformBusiness(db, admin, business.b);
      expect(detail.subscriptions[0]).toMatchObject({ status: "active" });
      expect(detail.history.map((event) => event.eventType)).toEqual(["platform.business_active", "platform.business_suspended"]);
      expect(detail.history[1]).toMatchObject({ actor: { name: "Aïcha Admin" }, businessName: "Bakary Phones", before: { status: "active" }, after: { status: "suspended" }, reason: "Fraude suspectée sur les paiements", result: "success" });
    });
  });

  describe("forfaits et quotas", () => {
    it("crée et modifie un forfait avec description, stockage et devise, en traçant l’avant et l’après", async () => {
      await expect(createPlatformPlan(db, admin, { code: "essentiel", name: "Doublon", priceXof: "1", durationDays: 1, features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } })).rejects.toMatchObject({ status: 409 });
      await expect(createPlatformPlan(db, admin, { code: "USD", name: "Dollar", priceXof: "1", durationDays: 1, currency: "USD", features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } })).rejects.toThrow();
      await updatePlatformPlan(db, admin, plans.starter!, { priceXof: "6000", description: "Petit commerce" });
      const listed = (await listPlatformPlans(db, admin)).find((plan) => plan.id === plans.starter);
      expect(listed).toMatchObject({ priceXof: 6000n, description: "Petit commerce", currency: "XOF", storageMb: 500, features: { userLimit: 2, productLimit: 2 } });
      const audit = await listPlatformAudit(db, admin, { action: "platform.plan_updated" });
      expect(audit.items[0]).toMatchObject({ before: { priceXof: "5000", description: "Pour démarrer" }, after: { priceXof: "6000", description: "Petit commerce" } });
    });
  });

  describe("codes d’accès", () => {
    const codes: { id: string; code: string }[] = [];

    it("génère en série des codes sûrs, uniques, sans les écrire dans le journal", async () => {
      expect(generatePromotionCode("QADR")).toMatch(/^QADR-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      const batch = await generateAccessCodes(db, admin, { planId: plans.starter, grantDays: 21, quantity: 3, prefix: "salon", maxRedemptions: 1, startsAt: day(-1).toISOString(), endsAt: day(30).toISOString(), campaign: "Salon de Treichville" });
      codes.push(...batch.codes);
      expect(new Set(batch.codes.map((item) => item.code)).size).toBe(3);
      const audit = await listPlatformAudit(db, admin, { action: "platform.promotion_batch" });
      expect(audit.items[0]).toMatchObject({ reason: "Salon de Treichville", after: { quantity: 3, grantDays: 21 } });
      expect(JSON.stringify(audit.items)).not.toContain(batch.codes[0]!.code);
      await updatePlatformPlan(db, admin, plans.pro!, { active: false });
      await expect(generateAccessCodes(db, admin, { planId: plans.pro, grantDays: 7, quantity: 1, maxRedemptions: 1, startsAt: day(-1).toISOString(), endsAt: null, campaign: "Forfait inactif" })).rejects.toMatchObject({ status: 409 });
      await updatePlatformPlan(db, admin, plans.pro!, { active: true });
    });

    it("ouvre un essai depuis un abonnement en attente, sans paiement, de façon idempotente", async () => {
      const first = await redeemSubscriptionPromotion(db, owner.c, business.c, { code: codes[0]!.code.toLowerCase() });
      expect(first).toMatchObject({ kind: "access", replayed: false, status: "trialing", subscriptionId: "sub-c-pending", grantDays: 21 });
      const again = await redeemSubscriptionPromotion(db, owner.c, business.c, { code: codes[0]!.code });
      expect(again).toMatchObject({ replayed: true, redemptionId: first.redemptionId, status: "trialing" });
      const payments = await client.query("select id from subscription_payment where business_id = $1", [business.c]);
      expect(payments.rows).toHaveLength(0);
      const overview = await getPlatformOverview(db, admin);
      expect(overview.businesses.trial).toBe(1);
      expect(overview.revenue.collectedXof).toBe("15000");
      expect(overview.revenue.offeredDays).toBe(21);
    });

    it("crée un essai pour un commerce sans abonnement et applique ensuite les quotas du forfait", async () => {
      await redeemSubscriptionPromotion(db, owner.a, business.a, { code: codes[1]!.code });
      await createProduct(db, { businessId: business.a, actorUserId: owner.a, name: "Riz 25 kg", salePriceXof: "18000" });
      await createProduct(db, { businessId: business.a, actorUserId: owner.a, name: "Huile 5 L", salePriceXof: "6500" });
      await expect(createProduct(db, { businessId: business.a, actorUserId: owner.a, name: "Sucre", salePriceXof: "900" })).rejects.toMatchObject({ status: 403, message: expect.stringContaining("2 produits") });
      await client.query("insert into invitation (id,organization_id,email,role,status,expires_at,inviter_id) values ('inv-quota',$1,'vendeur@boutique.test','cashier','pending',$2,$3)", [business.a, day(3), owner.a]);
      expect(await countSeats(db, business.a)).toBe(2);
      await expect(assertPlanQuota(db, business.a, "users")).rejects.toMatchObject({ status: 403 });
      await expect(assertPlanQuota(db, business.b, "users")).resolves.toBeUndefined();
    });

    it("refuse un code épuisé, révoqué, expiré, non éligible ou pour un autre forfait en cours", async () => {
      await expect(redeemSubscriptionPromotion(db, owner.b, business.b, { code: codes[0]!.code })).rejects.toThrow(/limite/);
      await setPromotionStatus(db, admin, codes[2]!.id, { action: "revoke", reason: "Code diffusé publiquement" });
      await expect(redeemSubscriptionPromotion(db, owner.b, business.b, { code: codes[2]!.code })).rejects.toThrow(/révoqué/);
      await expect(setPromotionStatus(db, admin, codes[2]!.id, { action: "resume", reason: "Erreur de manipulation" })).rejects.toMatchObject({ status: 409 });
      const expired = await generateAccessCodes(db, admin, { planId: plans.pro, grantDays: 7, quantity: 1, maxRedemptions: 5, startsAt: day(-10).toISOString(), endsAt: day(-1).toISOString(), campaign: "Ancienne campagne" });
      await expect(redeemSubscriptionPromotion(db, owner.b, business.b, { code: expired.codes[0]!.code })).rejects.toThrow(/valide/);
      const targeted = await generateAccessCodes(db, admin, { planId: plans.pro, grantDays: 30, quantity: 1, maxRedemptions: 5, startsAt: day(-1).toISOString(), endsAt: null, eligibleBusinessIds: [business.b], campaign: "Fidélité Bakary" });
      await expect(redeemSubscriptionPromotion(db, owner.c, business.c, { code: targeted.codes[0]!.code })).rejects.toMatchObject({ status: 403 });
      const extended = await redeemSubscriptionPromotion(db, owner.b, business.b, { code: targeted.codes[0]!.code });
      expect(extended).toMatchObject({ status: "active", grantDays: 30 });
      const otherPlan = await generateAccessCodes(db, admin, { planId: plans.starter, grantDays: 7, quantity: 1, maxRedemptions: 5, startsAt: day(-1).toISOString(), endsAt: null, campaign: "Autre forfait" });
      await expect(redeemSubscriptionPromotion(db, owner.b, business.b, { code: otherPlan.codes[0]!.code })).rejects.toMatchObject({ status: 409 });
      const states = await listPlatformPromotions(db, admin);
      expect(states.find((promo) => promo.id === codes[0]!.id)?.state).toBe("exhausted");
      expect(states.find((promo) => promo.id === codes[2]!.id)?.state).toBe("revoked");
      expect(states.find((promo) => promo.id === expired.codes[0]!.id)?.state).toBe("expired");
    });
  });

  describe("abonnements", () => {
    it("suit une machine à états cohérente", () => {
      expect(canTransition("pending", "trialing")).toBe(true);
      expect(canTransition("trialing", "active")).toBe(true);
      expect(canTransition("suspended", "active")).toBe(true);
      expect(canTransition("expired", "active")).toBe(false);
      expect(canTransition("canceled", "trialing")).toBe(false);
      expect(canTransition("active", "pending")).toBe(false);
    });

    it("expire automatiquement à l’échéance, une seule fois, avec une trace système", async () => {
      await client.query("insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,origin) values ('sub-old',$1,$2,'trialing',$3,$4,'promotion')", [business.c, plans.starter, day(-30), day(-1)]);
      expect(await expireDueSubscriptions(db)).toEqual({ expired: 1 });
      expect(await expireDueSubscriptions(db)).toEqual({ expired: 0 });
      const listing = await listPlatformSubscriptions(db, admin, { status: "expired" });
      expect(listing.subscriptions.map((item) => item.id)).toEqual(["sub-old"]);
      expect(listing.subscriptions[0]!.history[0]).toMatchObject({ eventType: "subscription.expired" });
      const audit = await listPlatformAudit(db, admin, { action: "subscription.expired" });
      expect(audit.items[0]).toMatchObject({ actor: null, before: { status: "trialing" }, after: { status: "expired" } });
    });

    it("prolonge puis annule avec motif, et refuse les transitions impossibles", async () => {
      const before = await listPlatformSubscriptions(db, admin, { search: "Bakary" });
      const running = before.subscriptions.find((item) => item.id === "sub-b")!;
      expect(running.origin).toBe("payment");
      const extended = await updatePlatformSubscription(db, admin, "sub-b", { action: "extend", days: 10, reason: "Geste commercial après panne" });
      expect(new Date(extended.endsAt!).getTime() - running.endsAt.getTime()).toBe(10 * 86_400_000);
      await updatePlatformSubscription(db, admin, "sub-b", { action: "cancel", reason: "Demande du commerçant" });
      await expect(updatePlatformSubscription(db, admin, "sub-b", { action: "cancel", reason: "Deuxième fois" })).rejects.toMatchObject({ status: 409 });
      await expect(updatePlatformSubscription(db, admin, "sub-old", { action: "extend", days: 5, reason: "Période terminée" })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("journal d’audit", () => {
    it("filtre par action, commerce et recherche, pagine, et refuse toute modification", async () => {
      const all = await listPlatformAudit(db, admin, { limit: 3 });
      expect(all.items).toHaveLength(3);
      expect(all.nextBefore).not.toBeNull();
      const older = await listPlatformAudit(db, admin, { limit: 3, before: all.nextBefore! });
      expect(older.items[0]!.occurredAt.getTime()).toBeLessThan(all.items[0]!.occurredAt.getTime() + 1);
      const forB = await listPlatformAudit(db, admin, { businessId: business.b });
      expect(forB.items.every((item) => item.businessId === business.b)).toBe(true);
      // La campagne retrouve la génération et les deux utilisations de ses codes.
      const campaign = await listPlatformAudit(db, admin, { search: "Treichville" });
      expect(campaign.items.map((item) => item.eventType).sort()).toEqual(["platform.promotion_batch_generated", "subscription.access_code_redeemed", "subscription.access_code_redeemed"]);
      await expect(client.query("update audit_event set event_type = 'falsifié'")).rejects.toThrow(/ajout seul/);
      await expect(client.query("delete from audit_event")).rejects.toThrow(/ajout seul/);
    });
  });

  describe("habilitations Super Admin", () => {
    it("attribue et retire un droit par la procédure contrôlée, sans retirer le dernier administrateur", async () => {
      await expect(revokePlatformAdmin(db, { email: "aicha@qadr.test", reason: "Test du dernier admin", grantedByUserId: admin })).rejects.toMatchObject({ status: 409 });
      await expect(grantPlatformAdmin(db, { email: "second@qadr.test", reason: "Renfort support", grantedByUserId: owner.a })).rejects.toMatchObject({ status: 403 });
      await grantPlatformAdmin(db, { email: "second@qadr.test", reason: "Renfort de l’équipe support", grantedByUserId: admin });
      const settings = await getPlatformSettings(db, admin);
      expect(settings.admins.map((row) => row.email)).toEqual(["aicha@qadr.test", "second@qadr.test"]);
      await revokePlatformAdmin(db, { email: "second@qadr.test", reason: "Fin de mission", grantedByUserId: admin });
      await expect(getPlatformOverview(db, "console-second")).rejects.toMatchObject({ status: 403 });
    });
  });
});
