import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import { authRateChecks } from "@/lib/auth/server";
import { rateRules } from "@/lib/security/rate-limit";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * V-5 et V-6 : changement de mot de passe par la route native de Better Auth (`POST /api/auth/change-password`).
 * - commerçant : session et mot de passe actuel exigés, compte visé = celui de la session, autres sessions
 *   toujours fermées (le client ne peut pas l'empêcher), limitation partagée par compte et par adresse ;
 * - propriétaire de la plateforme : la route lui répond comme une route fermée (il passe par la console).
 * Vraie instance Better Auth sur PGlite migrée, vraies sessions ; aucun simulacre hors de la base.
 */
const PASSWORD = "mot-de-passe-de-test-harnais";
const NEW_PASSWORD = "nouveau-mot-de-passe-solide-2026";
let ipCounter = 0;
/** Adresse IP distincte par requête : la limite par adresse ne se mêle pas aux autres assertions. */
const nextIp = () => `198.19.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

function authPost(path: string, body: unknown, cookie?: string, ip = nextIp()) {
  return authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));
}
async function sessionOf(cookie: string) {
  const response = await authRoute.GET(new Request(`${HARNESS_ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
  return response.json() as Promise<{ user: { id: string; email: string } } | null>;
}
const cookieOf = (response: Response) =>
  response.headers.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
const signInWith = (email: string, password: string) => authPost("/sign-in/email", { email, password });

describe("changement de mot de passe par /api/auth/change-password", () => {
  let h: HttpHarness;
  const hashOf = async (userId: string) =>
    (await h.client.query<{ password: string }>("select password from account where user_id = $1 and provider_id = 'credential'", [userId])).rows[0]!.password;
  const sessionsOf = (userId: string) => h.count("select count(*) as n from session where user_id = $1", [userId]);

  beforeAll(async () => { h = await startHttpHarness(); });
  afterAll(async () => { await h?.close(); });

  it("le compte limité est celui de la session, jamais une valeur du corps", () => {
    const fromBody = authRateChecks("/change-password", { userId: "compte-vise", email: "victime@boutique.test" }, "203.0.113.7");
    expect(fromBody).toEqual([{ rule: rateRules.passwordChangeIp, subject: "203.0.113.7" }]);
    expect(authRateChecks("/change-password", {}, null, "id-de-session")).toEqual([
      { rule: rateRules.passwordChangeIp, subject: "inconnu" },
      { rule: rateRules.passwordChangeAccount, subject: "id-de-session" },
    ]);
    expect(rateRules.passwordChangeAccount).toEqual({ name: "auth.change_password.account", limit: 5, windowMs: 15 * 60_000 });
    expect(rateRules.passwordChangeIp).toEqual({ name: "auth.change_password.ip", limit: 20, windowMs: 15 * 60_000 });
  });

  it("sans session : 401, aucune empreinte modifiée", async () => {
    const actor = await h.signUp("Awa Sans Session", "awa.sans-session@boutique.test");
    const before = await hashOf(actor.userId);
    const response = await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(await hashOf(actor.userId)).toBe(before);
  });

  it("mauvais mot de passe actuel : 400 INVALID_PASSWORD, empreinte et sessions inchangées", async () => {
    const actor = await h.signUp("Koffi Mauvais", "koffi.mauvais@quincaillerie.test");
    const second = await h.signIn(actor);
    const before = await hashOf(actor.userId);
    const response = await authPost("/change-password", { currentPassword: "pas-le-bon-mot-de-passe", newPassword: NEW_PASSWORD }, actor.cookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    expect(await hashOf(actor.userId)).toBe(before);
    expect(await sessionsOf(actor.userId)).toBe(2);
    expect(await sessionOf(second.cookie)).toMatchObject({ user: { id: actor.userId } });
  });

  it("succès : toutes les anciennes sessions fermées, nouvelle session émise, nouveau mot de passe seul accepté", async () => {
    const actor = await h.signUp("Mariam Succès", "mariam.succes@tissus.test");
    await h.createBusiness(actor, "Tissus Mariam");
    const second = await h.signIn(actor);
    const before = await hashOf(actor.userId);
    expect(await sessionsOf(actor.userId)).toBe(2);

    const response = await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, actor.cookie);
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).not.toContain(NEW_PASSWORD);
    const body = JSON.parse(text) as { token: string | null; user: { id: string } };
    expect(body.user.id).toBe(actor.userId);
    // revokeOtherSessions imposé : Better Auth renvoie le jeton de la NOUVELLE session et pose son cookie.
    expect(body.token).toEqual(expect.any(String));
    const fresh = cookieOf(response);
    expect(fresh).toContain("better-auth.session_token=");

    // Session secondaire ET session qui a fait la demande : toutes deux supprimées ; seule la nouvelle vit.
    expect(await sessionOf(second.cookie)).toBeNull();
    expect(await sessionOf(actor.cookie)).toBeNull();
    expect(await sessionOf(fresh)).toMatchObject({ user: { id: actor.userId } });
    expect(await sessionsOf(actor.userId)).toBe(1);
    // Comportement constaté de Better Auth 1.7.7 : la nouvelle session n'a pas de commerce actif.
    const [row] = (await h.client.query<{ active_organization_id: string | null }>("select active_organization_id from session where user_id = $1", [actor.userId])).rows;
    expect(row!.active_organization_id).toBeNull();

    expect(await hashOf(actor.userId)).not.toBe(before);
    expect((await signInWith("mariam.succes@tissus.test", PASSWORD)).status).toBe(401);
    expect((await signInWith("mariam.succes@tissus.test", NEW_PASSWORD)).status).toBe(200);
  });

  it("revokeOtherSessions: false envoyé par le client : les autres sessions sont quand même supprimées", async () => {
    const actor = await h.signUp("Yao Contournement", "yao.contournement@telephones.test");
    const second = await h.signIn(actor);
    const response = await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false }, actor.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json() as { token: string | null }).token).toEqual(expect.any(String));
    expect(await sessionOf(second.cookie)).toBeNull();
    expect(await sessionOf(actor.cookie)).toBeNull();
    expect(await sessionsOf(actor.userId)).toBe(1);
  });

  it("userId ou email d'un autre compte dans le corps : seul le compte de la session change", async () => {
    const victim = await h.signUp("Fatou Victime", "fatou.victime@vetements.test");
    const attacker = await h.signUp("Intrus Commerçant", "intrus@general.test");
    const victimHash = await hashOf(victim.userId);
    const attackerHash = await hashOf(attacker.userId);

    const response = await authPost("/change-password", {
      currentPassword: PASSWORD, newPassword: NEW_PASSWORD, userId: victim.userId, email: victim.email, user: { id: victim.userId },
    }, attacker.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json() as { user: { id: string } }).user.id).toBe(attacker.userId);

    expect(await hashOf(victim.userId)).toBe(victimHash);
    expect(await hashOf(attacker.userId)).not.toBe(attackerHash);
    expect(await sessionOf(victim.cookie)).toMatchObject({ user: { id: victim.userId } });
    expect((await signInWith(victim.email, PASSWORD)).status).toBe(200);
    expect((await signInWith(victim.email, NEW_PASSWORD)).status).toBe(401);
  });

  it("propriétaire de la plateforme : routes d'identifiants fermées (404), empreinte et sessions inchangées", async () => {
    const owner = await h.signUp("Propriétaire Console", "proprietaire.console@qadr.test");
    // Session ordinaire ouverte avant l'attribution du droit : depuis le 2026-11-12, /sign-in/email refuse le
    // propriétaire actif ; une telle session ne peut donc venir que d'avant (droit accordé ensuite, ou ancien code).
    const ordinary = await h.signIn(owner);
    await h.grantPlatformAdmin(owner);
    const before = await hashOf(owner.userId);
    const closed = { code: "NOT_FOUND", message: "NOT_FOUND" };

    // Session de la console comme session ordinaire (connexion par e-mail) : même refus, même avec revokeOtherSessions.
    for (const cookie of [owner.cookie, ordinary.cookie]) {
      const response = await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true }, cookie);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(closed);
    }
    for (const [path, payload] of [
      ["/change-email", { newEmail: "autre.adresse@qadr.test" }],
      ["/delete-user", { password: PASSWORD }],
      ["/unlink-account", { providerId: "credential" }],
      ["/link-social", { provider: "google" }],
    ] as const) {
      const response = await authPost(path, payload, owner.cookie);
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toEqual(closed);
    }
    expect(await hashOf(owner.userId)).toBe(before);
    expect(await sessionOf(owner.cookie)).toMatchObject({ user: { id: owner.userId } });
    expect(await sessionOf(ordinary.cookie)).toMatchObject({ user: { id: owner.userId } });
    expect(await sessionsOf(owner.userId)).toBe(2);
    expect(await h.count("select count(*) as n from \"user\" where id = $1 and email = 'proprietaire.console@qadr.test'", [owner.userId])).toBe(1);

    // Droit retiré : c'est de nouveau un compte ordinaire, la route lui répond normalement.
    await h.client.query("update platform_admin set revoked_at = $2 where user_id = $1", [owner.userId, new Date()]);
    const after = await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, ordinary.cookie);
    expect(after.status, await after.clone().text()).toBe(200);
    expect(await hashOf(owner.userId)).not.toBe(before);
  });

  it("inventaire des routes voisines pour un commerçant : set-password absente, change-email et delete-user désactivées, update-user limitée", async () => {
    const actor = await h.signUp("Salif Inventaire", "salif.inventaire@general.test");
    const before = await hashOf(actor.userId);
    const setPassword = await authPost("/set-password", { newPassword: NEW_PASSWORD }, actor.cookie);
    expect(setPassword.status).toBe(404);
    const changeEmail = await authPost("/change-email", { newEmail: "salif.autre@general.test" }, actor.cookie);
    expect(changeEmail.status).toBe(400);
    expect(await changeEmail.json()).toMatchObject({ code: "CHANGE_EMAIL_DISABLED" });
    const deleteUser = await authPost("/delete-user", { password: PASSWORD }, actor.cookie);
    expect(deleteUser.status).toBe(404);
    const updateEmail = await authPost("/update-user", { email: "salif.autre@general.test" }, actor.cookie);
    expect(updateEmail.status).toBe(400);
    expect(await updateEmail.json()).toMatchObject({ code: "EMAIL_CAN_NOT_BE_UPDATED" });
    expect((await authPost("/update-user", { name: "Salif Renommé" }, actor.cookie)).status).toBe(200);
    expect(await h.count("select count(*) as n from \"user\" where id = $1 and email = 'salif.inventaire@general.test' and name = 'Salif Renommé'", [actor.userId])).toBe(1);
    expect(await hashOf(actor.userId)).toBe(before);
  });

  describe("limitation partagée en base", () => {
    let actor: Actor;
    beforeAll(async () => { actor = await h.signUp("Mamadou Limite", "mamadou.limite@quincaillerie.test"); });

    it("par compte : 5 essais par 15 minutes, puis 429 même avec le bon mot de passe ; rien ne change", async () => {
      await h.client.query("delete from rate_limit_bucket");
      const before = await hashOf(actor.userId);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < rateRules.passwordChangeAccount.limit + 1; attempt += 1) {
        statuses.push((await authPost("/change-password", { currentPassword: `essai-${attempt}-faux`, newPassword: NEW_PASSWORD }, actor.cookie)).status);
      }
      expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
      const blocked = await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, actor.cookie);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ code: "TOO_MANY_ATTEMPTS", message: "TOO_MANY_ATTEMPTS" });
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await hashOf(actor.userId)).toBe(before);
      // Le compteur porte une empreinte de l'identifiant, jamais l'identifiant lui-même.
      const keys = (await h.client.query<{ key: string }>("select key from rate_limit_bucket")).rows.map((row) => row.key);
      expect(keys.some((key) => key.startsWith("auth.change_password.account:"))).toBe(true);
      expect(JSON.stringify(keys)).not.toContain(actor.userId);
    });

    it("par adresse : 20 requêtes par 15 minutes, comptées même sans session", async () => {
      await h.client.query("delete from rate_limit_bucket");
      const ip = "203.0.113.50";
      const statuses: number[] = [];
      for (let attempt = 0; attempt < rateRules.passwordChangeIp.limit + 1; attempt += 1) {
        statuses.push((await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, undefined, ip)).status);
      }
      expect(statuses.slice(0, rateRules.passwordChangeIp.limit).every((status) => status === 401)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
      // Une autre adresse n'est pas touchée.
      expect((await authPost("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
    });
  });
});
