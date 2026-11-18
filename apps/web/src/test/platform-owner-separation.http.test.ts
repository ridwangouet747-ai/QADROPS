import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as meRoute from "@/app/api/account/me/route";
import * as activeBusinessRoute from "@/app/api/account/active-business/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as pushRoute from "@/app/api/notifications/push-subscriptions/route";
import * as accessCodesRoute from "@/app/api/platform/access-codes/route";
import * as platformDashboardRoute from "@/app/api/platform/dashboard/route";
import * as checkRoute from "@/app/api/public/access-codes/check/route";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * 2026-11-18 : la session ouverte par la console Super Admin n'est jamais une session de commerçant.
 * Constat en production : le propriétaire générait un code dans /platform, le saisissait dans le même navigateur,
 * et l'assistant d'inscription sautait l'étape « Compte » (`/api/account/me` répondait 200 pour lui) ; aller au
 * bout ouvrait un commerce rattaché au compte Super Admin en consommant le code. Vraies routes, vraies sessions.
 */
const PLAN = "plan-separation-plateforme";

describe("séparation du compte de la plateforme et de l'espace commerçant", () => {
  let h: HttpHarness;
  let owner: Actor;
  let merchant: Actor;
  let legacyBusinessId: string;
  let ipCounter = 0;
  const ip = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

  beforeAll(async () => {
    h = await startHttpHarness();
    await h.client.query("insert into subscription_plan (id,code,name,price_xof,duration_days,active) values ($1,'STANDARD_SEP','Standard',5000,30,true)", [PLAN]);
    owner = await h.signUp("Propriétaire plateforme", "proprietaire@separation.test");
    // Cas déjà survenu avant la correction : un commerce rattaché au compte qui reçoit ensuite le droit plateforme.
    legacyBusinessId = await h.createBusiness(owner, "Commerce ouvert par erreur");
    await h.grantPlatformAdmin(owner);
    merchant = await h.signUp("Commerçant", "commercant@separation.test");
  });
  beforeEach(async () => { await h.client.query("delete from rate_limit_bucket where true"); });
  afterAll(async () => { await h?.close(); });

  async function newCode() {
    const result = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: owner, body: { planId: PLAN, duration: "m1", paymentVerified: true } });
    expect(result.status, result.text).toBe(201);
    return result.body.codes[0] as { id: string; code: string };
  }
  const check = (code: string, cookie?: string) => h.call(checkRoute.POST, {
    path: "/api/public/access-codes/check", body: { code }, headers: { "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) } });
  const passOf = (result: { headers: Headers }) => result.headers.getSetCookie().map((value) => value.split(";")[0]!)
    .find((pair) => pair.startsWith("qadr-access-pass=") && !pair.endsWith("="))!;

  it("la console reste ouverte au propriétaire (le correctif ne la touche pas)", async () => {
    const dashboard = await h.call(platformDashboardRoute.GET, { path: "/api/platform/dashboard", actor: owner });
    expect(dashboard.status, dashboard.text).toBe(200);
  });

  it("/api/account/me : le propriétaire est traité comme non connecté, sans rien révéler", async () => {
    const asOwner = await h.call(meRoute.GET, { path: "/api/account/me", actor: owner });
    const anonymous = await h.call(meRoute.GET, { path: "/api/account/me" });
    expect(asOwner.status).toBe(401);
    expect(asOwner.body).toEqual(anonymous.body);
    // Un commerçant ordinaire reste reconnu (l'assistant garde son comportement pour lui).
    expect((await h.call(meRoute.GET, { path: "/api/account/me", actor: merchant })).status).toBe(200);
  });

  it("aucun commerce ne s'ouvre avec le compte de la plateforme, même muni d'un code valide ; le code reste intact", async () => {
    const code = await newCode();
    const pass = passOf(await check(code.code));
    const membershipsBefore = await h.count("select count(*)::text n from member where user_id = $1", [owner.userId]);
    const created = await h.call(accountBusinessesRoute.POST, {
      path: "/api/account/businesses", actor: { ...owner, cookie: `${owner.cookie}; ${pass}` }, body: { name: "Boutique du Super Admin", activity: "general" } });
    expect(created.status, created.text).toBe(401);
    expect(await h.count("select count(*)::text n from member where user_id = $1", [owner.userId])).toBe(membershipsBefore);
    expect((await h.client.query("select consumed_at from commercial_access_code where id = $1", [code.id])).rows[0]).toEqual({ consumed_at: null });
    expect(await h.count("select count(*)::text n from organization where name = 'Boutique du Super Admin'")).toBe(0);
  });

  it("/redeem-code : avec la session de la console, la suite est l'inscription d'un nouveau compte, jamais l'onboarding", async () => {
    const code = await newCode();
    const asOwner = await check(code.code, owner.cookie);
    expect(asOwner.status, asOwner.text).toBe(200);
    expect(asOwner.body.next).toBe("register");
    // Commerçant connecté sans commerce : la suite reste l'onboarding (comportement inchangé).
    const asMerchant = await check(code.code, merchant.cookie);
    expect(asMerchant.body.next).toBe("onboarding");
  });

  it("un commerce déjà rattaché au propriétaire n'est plus accessible par sa session (routes métier et sélection)", async () => {
    const products = await h.call(productsRoute.GET, { path: "/api/business/products", actor: owner });
    expect(products.status, products.text).toBe(401);
    const select = await h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor: owner, body: { businessId: legacyBusinessId } });
    expect(select.status, select.text).toBe(401);
  });

  it("les notifications push, partagées avec la console, restent ouvertes au propriétaire", async () => {
    const forgotten = await h.call(pushRoute.DELETE, { path: "/api/notifications/push-subscriptions", actor: owner, body: { endpoint: "https://push.example.test/abc" } });
    expect(forgotten.status, forgotten.text).toBe(200);
  });

  it("le refus tient au droit plateforme actif : une fois le droit retiré, le compte redevient un compte ordinaire", async () => {
    await h.client.query("update platform_admin set revoked_at = now() where user_id = $1", [owner.userId]);
    try {
      expect((await h.call(meRoute.GET, { path: "/api/account/me", actor: owner })).status).toBe(200);
    } finally {
      await h.client.query("update platform_admin set revoked_at = null where user_id = $1", [owner.userId]);
    }
  });
});
