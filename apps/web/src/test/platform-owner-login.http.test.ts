import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as signInRoute from "@/app/api/platform/auth/sign-in/route";
import * as signOutRoute from "@/app/api/platform/auth/sign-out/route";
import * as verifyRoute from "@/app/api/platform/auth/verify/route";
import * as platformOverviewRoute from "@/app/api/platform/overview/route";
import { getAuth } from "@/lib/auth/server";
import { platformLoginLimits } from "@/lib/domain/platform-auth";
import { beginOwnerTwoFactorEnrollment, bootstrapPlatformOwner, resetOwnerTwoFactor, resetPlatformOwnerPassword } from "@/lib/domain/platform-owner";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";
import { totpCode, totpSecretFromUri } from "./totp";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Missions 13 et 14 : accès privé du propriétaire à la console Super Admin, mot de passe PUIS second facteur
 * (TOTP ou code de secours). Vraie instance Better Auth (plugins Username et twoFactor), vraies routes, base
 * migrée (PGlite, ou Neon de staging avec QADR_TEST_POSTGRES_URL). Identifiants de test évidents.
 */
const OWNER = { username: "qadr.owner", email: "owner@qadr.test", name: "Propriétaire Qadr", password: "mot-de-passe-proprio-test-2026" };
const NEW_PASSWORD = "nouveau-mot-de-passe-proprio-2026";

