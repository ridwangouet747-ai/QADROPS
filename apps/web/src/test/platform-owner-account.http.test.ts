import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as passwordRoute from "@/app/api/platform/account/password/route";
import * as usernameRoute from "@/app/api/platform/account/username/route";
import * as signInRoute from "@/app/api/platform/auth/sign-in/route";
import * as platformOverviewRoute from "@/app/api/platform/overview/route";
import * as platformSettingsRoute from "@/app/api/platform/settings/route";
import { getAuth } from "@/lib/auth/server";
import { ensureSeededPlatformOwner, isSeedPassword, readOwnerSeed } from "@/lib/domain/platform-owner";
import { rateRules } from "@/lib/security/rate-limit";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Connexion simple du propriétaire (2026-11-12) : compte de départ créé à la première connexion à partir de
 * deux variables du serveur, puis nom et mot de passe changés par le propriétaire dans la console. Vraie
 * instance Better Auth, vraies routes, base migrée. Identifiants de test évidents.
 */
const SEED = { username: "depart.qadr", password: "mot-de-passe-de-depart-2026" };
const NEW_PASSWORD = "mon-mot-de-passe-personnel-2026";
const NEW_USERNAME = "ridwan.console";

describe("compte de départ du propriétaire et changement de ses identifiants", () => {
  let h: HttpHarness;
  let merchant: Actor;
  let cookie = "";
  let ownerUserId = "";

  const cookieOf = (headers: Headers) => headers.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
  const signIn = (body: unknown, ip: string) => h.call(signInRoute.POST, { path: "/api/platform/auth/sign-in", body, headers: { "x-forwarded-for": ip } });
  const overview = (value?: string) => h.call(platformOverviewRoute.GET, { path: "/api/platform/overview", headers: value ? { cookie: value } : {} });
  const changePassword = (body: unknown, value = cookie, headers: Record<string, string> = {}) =>
    h.call(passwordRoute.POST, { path: "/api/platform/account/password", body, headers: { ...(value ? { cookie: value } : {}), ...headers } });
  const changeUsername = (body: unknown, value = cookie) =>
    h.call(usernameRoute.POST, { path: "/api/platform/account/username", body, headers: value ? { cookie: value } : {} });
  const owners = () => h.count("select count(*) as n from platform_admin where revoked_at is null");
  const seedEnvironment = (values: Partial<typeof SEED>) => {
    if (values.username !== undefined) vi.stubEnv("QADR_OWNER_USERNAME", values.username);
    if (values.password !== undefined) vi.stubEnv("QADR_OWNER_PASSWORD", values.password);
  };

  beforeAll(async () => {
    h = await startHttpHarness();
    merchant = await h.signUp("Awa Boutique", "awa@boutique.test");
    await h.createBusiness(merchant, "Boutique Awa");
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await h?.close(); });

  it("lecture des variables : absentes, invalides, valides ; l'adresse par défaut ne peut recevoir aucun message", () => {
    expect(readOwnerSeed({})).toBeNull();
    expect(readOwnerSeed({ QADR_OWNER_USERNAME: "depart.qadr" })).toBe("invalid");
    expect(readOwnerSeed({ QADR_OWNER_USERNAME: "depart.qadr", QADR_OWNER_PASSWORD: "court" })).toBe("invalid");
    expect(readOwnerSeed({ QADR_OWNER_USERNAME: "a b", QADR_OWNER_PASSWORD: SEED.password })).toBe("invalid");
    expect(readOwnerSeed({ QADR_OWNER_USERNAME: " Depart.Qadr ", QADR_OWNER_PASSWORD: SEED.password })).toEqual({
      username: "depart.qadr", password: SEED.password, email: "depart.qadr@console.qadr-ops.invalid", name: "Propriétaire Qadr Ops",
    });
    expect(readOwnerSeed({ QADR_OWNER_USERNAME: "depart.qadr", QADR_OWNER_PASSWORD: SEED.password, QADR_OWNER_EMAIL: "moi@qadr.test", QADR_OWNER_NAME: "Ridwan" }))
      .toMatchObject({ email: "moi@qadr.test", name: "Ridwan" });
    expect(isSeedPassword(SEED.password, { QADR_OWNER_PASSWORD: SEED.password })).toBe(true);
    expect(isSeedPassword("autre-mot-de-passe-2026", { QADR_OWNER_PASSWORD: SEED.password })).toBe(false);
    expect(isSeedPassword(SEED.password, {})).toBe(false);
  });

  it("sans variables, ou avec un mot de passe trop court : aucun compte créé, refus générique", async () => {
    expect((await signIn(SEED, "10.1.0.1")).status).toBe(401);
    expect(await owners()).toBe(0);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    seedEnvironment({ username: SEED.username, password: "trop-court" });
    const refused = await signIn({ username: SEED.username, password: "trop-court" }, "10.1.0.2");
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: "Nom d’utilisateur ou mot de passe incorrect.", code: "invalid_credentials" });
    expect(await owners()).toBe(0);
    // Le journal du serveur dit pourquoi, sans jamais contenir la valeur.
    expect(logged.mock.calls.flat().join(" ")).toContain("QADR_OWNER_PASSWORD");
    expect(logged.mock.calls.flat().join(" ")).not.toContain("trop-court");
    logged.mockRestore();
  });

  it("un nom déjà porté par un autre compte n'est jamais repris : aucun compte promu", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await h.client.query("update \"user\" set username = $2 where email = $1", ["awa@boutique.test", "pris.ailleurs"]);
    expect(await ensureSeededPlatformOwner(await getAuth(), h.db, { QADR_OWNER_USERNAME: "pris.ailleurs", QADR_OWNER_PASSWORD: SEED.password })).toBe("refused");
    expect(await owners()).toBe(0);
    await h.client.query("update \"user\" set username = null where email = $1", ["awa@boutique.test"]);
    logged.mockRestore();
  });

  it("première connexion : le compte de départ est créé, haché, et la console s'ouvre", async () => {
    seedEnvironment(SEED);
    // Un mauvais mot de passe crée le compte (valeurs du serveur) mais n'ouvre rien.
    expect((await signIn({ username: SEED.username, password: "pas-le-bon-mot-de-passe" }, "10.1.1.1")).status).toBe(401);
    expect(await owners()).toBe(1);

    const result = await signIn(SEED, "10.1.1.2");
    expect(result.status, result.text).toBe(200);
    expect(result.body).toEqual({ ok: true, step: "done", defaultPassword: true });
    cookie = cookieOf(result.headers);
    expect((await overview(cookie)).status).toBe(200);

    const [row] = (await h.client.query<{ id: string; password: string }>("select u.id, a.password from \"user\" u join account a on a.user_id = u.id and a.provider_id = 'credential' where u.username = $1", [SEED.username])).rows;
    ownerUserId = row!.id;
    expect(row!.password).not.toContain(SEED.password);
    const trail = JSON.stringify((await h.client.query("select event_type, metadata from audit_event where entity_id = $1 or actor_user_id = $1", [ownerUserId])).rows);
    expect(trail).toContain("platform.owner_bootstrapped");
    expect(trail).not.toContain(SEED.password);
    // Le nom d'utilisateur est renvoyé à l'écran Paramètres.
    const settings = await h.call(platformSettingsRoute.GET, { path: "/api/platform/settings", headers: { cookie } });
    expect((settings.body as { self: { username: string } }).self.username).toBe(SEED.username);
  });

  it("une fois le propriétaire créé, les variables ne recréent ni ne modifient rien", async () => {
    seedEnvironment({ username: "second.depart", password: "un-autre-mot-de-passe-2026" });
    expect((await signIn({ username: "second.depart", password: "un-autre-mot-de-passe-2026" }, "10.1.2.1")).status).toBe(401);
    expect(await owners()).toBe(1);
    expect(await h.count("select count(*) as n from \"user\" where username = 'second.depart'")).toBe(0);
    // L'ancien mot de passe de départ reste celui du compte, mais n'est plus signalé (la variable a changé).
    expect((await signIn(SEED, "10.1.2.2")).body).toEqual({ ok: true, step: "done", defaultPassword: false });
  });

  it("changement refusé : sans session, compte de commerce, origine étrangère, mauvais mot de passe actuel, mot de passe faible", async () => {
    expect((await changePassword({ currentPassword: SEED.password, newPassword: NEW_PASSWORD }, "")).status).toBe(401);
    expect((await changePassword({ currentPassword: "mot-de-passe-de-test-harnais", newPassword: NEW_PASSWORD }, merchant.cookie)).status).toBe(404);
    expect((await changeUsername({ currentPassword: "mot-de-passe-de-test-harnais", username: NEW_USERNAME }, merchant.cookie)).status).toBe(404);
    expect((await changePassword({ currentPassword: SEED.password, newPassword: NEW_PASSWORD }, cookie, { origin: "https://pirate.example" })).status).toBe(403);

    const wrong = await changePassword({ currentPassword: "pas-le-bon-mot-de-passe", newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("invalid_current_password");
    expect((await changePassword({ currentPassword: SEED.password, newPassword: "court" })).body.code).toBe("validation");
    expect((await changePassword({ currentPassword: SEED.password, newPassword: SEED.password })).body.code).toBe("same_password");
    expect((await changePassword({ currentPassword: SEED.password, newPassword: NEW_PASSWORD, role: "admin" })).body.code).toBe("validation");
    // Rien n'a changé : le mot de passe de départ ouvre toujours la console.
    expect((await signIn(SEED, "10.1.3.1")).status).toBe(200);
    expect(await h.count("select count(*) as n from audit_event where event_type = 'platform.owner_account_change_refused' and actor_user_id = $1", [ownerUserId])).toBe(1);
  });

  it("changement du mot de passe : l'ancien est refusé, les autres sessions sont fermées, la session courante reste", async () => {
    const other = cookieOf((await signIn(SEED, "10.1.4.1")).headers);
    expect((await overview(other)).status).toBe(200);

    const changed = await changePassword({ currentPassword: SEED.password, newPassword: NEW_PASSWORD });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.text).not.toContain(NEW_PASSWORD);
    expect((changed.body as { sessionsClosed: number }).sessionsClosed).toBeGreaterThanOrEqual(1);
    expect((await overview(cookie)).status).toBe(200);
    expect((await overview(other)).status).toBe(401);

    expect((await signIn(SEED, "10.1.4.2")).status).toBe(401);
    seedEnvironment(SEED);
    // Même avec les variables encore en place, le mot de passe de départ ne revient pas.
    expect((await signIn(SEED, "10.1.4.3")).status).toBe(401);
    expect((await signIn({ username: SEED.username, password: NEW_PASSWORD }, "10.1.4.4")).body).toEqual({ ok: true, step: "done", defaultPassword: false });
    const trail = JSON.stringify((await h.client.query("select metadata from audit_event where event_type = 'platform.owner_password_changed'")).rows);
    expect(trail).not.toContain(NEW_PASSWORD);
    expect(await h.count("select count(*) as n from audit_event where event_type = 'platform.owner_password_changed' and actor_user_id = $1", [ownerUserId])).toBe(1);
  });

  it("changement du nom d'utilisateur : nom pris ou invalide refusé, puis connexion avec le nouveau nom seulement", async () => {
    await h.client.query("update \"user\" set username = $2 where email = $1", ["awa@boutique.test", "nom.pris"]);
    const taken = await changeUsername({ currentPassword: NEW_PASSWORD, username: "nom.pris" });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("username_taken");
    expect((await changeUsername({ currentPassword: NEW_PASSWORD, username: "x" })).body.code).toBe("validation");
    expect((await changeUsername({ currentPassword: "pas-le-bon-mot-de-passe", username: NEW_USERNAME })).body.code).toBe("invalid_current_password");

    const changed = await changeUsername({ currentPassword: NEW_PASSWORD, username: "Ridwan.Console" });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body).toEqual({ ok: true, username: NEW_USERNAME });
    expect((await overview(cookie)).status).toBe(200);
    expect((await signIn({ username: SEED.username, password: NEW_PASSWORD }, "10.1.5.1")).status).toBe(401);
    expect((await signIn({ username: NEW_USERNAME, password: NEW_PASSWORD }, "10.1.5.2")).status).toBe(200);
    // Le journal garde le fait, pas le nom.
    const trail = JSON.stringify((await h.client.query("select metadata from audit_event where event_type = 'platform.owner_username_changed'")).rows);
    expect(trail).not.toContain(NEW_USERNAME);
  });

  it("limitation : une session volée ne devine pas le mot de passe actuel par essais", async () => {
    await h.client.query("delete from rate_limit_bucket");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < rateRules.platformAccountChange.limit + 2; attempt += 1) {
      statuses.push((await changePassword({ currentPassword: `essai-${attempt}-faux`, newPassword: "un-mot-de-passe-vole-2026" })).status);
    }
    expect(statuses.slice(0, rateRules.platformAccountChange.limit).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(rateRules.platformAccountChange.limit)).toEqual([429, 429]);
    // Même le bon mot de passe est refusé pendant le blocage, et rien n'a changé.
    expect((await changePassword({ currentPassword: NEW_PASSWORD, newPassword: "un-mot-de-passe-vole-2026" })).status).toBe(429);
    expect((await signIn({ username: NEW_USERNAME, password: NEW_PASSWORD }, "10.1.6.1")).status).toBe(200);
  });
});
