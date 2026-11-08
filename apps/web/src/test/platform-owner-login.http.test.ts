import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as signInRoute from "@/app/api/platform/auth/sign-in/route";
import * as signOutRoute from "@/app/api/platform/auth/sign-out/route";
import * as platformOverviewRoute from "@/app/api/platform/overview/route";
import { getAuth } from "@/lib/auth/server";
import { platformLoginLimits } from "@/lib/domain/platform-auth";
import { bootstrapPlatformOwner, resetPlatformOwnerPassword } from "@/lib/domain/platform-owner";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 13 : accès privé du propriétaire à la console Super Admin. Vraie instance Better Auth (plugin
 * Username), vraies routes, base PGlite migrée. Les identifiants sont des valeurs de test évidentes.
 */
const OWNER = { username: "qadr.owner", email: "owner@qadr.test", name: "Propriétaire Qadr", password: "mot-de-passe-proprio-test-2026" };
const NEW_PASSWORD = "nouveau-mot-de-passe-proprio-2026";

describe("connexion du propriétaire de la plateforme", () => {
  let h: HttpHarness;
  let merchant: Actor; let cashier: Actor; let otherOwner: Actor;
  let ownerUserId = "";

  const signIn = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
    h.call(signInRoute.POST, { path: "/api/platform/auth/sign-in", body, headers: { "x-forwarded-for": ip, ...headers } });
  const cookieOf = (headers: Headers) => headers.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
  const overview = (cookie?: string) => h.call(platformOverviewRoute.GET, { path: "/api/platform/overview", headers: cookie ? { cookie } : {} });

  beforeAll(async () => {
    h = await startHttpHarness();
    merchant = await h.signUp("Awa Boutique", "awa@boutique.test");
    await h.createBusiness(merchant, "Boutique Awa");
    cashier = await h.addMember(merchant, "Koffi Caisse", "koffi@boutique.test", "cashier");
    otherOwner = await h.signUp("Bakary Phones", "bakary@phones.test");
    await h.createBusiness(otherOwner, "Bakary Phones");
    ownerUserId = (await bootstrapPlatformOwner(await getAuth(), h.db, OWNER)).userId;
  });
  afterAll(async () => { await h?.close(); });

  it("initialisation contrôlée : mot de passe haché, un seul propriétaire, aucun compte de commerce promu", async () => {
    const [row] = (await h.client.query<{ password: string }>("select password from account where user_id = $1 and provider_id = 'credential'", [ownerUserId])).rows;
    expect(row!.password).not.toContain(OWNER.password);
    expect(row!.password.length).toBeGreaterThan(40);
    await expect(bootstrapPlatformOwner(await getAuth(), h.db, { ...OWNER, username: "autre.owner", email: "autre@qadr.test" })).rejects.toMatchObject({ status: 409 });
    expect(await h.count("select count(*) as n from platform_admin where revoked_at is null")).toBe(1);
    await expect(bootstrapPlatformOwner(await getAuth(), h.db, { ...OWNER, password: "court" })).rejects.toThrow();
  });

  it("le propriétaire se connecte par nom d'utilisateur et accède à la console", async () => {
    const result = await signIn({ username: "QADR.owner", password: OWNER.password }, "10.0.0.1");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(result.text).not.toContain(OWNER.password);
    const cookie = cookieOf(result.headers);
    expect(cookie).toContain("better-auth.session_token=");
    expect((await overview(cookie)).status).toBe(200);
    const [audit] = (await h.client.query<{ metadata: Record<string, unknown> }>("select metadata from audit_event where event_type = 'platform.login_succeeded' and actor_user_id = $1", [ownerUserId])).rows;
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/qadr\.owner|10\.0\.0\.1|mot-de-passe/);
  });

  it("refus identiques pour un nom inconnu, un mauvais mot de passe ou un compte de commerce", async () => {
    const wrong = await signIn({ username: OWNER.username, password: "pas-le-bon-mot-de-passe" }, "10.0.1.1");
    const unknown = await signIn({ username: "inconnu.total", password: OWNER.password }, "10.0.1.2");
    const merchantTry = await signIn({ username: "awa@boutique.test", password: "mot-de-passe-de-test-harnais" }, "10.0.1.3");
    const malformed = await signIn({ username: "a", password: "" }, "10.0.1.4");
    for (const result of [wrong, unknown, merchantTry, malformed]) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: "Nom d’utilisateur ou mot de passe incorrect.", code: "invalid_credentials" });
      expect(result.headers.getSetCookie()).toEqual([]);
    }
    const failures = (await h.client.query<{ metadata: Record<string, unknown> }>("select metadata from audit_event where event_type = 'platform.login_failed'")).rows;
    expect(failures.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(failures)).not.toMatch(/inconnu\.total|pas-le-bon|10\.0\.1\./);
  });

  it("les comptes des commerces n'atteignent jamais la console, même par l'API directe", async () => {
    expect((await overview()).status).toBe(401);
    for (const actor of [merchant, cashier, otherOwner]) {
      const result = await overview(actor.cookie);
      expect(result.status, actor.email).toBe(404);
    }
  });

  it("une session ordinaire du propriétaire (connexion par e-mail) n'ouvre pas la console", async () => {
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN },
      body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
    }));
    expect(response.status).toBe(200);
    const result = await overview(cookieOf(response.headers));
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("platform_reauth_required");
  });

  it("routes Better Auth du nom d'utilisateur fermées en HTTP", async () => {
    const post = (path: string, body: unknown) => authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN }, body: JSON.stringify(body),
    }));
    expect((await post("/sign-in/username", { username: OWNER.username, password: OWNER.password })).status).toBe(404);
    expect((await post("/is-username-available", { username: OWNER.username })).status).toBe(404);
    const signUp = await post("/sign-up/email", { name: "Intrus", email: "intrus@exemple.test", password: "mot-de-passe-intrus", username: "qadr.admin" });
    expect(signUp.status).toBe(400);
    expect(await h.count("select count(*) as n from \"user\" where email = 'intrus@exemple.test'")).toBe(0);
  });

  it("origine étrangère refusée", async () => {
    const result = await h.call(signInRoute.POST, { path: "/api/platform/auth/sign-in", body: { username: OWNER.username, password: OWNER.password }, headers: { origin: "https://pirate.example" } });
    expect(result.status).toBe(403);
  });

  it("limitation des tentatives : bloqué après plusieurs échecs, même avec le bon mot de passe", async () => {
    for (let attempt = 0; attempt < platformLoginLimits.perClient; attempt += 1) {
      expect((await signIn({ username: OWNER.username, password: `essai-${attempt}-faux` }, "10.0.9.9")).status).toBe(401);
    }
    const blocked = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.9.9");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    expect(blocked.headers.getSetCookie()).toEqual([]);
    // Un autre client n'est pas bloqué par ces échecs.
    expect((await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.9.10")).status).toBe(200);
  });

  it("session plateforme expirée : reconnexion exigée", async () => {
    const result = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.2.1");
    const cookie = cookieOf(result.headers);
    await h.client.query("update platform_session set created_at = now() - interval '9 hours' where user_id = $1", [ownerUserId]);
    const expired = await overview(cookie);
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe("platform_reauth_required");
  });

  it("déconnexion : session supprimée, trace d'audit, console refusée", async () => {
    const result = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.3.1");
    const cookie = cookieOf(result.headers);
    expect((await overview(cookie)).status).toBe(200);
    const out = await h.call(signOutRoute.POST, { path: "/api/platform/auth/sign-out", method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    expect((await overview(cookie)).status).toBe(401);
    expect(await h.count("select count(*) as n from audit_event where event_type = 'platform.logout' and actor_user_id = $1", [ownerUserId])).toBeGreaterThanOrEqual(1);
  });

  it("renouvellement du mot de passe : sessions fermées, ancien mot de passe refusé", async () => {
    const before = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.4.1");
    const cookie = cookieOf(before.headers);
    const reset = await resetPlatformOwnerPassword(await getAuth(), h.db, { username: OWNER.username, password: NEW_PASSWORD });
    expect(reset.sessionsClosed).toBeGreaterThanOrEqual(1);
    expect((await overview(cookie)).status).toBe(401);
    expect((await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.4.2")).status).toBe(401);
    expect((await signIn({ username: OWNER.username, password: NEW_PASSWORD }, "10.0.4.3")).status).toBe(200);
    await expect(resetPlatformOwnerPassword(await getAuth(), h.db, { username: "awa", password: NEW_PASSWORD })).rejects.toMatchObject({ status: 404 });
  });
});
