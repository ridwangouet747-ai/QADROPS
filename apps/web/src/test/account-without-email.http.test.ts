import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as meRoute from "@/app/api/account/me/route";
import * as recoverRoute from "@/app/api/account/recover/route";
import * as recoveryCodeRoute from "@/app/api/account/recovery-code/route";
import * as usernameSignInRoute from "@/app/api/account/sign-in/username/route";
import * as usernameSignUpRoute from "@/app/api/account/sign-up/username/route";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as teamCodesRoute from "@/app/api/business/team/codes/route";
import * as accessCodesRoute from "@/app/api/platform/access-codes/route";
import * as accessCheckRoute from "@/app/api/public/access-codes/check/route";
import * as teamAcceptRoute from "@/app/api/public/team-codes/accept/route";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * E-mail facultatif à l'inscription (mission CTO du 2026-11-17, § 7, cas 1 à 12) : un commerçant crée son compte
 * avec un nom d'utilisateur et un mot de passe, sans adresse ; `user.email` reste NULL, aucune adresse n'est
 * inventée. Mot de passe oublié : code de secours montré une fois, jamais un numéro de téléphone, jamais Resend.
 * Vraies routes, vraies sessions Better Auth, base PGlite migrée ; seul `@/lib/db/client` est remplacé.
 */
const PASSWORD = "mot-de-passe-sans-email-2026";
const PLAN = "plan-standard-sans-email";

