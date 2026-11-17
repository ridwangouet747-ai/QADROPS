import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as accountCapabilitiesRoute from "@/app/api/account/capabilities/route";
import * as cronSubscriptionsRoute from "@/app/api/cron/subscriptions/route";
import * as internalNotificationsRoute from "@/app/api/internal/notifications/process/route";
import * as pushConfigRoute from "@/app/api/notifications/push-config/route";
import * as sentryTestRoute from "@/app/api/observability/sentry-test/route";
import * as platformAuditRoute from "@/app/api/platform/audit/route";
import * as platformBusinessRoute from "@/app/api/platform/businesses/[businessId]/route";
import * as platformBusinessesRoute from "@/app/api/platform/businesses/route";
import * as platformDashboardRoute from "@/app/api/platform/dashboard/route";
import * as platformActivityRoute from "@/app/api/platform/notifications/activity/route";
import * as platformCampaignRoute from "@/app/api/platform/notifications/campaigns/[campaignId]/route";
import * as platformCampaignsRoute from "@/app/api/platform/notifications/campaigns/route";
import * as platformTemplatesRoute from "@/app/api/platform/notifications/templates/route";
import * as platformTemplateTestRoute from "@/app/api/platform/notifications/templates/test/route";
import * as platformOverviewRoute from "@/app/api/platform/overview/route";
import * as platformPlanRoute from "@/app/api/platform/plans/[planId]/route";
import * as platformPlansRoute from "@/app/api/platform/plans/route";
import * as platformPromotionsBatchRoute from "@/app/api/platform/promotions/batch/route";
import * as platformPromotionStatusRoute from "@/app/api/platform/promotions/[promotionId]/status/route";
import * as platformPromotionRoute from "@/app/api/platform/promotions/[promotionId]/route";
import * as platformPromotionsRoute from "@/app/api/platform/promotions/route";
import * as platformSettingsRoute from "@/app/api/platform/settings/route";
import * as platformSubscriptionRoute from "@/app/api/platform/subscriptions/[subscriptionId]/route";
import * as platformSubscriptionsRoute from "@/app/api/platform/subscriptions/route";
import { startHttpHarness, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 11, phase 7 : console Super Admin et routes techniques. Un commerçant (propriétaire de son
 * commerce) ne doit ni voir ni modifier la plateforme ; les tâches planifiées exigent leur secret.
 */
describe("mission 11, phase 7 : console plateforme et routes techniques", () => {
  let h: HttpHarness;
  let merchant: Actor; let newcomer: Actor; let admin: Actor;
  let staff: Actor[] = [];
  let business = "";
  const ID = "00000000-0000-4000-8000-000000000000";

  /** Toutes les routes de la console, avec un identifiant réel de commerce là où il en faut un. */
  function platformCalls(actor: Actor | null): [string, Promise<HttpResult>][] {
    const body = { reason: "Tentative hors plateforme", status: "suspended", action: "pause" };
    return [
      ["GET audit", h.call(platformAuditRoute.GET, { path: "/api/platform/audit", actor })],
      ["GET businesses", h.call(platformBusinessesRoute.GET, { path: "/api/platform/businesses", actor })],
      ["GET business", h.call(platformBusinessRoute.GET, { path: `/api/platform/businesses/${business}`, actor, params: { businessId: business } })],
      ["PATCH business", h.call(platformBusinessRoute.PATCH, { method: "PATCH", path: `/api/platform/businesses/${business}`, actor, params: { businessId: business }, body })],
      ["GET dashboard", h.call(platformDashboardRoute.GET, { path: "/api/platform/dashboard", actor })],
      ["GET overview", h.call(platformOverviewRoute.GET, { path: "/api/platform/overview", actor })],
      ["GET activity", h.call(platformActivityRoute.GET, { path: "/api/platform/notifications/activity", actor })],
      ["POST activity", h.call(platformActivityRoute.POST, { path: "/api/platform/notifications/activity", actor, body: {} })],
      ["POST campaigns", h.call(platformCampaignsRoute.POST, { path: "/api/platform/notifications/campaigns", actor, body: { templateId: ID, segment: { kind: "all" } } })],
      ["POST campaign", h.call(platformCampaignRoute.POST, { path: `/api/platform/notifications/campaigns/${ID}`, actor, params: { campaignId: ID }, body })],
      ["GET templates", h.call(platformTemplatesRoute.GET, { path: "/api/platform/notifications/templates", actor })],
      ["POST templates", h.call(platformTemplatesRoute.POST, { path: "/api/platform/notifications/templates", actor, body: {} })],
      ["POST template test", h.call(platformTemplateTestRoute.POST, { path: "/api/platform/notifications/templates/test", actor, body: { templateKey: "sale.created" } })],
      ["GET plans", h.call(platformPlansRoute.GET, { path: "/api/platform/plans", actor })],
      ["POST plans", h.call(platformPlansRoute.POST, { path: "/api/platform/plans", actor, body: { code: "PIRATE", name: "Pirate", priceXof: "0", durationDays: 3650 } })],
      ["PATCH plan", h.call(platformPlanRoute.PATCH, { method: "PATCH", path: `/api/platform/plans/${ID}`, actor, params: { planId: ID }, body: { priceXof: "0" } })],
      ["GET promotions", h.call(platformPromotionsRoute.GET, { path: "/api/platform/promotions", actor })],
      ["POST promotions", h.call(platformPromotionsRoute.POST, { path: "/api/platform/promotions", actor, body: { code: "GRATUIT", discountPercent: 100, discountXof: null, startsAt: new Date().toISOString(), endsAt: null, maxRedemptions: null, active: true, eligibleBusinessIds: [business] } })],
      ["POST promotions batch", h.call(platformPromotionsBatchRoute.POST, { path: "/api/platform/promotions/batch", actor, body: { count: 10, durationDays: 365 } })],
      ["PATCH promotion", h.call(platformPromotionRoute.PATCH, { method: "PATCH", path: `/api/platform/promotions/${ID}`, actor, params: { promotionId: ID }, body: { active: true } })],
      ["POST promotion status", h.call(platformPromotionStatusRoute.POST, { path: `/api/platform/promotions/${ID}/status`, actor, params: { promotionId: ID }, body })],
      ["GET settings", h.call(platformSettingsRoute.GET, { path: "/api/platform/settings", actor })],
      ["GET subscriptions", h.call(platformSubscriptionsRoute.GET, { path: "/api/platform/subscriptions", actor })],
      ["PATCH subscription", h.call(platformSubscriptionRoute.PATCH, { method: "PATCH", path: `/api/platform/subscriptions/${ID}`, actor, params: { subscriptionId: ID }, body: { action: "extend", days: 365, reason: "Tentative" } })],
    ];
  }

  beforeAll(async () => {
    h = await startHttpHarness();
    merchant = await h.signUp("Commerçant Omega", "owner@omega.test");
    business = await h.createBusiness(merchant, "Commerce Omega");
    newcomer = await h.signUp("Sans commerce", "nouveau@omega.test");
    // Tous les rôles d’une boutique, administrateur de boutique compris : aucun n’est Super Admin.
    staff = [];
    for (const role of ["admin", "cashier", "stock_manager", "accountant", "member"] as const) staff.push(await h.addMember(merchant, `Membre ${role}`, `${role}@omega.test`, role));
    admin = await h.signUp("Super Admin", "admin@qadr.test");
    await h.grantPlatformAdmin(admin);
  });

  afterAll(async () => { await h?.close(); });

  it("propriétaire, administrateur de boutique, employés ou compte sans commerce reçoivent 404 sur toute la console, sans aucune écriture", async () => {
    const counts = async () => Promise.all(["promotion_code", "subscription_plan", "business_subscription", "notification_campaign", "notification_template"]
      .map((table) => h.count(`select count(*)::text n from ${table}`)));
    const before = await counts();
    for (const actor of [merchant, newcomer, ...staff]) {
      for (const [label, pending] of platformCalls(actor)) {
        const result = await pending;
        expect(result.status, `${actor.email} ${label} : ${result.text}`).toBe(404);
        expect(result.body).toEqual({ error: "Accès réservé à l’administration de la plateforme." });
      }
    }
    expect(await counts()).toEqual(before);
    expect((await h.client.query<{ status: string }>("select status from business_profile where business_id=$1", [business])).rows[0]!.status).toBe("active");
  });

  it("sans session, la console répond 401", async () => {
    for (const [label, pending] of platformCalls(null)) expect((await pending).status, label).toBe(401);
  });

  it("le Super Admin accède à la console (le harnais accorde bien le droit)", async () => {
    for (const [route, path] of [[platformDashboardRoute.GET, "/api/platform/dashboard"], [platformBusinessesRoute.GET, "/api/platform/businesses"]] as const) {
      expect((await h.call(route, { path, actor: admin })).status).toBe(200);
    }
    const detail = await h.call(platformBusinessRoute.GET, { path: `/api/platform/businesses/${business}`, actor: admin, params: { businessId: business } });
    expect(detail.status).toBe(200);
  });

  it("les tâches planifiées refusent tout appel sans leur secret", async () => {
    const env = process.env as Record<string, string | undefined>;
    delete env.CRON_SECRET; delete env.NOTIFICATIONS_CRON_SECRET;
    expect((await h.call(cronSubscriptionsRoute.GET, { path: "/api/cron/subscriptions", actor: merchant })).status).toBe(404);
    expect((await h.call(internalNotificationsRoute.POST, { path: "/api/internal/notifications/process", actor: merchant, body: {} })).status).toBe(401);
    env.CRON_SECRET = "secret-cron-de-test-harnais-0123456789-abcdef";
    try {
      for (const authorization of [undefined, "Bearer mauvais-secret", `Bearer ${env.CRON_SECRET}x`]) {
        const headers = authorization ? { authorization } : undefined;
        expect((await h.call(cronSubscriptionsRoute.GET, { path: "/api/cron/subscriptions", actor: merchant, headers })).status).toBe(401);
        expect((await h.call(internalNotificationsRoute.GET, { path: "/api/internal/notifications/process", headers })).status).toBe(401);
      }
      // Avec le bon secret, la tâche tourne sur la base du harnais (aucun abonnement échu ici).
      const ok = await h.call(cronSubscriptionsRoute.GET, { path: "/api/cron/subscriptions", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
      expect(ok.status).toBe(200);
    } finally { delete env.CRON_SECRET; }
  });

  it("routes publiques : capacités honnêtes, clé push absente, test Sentry fermé hors développement", async () => {
    const capabilities = await h.call(accountCapabilitiesRoute.GET, { path: "/api/account/capabilities" });
    expect(capabilities.body).toEqual({ emailConfigured: false, socialProviders: { google: false, apple: false } });
    const push = await h.call(pushConfigRoute.GET, { path: "/api/notifications/push-config" });
    expect(push.body).toEqual({ publicKey: null });
    expect((await h.call(sentryTestRoute.POST, { path: "/api/observability/sentry-test", body: {} })).status).toBe(404);
  });
});