describe("connexion du propriétaire de la plateforme (mot de passe + second facteur)", () => {
  let h: HttpHarness;
  let merchant: Actor; let cashier: Actor; let otherOwner: Actor;
  let ownerUserId = "";
  let secret = "";
  let backupCodes: string[] = [];
  let password = OWNER.password;

  const cookieOf = (headers: Headers) => headers.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
  const signIn = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
    h.call(signInRoute.POST, { path: "/api/platform/auth/sign-in", body, headers: { "x-forwarded-for": ip, ...headers } });
  const verify = (body: unknown, ip: string, cookie = "") =>
    h.call(verifyRoute.POST, { path: "/api/platform/auth/verify", body, headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } });
  const overview = (cookie?: string) => h.call(platformOverviewRoute.GET, { path: "/api/platform/overview", headers: cookie ? { cookie } : {} });
  const ownerSessions = () => h.count("select count(*) as n from session where user_id = $1", [ownerUserId]);
  /** Connexion complète : renvoie le cookie de session plateforme. */
  const login = async (ip: string) => {
    const first = await signIn({ username: OWNER.username, password }, ip);
    expect(first.status, first.text).toBe(200);
    const second = await verify({ code: totpCode(secret) }, ip, cookieOf(first.headers));
    expect(second.status, second.text).toBe(200);
    return cookieOf(second.headers);
  };
  const post = (path: string, body: unknown, cookie = "") => authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }));

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

  it("sans second facteur configuré : console fermée même avec le bon mot de passe, aucune session laissée", async () => {
    const result = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.0.5");
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("platform_2fa_setup_required");
    expect(result.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(false);
    expect(await ownerSessions()).toBe(0);
    // Un mauvais mot de passe ne révèle pas cet état : refus générique.
    expect((await signIn({ username: OWNER.username, password: "pas-le-bon-mot-de-passe" }, "10.0.0.6")).status).toBe(401);
  });

  it("activation : un code faux n'active rien ; un premier code valide rend le facteur obligatoire", async () => {
    const failed = await beginOwnerTwoFactorEnrollment(await getAuth(), h.db, { username: OWNER.username, password: OWNER.password });
    await expect(failed.confirm("000000")).rejects.toMatchObject({ status: 400 });
    await failed.cancel();
    expect(await h.count("select count(*) as n from \"user\" where id = $1 and two_factor_enabled", [ownerUserId])).toBe(0);
    await expect(beginOwnerTwoFactorEnrollment(await getAuth(), h.db, { username: OWNER.username, password: "faux-mot-de-passe-x" })).rejects.toMatchObject({ status: 401 });

    const enrollment = await beginOwnerTwoFactorEnrollment(await getAuth(), h.db, { username: OWNER.username, password: OWNER.password });
    expect(enrollment.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.backupCodes).toHaveLength(10);
    secret = totpSecretFromUri(enrollment.totpURI);
    backupCodes = enrollment.backupCodes;
    await enrollment.confirm(totpCode(secret));
    expect(await h.count("select count(*) as n from \"user\" where id = $1 and two_factor_enabled", [ownerUserId])).toBe(1);
    expect(await ownerSessions()).toBe(0);
    // Secret et codes chiffrés au repos, jamais dans l'audit.
    const [stored] = (await h.client.query<{ secret: string; backup_codes: string }>("select secret, backup_codes from two_factor where user_id = $1", [ownerUserId])).rows;
    expect(stored!.secret).not.toContain(secret);
    expect(stored!.backup_codes).not.toContain(backupCodes[0]!);
    const audit = JSON.stringify((await h.client.query("select metadata from audit_event where entity_id = $1", [ownerUserId])).rows);
    expect(audit).not.toContain(secret);
    expect(audit).not.toContain(backupCodes[0]!);
    await expect(beginOwnerTwoFactorEnrollment(await getAuth(), h.db, { username: OWNER.username, password: OWNER.password })).rejects.toMatchObject({ status: 409 });
  });

  it("mot de passe correct : seulement un défi, aucune session ; le code ouvre la console", async () => {
    const first = await signIn({ username: "QADR.owner", password: OWNER.password }, "10.0.0.1");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, step: "two_factor" });
    expect(first.text).not.toContain(OWNER.password);
    const challenge = cookieOf(first.headers);
    expect(challenge).toMatch(/two_factor=/);
    expect(challenge).not.toMatch(/session_token=/);
    expect(await ownerSessions()).toBe(0);
    expect((await overview(challenge)).status).toBe(401);

    const wrong = await verify({ code: "123456" === totpCode(secret) ? "654321" : "123456" }, "10.0.0.1", challenge);
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("invalid_second_factor");
    const second = await verify({ code: totpCode(secret) }, "10.0.0.1", challenge);
    expect(second.status).toBe(200);
    const cookie = cookieOf(second.headers);
    expect(cookie).toContain("better-auth.session_token=");
    expect((await overview(cookie)).status).toBe(200);
    // Le défi est consommé : il ne rouvre pas une seconde session.
    expect((await verify({ code: totpCode(secret) }, "10.0.0.1", challenge)).status).toBe(401);
    const [audit] = (await h.client.query<{ metadata: Record<string, unknown> }>("select metadata from audit_event where event_type = 'platform.login_succeeded' and actor_user_id = $1", [ownerUserId])).rows;
    expect(audit!.metadata.factor).toBe("totp");
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/qadr\.owner|10\.0\.0\.1|mot-de-passe/);
  });

  it("code de secours : accepté une seule fois", async () => {
    const first = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.5.1");
    const used = await verify({ backupCode: backupCodes[0] }, "10.0.5.1", cookieOf(first.headers));
    expect(used.status).toBe(200);
    expect((await overview(cookieOf(used.headers))).status).toBe(200);
    const again = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.5.2");
    expect((await verify({ backupCode: backupCodes[0] }, "10.0.5.2", cookieOf(again.headers))).status).toBe(401);
  });

  it("contournements refusés : sans défi, défi d'un compte de commerce, routes du plugin, ancienne session ordinaire", async () => {
    expect((await verify({ code: totpCode(secret) }, "10.0.6.1")).status).toBe(401);
    // Une session de commerçant présentée à l'étape 2 n'est pas un défi.
    expect((await verify({ code: totpCode(secret) }, "10.0.6.2", merchant.cookie)).status).toBe(401);
    for (const path of ["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/enable", "/two-factor/disable", "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes", "/two-factor/send-otp"]) {
      expect((await post(path, { code: totpCode(secret), password: OWNER.password }, merchant.cookie)).status, path).toBe(404);
    }
    // Connexion ordinaire par e-mail du propriétaire : le plugin exige le facteur, aucune session n'est créée.
    const byEmail = await post("/sign-in/email", { email: OWNER.email, password: OWNER.password });
    expect(byEmail.status).toBe(200);
    expect(((await byEmail.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(byEmail.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(false);
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

  it("les comptes des commerces n'atteignent jamais la console et gardent leur connexion habituelle", async () => {
    expect((await overview()).status).toBe(401);
    for (const actor of [merchant, cashier, otherOwner]) {
      expect((await overview(actor.cookie)).status, actor.email).toBe(404);
    }
    const merchantLogin = await post("/sign-in/email", { email: "awa@boutique.test", password: "mot-de-passe-de-test-harnais" });
    expect(merchantLogin.status).toBe(200);
    expect(merchantLogin.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(true);
  });

  it("origine étrangère refusée aux deux étapes", async () => {
    const result = await h.call(signInRoute.POST, { path: "/api/platform/auth/sign-in", body: { username: OWNER.username, password: OWNER.password }, headers: { origin: "https://pirate.example" } });
    expect(result.status).toBe(403);
    const second = await h.call(verifyRoute.POST, { path: "/api/platform/auth/verify", body: { code: "123456" }, headers: { origin: "https://pirate.example" } });
    expect(second.status).toBe(403);
  });

  it("limitation : bloqué après plusieurs échecs, même avec le bon mot de passe ; un autre client passe", async () => {
    for (let attempt = 0; attempt < platformLoginLimits.perClient; attempt += 1) {
      expect((await signIn({ username: OWNER.username, password: `essai-${attempt}-faux` }, "10.0.9.9")).status).toBe(401);
    }
    const blocked = await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.9.9");
    expect(blocked.status).toBe(429);
    const retry = Number(blocked.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(900);
    expect(blocked.headers.getSetCookie()).toEqual([]);
    expect((await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.9.10")).status).toBe(200);
  });

  it("limitation atomique : des tentatives simultanées ne dépassent jamais le quota", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, attempt) =>
      signIn({ username: OWNER.username, password: `simultane-${attempt}-faux` }, "10.0.10.10")));
    const statuses = results.map((result) => result.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(platformLoginLimits.perClient);
    expect(statuses.filter((status) => status === 429)).toHaveLength(12 - platformLoginLimits.perClient);
  });

  it("limitation du second facteur : codes faux répétés bloqués", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const first = await signIn({ username: OWNER.username, password: OWNER.password }, `10.0.11.${attempt}`);
      statuses.push((await verify({ code: "000000" === totpCode(secret) ? "111111" : "000000" }, "10.0.11.99", cookieOf(first.headers))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // Le verrouillage par compte de Better Auth (10 échecs consécutifs) n'est pas atteint : le bon code passe.
    expect((await login("10.0.11.200")).length).toBeGreaterThan(0);
  });

  it("session plateforme expirée : reconnexion exigée", async () => {
    const cookie = await login("10.0.2.1");
    // Horloge du serveur (celle qui écrit et contrôle la session), pas celle de la base : test juste même si elles divergent.
    await h.client.query("update platform_session set created_at = $2 where user_id = $1", [ownerUserId, new Date(Date.now() - 9 * 3_600_000)]);
    const expired = await overview(cookie);
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe("platform_reauth_required");
  });

  it("déconnexion : session supprimée, trace d'audit, console refusée", async () => {
    const cookie = await login("10.0.3.1");
    expect((await overview(cookie)).status).toBe(200);
    const out = await h.call(signOutRoute.POST, { path: "/api/platform/auth/sign-out", method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    expect((await overview(cookie)).status).toBe(401);
    expect(await h.count("select count(*) as n from audit_event where event_type = 'platform.logout' and actor_user_id = $1", [ownerUserId])).toBeGreaterThanOrEqual(1);
  });

  it("renouvellement du mot de passe : sessions fermées, ancien mot de passe refusé, facteur conservé", async () => {
    const cookie = await login("10.0.4.1");
    const reset = await resetPlatformOwnerPassword(await getAuth(), h.db, { username: OWNER.username, password: NEW_PASSWORD });
    expect(reset.sessionsClosed).toBeGreaterThanOrEqual(1);
    expect((await overview(cookie)).status).toBe(401);
    expect((await signIn({ username: OWNER.username, password: OWNER.password }, "10.0.4.2")).status).toBe(401);
    password = NEW_PASSWORD;
    expect((await overview(await login("10.0.4.3"))).status).toBe(200);
    await expect(resetPlatformOwnerPassword(await getAuth(), h.db, { username: "awa", password: NEW_PASSWORD })).rejects.toMatchObject({ status: 404 });
  });

  it("récupération : retrait du facteur par l'opérateur, sessions fermées, console fermée jusqu'à la réactivation", async () => {
    const cookie = await login("10.0.7.1");
    const result = await resetOwnerTwoFactor(h.db, { username: OWNER.username });
    expect(result.sessionsClosed).toBeGreaterThanOrEqual(1);
    expect((await overview(cookie)).status).toBe(401);
    expect((await signIn({ username: OWNER.username, password }, "10.0.7.2")).status).toBe(403);
    expect(await h.count("select count(*) as n from audit_event where event_type = 'platform.owner_2fa_reset'")).toBe(1);
    const enrollment = await beginOwnerTwoFactorEnrollment(await getAuth(), h.db, { username: OWNER.username, password });
    secret = totpSecretFromUri(enrollment.totpURI);
    await enrollment.confirm(totpCode(secret));
    expect((await overview(await login("10.0.7.3"))).status).toBe(200);
    await expect(resetOwnerTwoFactor(h.db, { username: "awa" })).rejects.toMatchObject({ status: 404 });
  });
});