describe("compte sans adresse e-mail (mandat § 7)", () => {
  let h: HttpHarness;
  let admin: Actor;
  let counter = 0;
  let ipCounter = 0;

  beforeAll(async () => {
    h = await startHttpHarness();
    await h.client.query("insert into subscription_plan (id,code,name,price_xof,duration_days,active) values ($1,'STANDARD_SE','Standard',5000,30,true)", [PLAN]);
    admin = await h.signUp("Super Admin", "admin@sans-email.test");
    await h.grantPlatformAdmin(admin);
  });
  beforeEach(async () => { await h.client.query("delete from rate_limit_bucket where true"); });
  afterEach(() => { for (const name of ["QADR_ACCESS_CODE", "VERCEL_ENV", "QADR_REGISTRATION_ALLOWLIST", "QADR_REGISTRATION"]) delete process.env[name]; });
  afterAll(async () => { await h?.close(); });

  /* ------------------------------------------------------------------ outils */

  const ip = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const nextUsername = (label: string) => `${label}.${++counter}`;
  const cookiesOf = (result: { headers: Headers }) => result.headers.getSetCookie().map((value) => value.split(";")[0]!).filter((pair) => !pair.endsWith("=")).join("; ");
  const signUpWithoutEmail = (body: Record<string, unknown>, cookie?: string) => h.call(usernameSignUpRoute.POST, {
    path: "/api/account/sign-up/username", body, headers: { "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) } });
  async function owner(label: string) {
    const username = nextUsername(label);
    const result = await signUpWithoutEmail({ name: `Commerçant ${label}`, username, password: PASSWORD });
    expect(result.status, result.text).toBe(201);
    const userId = (await h.client.query<{ id: string }>("select id from \"user\" where username = $1", [username])).rows[0]!.id;
    return { username, result, recoveryCode: result.body.recoveryCode as string, actor: { name: `Commerçant ${label}`, email: "", userId, cookie: cookiesOf(result) } as Actor };
  }
  const me = (cookie: string) => h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor: { name: "", email: "", userId: "", cookie } });
  const signIn = (username: string, password = PASSWORD) => h.call(usernameSignInRoute.POST, {
    path: "/api/account/sign-in/username", body: { username, password }, headers: { "x-forwarded-for": ip() } });
  const recover = (body: Record<string, unknown>) => h.call(recoverRoute.POST, { path: "/api/account/recover", body, headers: { "x-forwarded-for": ip() } });
  const createBusiness = (actor: Actor, extraCookie?: string) => h.call(accountBusinessesRoute.POST, {
    path: "/api/account/businesses", actor: extraCookie ? { ...actor, cookie: `${actor.cookie}; ${extraCookie}` } : actor, body: { name: `Boutique ${actor.name}`, activity: "general" } });
  async function signUpByEmail(email: string, password = PASSWORD) {
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": ip() },
      body: JSON.stringify({ name: "Commerçant e-mail", email, password }),
    }));
    return { status: response.status, cookie: cookiesOf(response) };
  }
  const usersNamed = (username: string) => h.client.query<{ email: string | null; email_verified: boolean }>("select email, email_verified from \"user\" where username = $1", [username]);

  /* ------------------------------------------------------------------ § 7 */

  it("1. avec adresse e-mail : l'inscription Better Auth reste inchangée et l'adresse est enregistrée", async () => {
    const signed = await signUpByEmail("avec-adresse@sans-email.test");
    expect(signed.status).toBe(200);
    expect((await me(signed.cookie)).status).toBe(200);
    expect(await h.count("select count(*)::text n from \"user\" where email = 'avec-adresse@sans-email.test'")).toBe(1);
  });

  it("2. sans adresse e-mail : compte créé, e-mail NULL (aucune adresse inventée), session ouverte, code de secours montré une fois", async () => {
    const created = await owner("sans.adresse");
    expect(created.result.body).toMatchObject({ created: true, username: created.username, signedIn: true });
    expect(created.recoveryCode).toMatch(/^SEC-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect((await usersNamed(created.username)).rows).toEqual([{ email: null, email_verified: false }]);
    // Aucune adresse fabriquée nulle part, et le code de secours n'est stocké qu'en empreinte scrypt.
    expect(await h.count("select count(*)::text n from \"user\" where email like '%' || $1 || '%'", [created.username])).toBe(0);
    const stored = (await h.client.query<{ code_hash: string }>("select code_hash from account_recovery_code where user_id = $1", [created.actor.userId])).rows[0]!.code_hash;
    expect(stored).not.toContain(created.recoveryCode.replace(/-/g, ""));
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    // Le mot de passe est haché par Better Auth, jamais en clair.
    expect(await h.count("select count(*)::text n from account where user_id = $1 and provider_id = 'credential' and password <> $2", [created.actor.userId, PASSWORD])).toBe(1);
    const profile = await me(created.actor.cookie);
    expect(profile.status, profile.text).toBe(200);
    expect(await h.count("select count(*)::text n from audit_event where actor_user_id = $1 and event_type = 'account.created_without_email'", [created.actor.userId])).toBe(1);
  });

  it("3. champ e-mail vide : Better Auth refuse l'adresse vide ; la voie sans e-mail ignore tout champ e-mail", async () => {
    const empty = await signUpByEmail("");
    expect(empty.status).toBe(400);
    const username = nextUsername("champ.vide");
    const created = await signUpWithoutEmail({ name: "Commerçant vide", username, password: PASSWORD, email: "intrus@sans-email.test" });
    expect(created.status, created.text).toBe(201);
    expect((await usersNamed(username)).rows[0]!.email).toBeNull();
    expect(await h.count("select count(*)::text n from \"user\" where email = 'intrus@sans-email.test'")).toBe(0);
  });

  it("4. adresse mal formée refusée par Better Auth ; nom d'utilisateur ou mot de passe invalides refusés sans compte créé", async () => {
    expect((await signUpByEmail("pas-une-adresse")).status).toBe(400);
    expect(await h.count("select count(*)::text n from \"user\" where email = 'pas-une-adresse'")).toBe(0);
    for (const body of [
      { name: "X", username: "ok.nom", password: PASSWORD },
      { name: "Commerçant", username: "é-accent", password: PASSWORD },
      { name: "Commerçant", username: "ab", password: PASSWORD },
      { name: "Commerçant", username: "court.mdp", password: "court" },
    ]) {
      const refused = await signUpWithoutEmail(body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
    expect(await h.count("select count(*)::text n from \"user\" where username in ('ok.nom','court.mdp','ab')")).toBe(0);
  });

  it("5. nom d'utilisateur unique (casse ignorée), y compris face aux comptes d'employés", async () => {
    const first = await owner("unique");
    const again = await signUpWithoutEmail({ name: "Copie", username: first.username.toUpperCase(), password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("username_taken");
    expect(await h.count("select count(*)::text n from \"user\" where username = $1", [first.username])).toBe(1);
  });

  it("6. connexion par nom d'utilisateur ; mauvais mot de passe et nom inconnu : même refus", async () => {
    const created = await owner("connexion");
    const ok = await signIn(created.username);
    expect(ok.status, ok.text).toBe(200);
    expect((await me(cookiesOf(ok))).status).toBe(200);
    const wrong = await signIn(created.username, "mauvais-mot-de-passe");
    const unknown = await signIn("inconnu.total", PASSWORD);
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("7. comptes existants : la connexion par e-mail reste inchangée", async () => {
    await signUpByEmail("ancien@sans-email.test");
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": ip() },
      body: JSON.stringify({ email: "ancien@sans-email.test", password: PASSWORD }),
    }));
    expect(response.status).toBe(200);
    expect((await me(cookiesOf(response))).status).toBe(200);
  });

  it("8 et 9. onboarding : le compte sans e-mail crée son commerce et en devient propriétaire", async () => {
    const created = await owner("onboarding");
    const business = await createBusiness(created.actor);
    expect(business.status, business.text).toBe(201);
    const businessId = business.body.business.id as string;
    expect((await h.client.query<{ role: string }>("select role from member where organization_id = $1 and user_id = $2", [businessId, created.actor.userId])).rows[0]!.role).toBe("owner");
  });

  it("9 bis. code d'accès exigé : sans laissez-passer aucun compte n'est créé ; avec, compte puis commerce ouverts par le code", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    const refusedName = nextUsername("sans.code");
    const refused = await signUpWithoutEmail({ name: "Sans code", username: refusedName, password: PASSWORD });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("SIGN_UP_FAILED");
    expect(await h.count("select count(*)::text n from \"user\" where username = $1", [refusedName])).toBe(0);

    const generated = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId: PLAN, duration: "m1", paymentVerified: true } });
    expect(generated.status, generated.text).toBe(201);
    const checked = await h.call(accessCheckRoute.POST, { path: "/api/public/access-codes/check", body: { code: generated.body.codes[0].code }, headers: { "x-forwarded-for": ip() } });
    const pass = checked.headers.getSetCookie().map((value) => value.split(";")[0]!).find((pair) => pair.startsWith("qadr-access-pass=") && !pair.endsWith("="))!;
    expect(pass).toBeTruthy();
    const username = nextUsername("avec.code");
    const created = await signUpWithoutEmail({ name: "Avec code", username, password: PASSWORD }, pass);
    expect(created.status, created.text).toBe(201);
    const userId = (await h.client.query<{ id: string }>("select id from \"user\" where username = $1", [username])).rows[0]!.id;
    const business = await createBusiness({ name: "Avec code", email: "", userId, cookie: cookiesOf(created) }, pass);
    expect(business.status, business.text).toBe(201);
    expect(business.body.business.access).toMatchObject({ status: "activated" });
  });

  it("9 ter. production Vercel : la liste d'inscription s'applique aussi aux noms d'utilisateur", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.QADR_ACCESS_CODE = "optional";
    process.env.QADR_REGISTRATION_ALLOWLIST = "patron@exemple.ci";
    // Le mode commercial exige un code sur tout déploiement : on le neutralise ici pour isoler la liste.
    process.env.QADR_COMMERCIAL_MODE = "geniuspay";
    try {
      const unlisted = await signUpWithoutEmail({ name: "Hors liste", username: "hors.liste", password: PASSWORD });
      expect(unlisted.status).toBe(422);
      process.env.QADR_REGISTRATION_ALLOWLIST = "patron@exemple.ci,sur.liste";
      const listed = await signUpWithoutEmail({ name: "Sur liste", username: "sur.liste", password: PASSWORD });
      expect(listed.status, listed.text).toBe(201);
    } finally { delete process.env.QADR_COMMERCIAL_MODE; }
  });

  it("10. rôles : le propriétaire sans e-mail invite un employé ; l'employé n'atteint jamais le compte du propriétaire", async () => {
    const boss = await owner("patron");
    const businessId = (await createBusiness(boss.actor)).body.business.id as string;
    await h.grantTrialAccess(businessId);
    const invite = await h.call(teamCodesRoute.POST, { path: "/api/business/team/codes", actor: boss.actor, body: { role: "cashier" } });
    expect(invite.status, invite.text).toBe(201);
    const employeeName = nextUsername("caissier");
    const joined = await h.call(teamAcceptRoute.POST, { path: "/api/public/team-codes/accept", body: { code: invite.body.code, name: "Caissier", username: employeeName, password: "mot-de-passe-employe-2026" }, headers: { "x-forwarded-for": ip() } });
    expect(joined.status, joined.text).toBe(201);
    // Un employé n'a pas de code de secours, et ne peut pas réinitialiser le compte du propriétaire.
    expect(await h.count("select count(*)::text n from account_recovery_code where user_id = (select id from \"user\" where username = $1)", [employeeName])).toBe(0);
    const forged = await recover({ username: boss.username, recoveryCode: "SEC-2222-2222-2222-2222", newPassword: "nouveau-mot-de-passe-2026" });
    expect(forged.status).toBe(401);
    expect((await signIn(boss.username)).status).toBe(200);
    // Le caissier agit avec son propre rôle, pas celui du propriétaire.
    const employee: Actor = { name: "Caissier", email: "", userId: "", cookie: cookiesOf(joined) };
    expect((await h.call(teamCodesRoute.POST, { path: "/api/business/team/codes", actor: employee, body: { role: "manager" } })).status).toBe(403);
    expect((await h.call(productsRoute.GET, { method: "GET", path: "/api/business/products", actor: employee })).status).toBe(200);
  });

  it("11. code de secours : nouveau mot de passe, sessions fermées, code à usage unique remplacé, propriétaire de la plateforme exclu", async () => {
    const created = await owner("secours");
    const other = await signIn(created.username);
    const before = [created.actor.cookie, cookiesOf(other)];
    for (const cookie of before) expect((await me(cookie)).status).toBe(200);

    const wrongCode = await recover({ username: created.username, recoveryCode: "SEC-3333-3333-3333-3333", newPassword: "nouveau-mot-de-passe-2026" });
    const unknownUser = await recover({ username: "personne.ici", recoveryCode: created.recoveryCode, newPassword: "nouveau-mot-de-passe-2026" });
    const malformed = await recover({ username: created.username, recoveryCode: "+2250700000000", newPassword: "nouveau-mot-de-passe-2026" });
    expect([wrongCode.status, unknownUser.status, malformed.status]).toEqual([401, 401, 401]);
    expect(wrongCode.body).toEqual(unknownUser.body);

    const recovered = await recover({ username: created.username, recoveryCode: created.recoveryCode.toLowerCase().replace(/-/g, " "), newPassword: "nouveau-mot-de-passe-2026" });
    expect(recovered.status, recovered.text).toBe(200);
    const nextCode = recovered.body.recoveryCode as string;
    expect(nextCode).toMatch(/^SEC-/);
    expect(nextCode).not.toBe(created.recoveryCode);
    expect(recovered.headers.getSetCookie().some((value) => value.startsWith("better-auth"))).toBe(false);
    for (const cookie of before) expect((await me(cookie)).status).toBe(401);
    expect((await signIn(created.username)).status).toBe(401);
    expect((await signIn(created.username, "nouveau-mot-de-passe-2026")).status).toBe(200);
    // L'ancien code ne sert plus ; le nouveau, oui.
    expect((await recover({ username: created.username, recoveryCode: created.recoveryCode, newPassword: "encore-un-mot-de-passe" })).status).toBe(401);
    expect((await recover({ username: created.username, recoveryCode: nextCode, newPassword: "encore-un-mot-de-passe" })).status).toBe(200);
    expect(await h.count("select count(*)::text n from audit_event where actor_user_id = $1 and event_type = 'account.password_recovered_with_code'", [created.actor.userId])).toBe(2);

    // Le propriétaire de la plateforme n'a jamais de récupération par cette voie, même avec un code valide en base.
    await h.client.query("update \"user\" set username = 'proprietaire.plateforme' where id = $1", [admin.userId]);
    await h.client.query("insert into account_recovery_code (user_id, code_hash, created_at) select $1, code_hash, now() from account_recovery_code where user_id = $2", [admin.userId, created.actor.userId]);
    expect((await recover({ username: "proprietaire.plateforme", recoveryCode: nextCode, newPassword: "prise-de-controle-2026" })).status).toBe(401);
    await h.client.query("delete from account_recovery_code where user_id = $1", [admin.userId]);
  });

  it("11 bis. le titulaire connecté renouvelle son code avec son mot de passe actuel ; l'ancien cesse de fonctionner", async () => {
    const created = await owner("renouvelle");
    const state = await h.call(recoveryCodeRoute.GET, { method: "GET", path: "/api/account/recovery-code", actor: created.actor });
    expect(state.body).toEqual({ present: true, hasEmail: false });
    const refused = await h.call(recoveryCodeRoute.POST, { path: "/api/account/recovery-code", actor: created.actor, body: { currentPassword: "mauvais" } });
    expect(refused.status).toBe(403);
    const renewed = await h.call(recoveryCodeRoute.POST, { path: "/api/account/recovery-code", actor: created.actor, body: { currentPassword: PASSWORD } });
    expect(renewed.status, renewed.text).toBe(200);
    expect((await recover({ username: created.username, recoveryCode: created.recoveryCode, newPassword: "nouveau-mot-de-passe-2026" })).status).toBe(401);
    expect((await recover({ username: created.username, recoveryCode: renewed.body.recoveryCode, newPassword: "nouveau-mot-de-passe-2026" })).status).toBe(200);
  });

  it("12. déconnexion puis reconnexion par nom d'utilisateur", async () => {
    const created = await owner("deconnexion");
    const signOut = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-out`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, cookie: created.actor.cookie }, body: "{}",
    }));
    expect(signOut.status).toBe(200);
    expect((await me(created.actor.cookie)).status).toBe(401);
    const again = await signIn(created.username);
    expect(again.status).toBe(200);
    expect((await me(cookiesOf(again))).status).toBe(200);
  });
});

