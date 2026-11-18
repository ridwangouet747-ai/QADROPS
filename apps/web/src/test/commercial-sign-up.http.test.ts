import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as usernameSignInRoute from "@/app/api/account/sign-in/username/route";
import * as usernameSignUpRoute from "@/app/api/account/sign-up/username/route";
import * as teamCodesRoute from "@/app/api/business/team/codes/route";
import * as revokeRoute from "@/app/api/platform/access-codes/[codeId]/revoke/route";
import * as accessCodesRoute from "@/app/api/platform/access-codes/route";
import * as platformSignInRoute from "@/app/api/platform/auth/sign-in/route";
import * as platformBusinessesRoute from "@/app/api/platform/businesses/route";
import * as platformDashboardRoute from "@/app/api/platform/dashboard/route";
import * as checkRoute from "@/app/api/public/access-codes/check/route";
import * as teamAcceptRoute from "@/app/api/public/team-codes/accept/route";
import { registrationPolicy } from "@/lib/auth/registration";
import { createQadrAuth, signUpRefusal } from "@/lib/auth/server";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * 2026-11-18 : le code commercial `QADR-` est l'autorisation d'inscription. Production simulée telle qu'elle est
 * configurée (`VERCEL_ENV=production`, mode `manual_code`, aucune `QADR_REGISTRATION_ALLOWLIST`, aucun
 * `QADR_REGISTRATION`) : un commerçant muni d'un code valide crée son compte sans figurer sur aucune liste ; sans
 * code valide, rien n'est créé. Vraies routes, vraies sessions Better Auth, base PGlite migrée.
 */
const PASSWORD = "mot-de-passe-inscription-code-2026";
const PLAN = "plan-standard-inscription";
const day = 86_400_000;
const PRODUCTION_ENV = ["VERCEL_ENV", "QADR_REGISTRATION_ALLOWLIST", "QADR_REGISTRATION", "QADR_COMMERCIAL_MODE", "QADR_ACCESS_CODE"] as const;

describe("inscription commerciale par code QADR (2026-11-18)", () => {
  let h: HttpHarness;
  let admin: Actor;
  let counter = 0;
  let ipCounter = 0;

  beforeAll(async () => {
    h = await startHttpHarness();
    await h.client.query("insert into subscription_plan (id,code,name,price_xof,duration_days,active) values ($1,'STANDARD_IC','Standard',5000,30,true)", [PLAN]);
    admin = await h.signUp("Super Admin", "admin@inscription-code.test");
    await h.grantPlatformAdmin(admin);
  });
  beforeEach(async () => {
    await h.client.query("delete from rate_limit_bucket where true");
    // Configuration réelle de la production : déploiement Vercel, aucune liste, aucun mode explicite.
    for (const name of PRODUCTION_ENV) delete process.env[name];
    process.env.VERCEL_ENV = "production";
  });
  afterEach(() => { for (const name of PRODUCTION_ENV) delete process.env[name]; });
  afterAll(async () => { await h?.close(); });

  /* ------------------------------------------------------------------ outils */

  const ip = () => `192.0.2.${(ipCounter++ % 250) + 1}`;
  const nextUsername = (label: string) => `${label}.${++counter}`;
  const cookiesOf = (result: { headers: Headers }) => result.headers.getSetCookie().map((value) => value.split(";")[0]!).filter((pair) => !pair.endsWith("=")).join("; ");
  const passOf = (result: HttpResult) => result.headers.getSetCookie().map((value) => value.split(";")[0]!).find((pair) => pair.startsWith("qadr-access-pass=") && !pair.endsWith("="));
  async function newCode() {
    const result = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId: PLAN, duration: "m1", paymentVerified: true } });
    expect(result.status, result.text).toBe(201);
    return result.body.codes[0] as { id: string; code: string };
  }
  /** Code saisi sur /redeem-code : renvoie le laissez-passer signé posé par le serveur. */
  async function passFor(code: string) {
    const checked = await h.call(checkRoute.POST, { path: "/api/public/access-codes/check", body: { code }, headers: { "x-forwarded-for": ip() } });
    expect(checked.status, checked.text).toBe(200);
    const pass = passOf(checked);
    expect(pass).toBeTruthy();
    return pass!;
  }
  const signUpWithoutEmail = (username: string, cookie?: string, body: Record<string, unknown> = {}) => h.call(usernameSignUpRoute.POST, {
    path: "/api/account/sign-up/username", body: { name: "Commerçant", username, password: PASSWORD, ...body }, headers: { "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) } });
  const actorOf = async (username: string, result: HttpResult): Promise<Actor> => {
    const userId = (await h.client.query<{ id: string }>("select id from \"user\" where username = $1", [username])).rows[0]!.id;
    return { name: "Commerçant", email: "", userId, cookie: cookiesOf(result) };
  };
  const createBusiness = (actor: Actor, pass?: string) => h.call(accountBusinessesRoute.POST, {
    path: "/api/account/businesses", actor: pass ? { ...actor, cookie: `${actor.cookie}; ${pass}` } : actor, body: { name: `Boutique ${actor.userId.slice(0, 6)}`, activity: "general" } });
  const usersNamed = (username: string) => h.count("select count(*)::text n from \"user\" where username = $1", [username]);
  const consumedAt = async (codeId: string) => (await h.client.query<{ consumed_at: Date | null }>("select consumed_at from commercial_access_code where id = $1", [codeId])).rows[0]!.consumed_at;
  /** Better Auth tel que getAuth() le construit en production : liste lue dans l'environnement, code exigé. */
  const productionAuth = () => createQadrAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: HARNESS_ORIGIN, isProduction: false,
    registration: registrationPolicy({ VERCEL_ENV: "production" }) });
  const signUpByEmail = (auth: ReturnType<typeof createQadrAuth>, email: string, pass?: string) => auth.handler(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": ip(), ...(pass ? { cookie: pass } : {}) },
    body: JSON.stringify({ name: "Commerçant e-mail", email, password: PASSWORD }),
  }));

  /* ------------------------------------------------------------------ cas */

  it("test principal : code valide, nom absent de toute liste → compte puis commerce ouverts par le code", async () => {
    expect(registrationPolicy()).toEqual({ mode: "allowlist", emails: new Set() });
    const code = await newCode();
    const pass = await passFor(code.code);
    const username = nextUsername("nouveau.commercant");
    const created = await signUpWithoutEmail(username, pass);
    expect(created.status, created.text).toBe(201);
    expect(created.body.recoveryCode).toMatch(/^SEC-/);
    // Le compte n'a encore rien consommé : le code n'est pris qu'avec le commerce.
    expect(await consumedAt(code.id)).toBeNull();
    const actor = await actorOf(username, created);
    const business = await createBusiness(actor, pass);
    expect(business.status, business.text).toBe(201);
    expect(business.body.business.access).toMatchObject({ status: "activated" });
    expect(await consumedAt(code.id)).not.toBeNull();
  });

  it("sans code : refus générique, aucun compte ; QADR_REGISTRATION_ALLOWLIST ne remplace pas le code", async () => {
    const username = nextUsername("sans.code");
    const refused = await signUpWithoutEmail(username);
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({ error: "Impossible de créer le compte.", code: "SIGN_UP_FAILED" });
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(await usersNamed(username)).toBe(0);
    // Un nom inscrit sur l'ancienne liste n'ouvre plus rien sans code.
    const listed = nextUsername("sur.liste");
    process.env.QADR_REGISTRATION_ALLOWLIST = listed;
    expect((await signUpWithoutEmail(listed)).status).toBe(422);
    expect(await usersNamed(listed)).toBe(0);
  });

  it("laissez-passer invalide (forgé, altéré, d'un autre secret) : refus, aucun compte", async () => {
    const pass = await passFor((await newCode()).code);
    const [name, token] = pass.split("=") as [string, string];
    const forged = [`${name}=${token.slice(0, -2)}xx`, `${name}=eyJ2IjoxLCJjIjoiY29kZSIsImUiOjk5OTk5OTk5OTk5OTl9.faux`, `${name}=`];
    for (const cookie of forged) {
      const username = nextUsername("passe.invalide");
      expect((await signUpWithoutEmail(username, cookie)).status).toBe(422);
      expect(await usersNamed(username)).toBe(0);
    }
  });

  it("code expiré, révoqué ou déjà utilisé après la saisie : le laissez-passer ne suffit plus, aucun compte", async () => {
    const expired = await newCode();
    const expiredPass = await passFor(expired.code);
    await h.client.query("update commercial_access_code set created_at = $2, activation_deadline = $3 where id = $1", [expired.id, new Date(Date.now() - 2 * day), new Date(Date.now() - 1000)]);
    const expiredName = nextUsername("code.expire");
    expect((await signUpWithoutEmail(expiredName, expiredPass)).status).toBe(422);
    expect(await usersNamed(expiredName)).toBe(0);

    const revoked = await newCode();
    const revokedPass = await passFor(revoked.code);
    const revocation = await h.call(revokeRoute.POST, { path: `/api/platform/access-codes/${revoked.id}/revoke`, actor: admin, body: { reason: "Paiement annulé par le client" }, params: { codeId: revoked.id } });
    expect(revocation.status, revocation.text).toBe(200);
    const revokedName = nextUsername("code.revoque");
    expect((await signUpWithoutEmail(revokedName, revokedPass)).status).toBe(422);
    expect(await usersNamed(revokedName)).toBe(0);

    const used = await newCode();
    const usedPass = await passFor(used.code);
    const first = nextUsername("premier");
    const firstCreated = await signUpWithoutEmail(first, usedPass);
    expect(firstCreated.status, firstCreated.text).toBe(201);
    expect((await createBusiness(await actorOf(first, firstCreated), usedPass)).status).toBe(201);
    const late = nextUsername("trop.tard");
    expect((await signUpWithoutEmail(late, usedPass)).status).toBe(422);
    expect(await usersNamed(late)).toBe(0);
  });

  it("double soumission : un seul compte, l'autre réponse est 409, le code n'est pas consommé", async () => {
    const code = await newCode();
    const pass = await passFor(code.code);
    const username = nextUsername("double");
    const responses = await Promise.all([signUpWithoutEmail(username, pass), signUpWithoutEmail(username, pass)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)!.body.code).toBe("username_taken");
    expect(await usersNamed(username)).toBe(1);
    expect(await consumedAt(code.id)).toBeNull();
    // Renvoi plus tard du même formulaire : même refus, toujours un seul compte.
    expect((await signUpWithoutEmail(username, pass)).status).toBe(409);
    expect(await usersNamed(username)).toBe(1);
  });

  it("échec de création du compte : le code reste intact et sert ensuite", async () => {
    const code = await newCode();
    const pass = await passFor(code.code);
    const username = nextUsername("echec");
    expect((await signUpWithoutEmail(username, pass, { password: "court" })).status).toBe(400);
    expect((await signUpWithoutEmail("x", pass)).status).toBe(400);
    expect(await usersNamed(username)).toBe(0);
    expect(await consumedAt(code.id)).toBeNull();
    const retried = await signUpWithoutEmail(username, pass);
    expect(retried.status, retried.text).toBe(201);
    expect((await createBusiness(await actorOf(username, retried), pass)).status).toBe(201);
  });

  it("reprise après coupure réseau : réponse perdue, reconnexion puis commerce ouvert avec le même code, une seule fois", async () => {
    const code = await newCode();
    const pass = await passFor(code.code);
    const username = nextUsername("coupure");
    expect((await signUpWithoutEmail(username, pass)).status).toBe(201); // réponse jamais reçue par le navigateur
    expect((await signUpWithoutEmail(username, pass)).status).toBe(409); // renvoi : le compte existe déjà
    const signedIn = await h.call(usernameSignInRoute.POST, { path: "/api/account/sign-in/username", body: { username, password: PASSWORD }, headers: { "x-forwarded-for": ip() } });
    expect(signedIn.status, signedIn.text).toBe(200);
    const actor = await actorOf(username, signedIn);
    const opened = await createBusiness(actor, pass);
    expect(opened.status, opened.text).toBe(201);
    const businessId = opened.body.business.id as string;
    expect(await h.count("select count(*)::text n from business_subscription where business_id = $1", [businessId])).toBe(1);
    expect(await h.count("select count(*)::text n from member where user_id = $1", [actor.userId])).toBe(1);
  });

  it("inscription avec adresse e-mail : le code suffit, sans liste ; sans code, refus générique", async () => {
    const auth = productionAuth();
    const refused = await signUpByEmail(auth, `sans-code-${++counter}@inscription-code.test`);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual(signUpRefusal);
    const pass = await passFor((await newCode()).code);
    const email = `avec-code-${++counter}@inscription-code.test`;
    const created = await signUpByEmail(auth, email, pass);
    expect(created.status, await created.clone().text()).toBe(200);
    expect(await h.count("select count(*)::text n from \"user\" where email = $1", [email])).toBe(1);
  });

  it("mode sans code (geniuspay) en production : la liste reste la seule porte, rien n'est ouvert sans elle", async () => {
    process.env.QADR_COMMERCIAL_MODE = "geniuspay";
    const unlisted = nextUsername("hors.liste");
    expect((await signUpWithoutEmail(unlisted)).status).toBe(422);
    const auth = createQadrAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: HARNESS_ORIGIN, isProduction: false,
      registration: registrationPolicy({ VERCEL_ENV: "production" }), accessCodeRequired: () => false });
    expect((await signUpByEmail(auth, `geniuspay-${++counter}@inscription-code.test`)).status).toBe(422);
  });

  it("invitation employé EQP- : compte créé sans code commercial ni liste, rôle fixé par le serveur", async () => {
    const pass = await passFor((await newCode()).code);
    const bossName = nextUsername("patron");
    const boss = await actorOf(bossName, await signUpWithoutEmail(bossName, pass));
    const opened = await createBusiness(boss, pass);
    expect(opened.status, opened.text).toBe(201);
    const businessId = opened.body.business.id as string;
    const invite = await h.call(teamCodesRoute.POST, { path: "/api/business/team/codes", actor: boss, body: { role: "cashier" } });
    expect(invite.status, invite.text).toBe(201);
    const employee = nextUsername("caissier");
    // Le navigateur tente de se donner le rôle de propriétaire : ignoré.
    const joined = await h.call(teamAcceptRoute.POST, { path: "/api/public/team-codes/accept",
      body: { code: invite.body.code, name: "Caissier", username: employee, password: "mot-de-passe-employe-2026", role: "owner" }, headers: { "x-forwarded-for": ip() } });
    expect(joined.status, joined.text).toBe(201);
    const roles = await h.client.query<{ role: string }>("select m.role from member m join \"user\" u on u.id = m.user_id where u.username = $1 and m.organization_id = $2", [employee, businessId]);
    expect(roles.rows.map((row) => row.role)).toEqual(["cashier"]);
    // Un code employé ne vaut pas code commercial : il n'ouvre pas d'inscription de commerçant.
    const intruder = nextUsername("intrus");
    expect((await signUpWithoutEmail(intruder, undefined, { code: invite.body.code })).status).toBe(422);
    expect(await usersNamed(intruder)).toBe(0);
  });

  it("Super Admin : un compte ouvert par un code commercial n'atteint jamais la console de la plateforme", async () => {
    const pass = await passFor((await newCode()).code);
    const username = nextUsername("pas.admin");
    const created = await signUpWithoutEmail(username, pass);
    expect(created.status, created.text).toBe(201);
    const merchant = await actorOf(username, created);
    expect((await createBusiness(merchant, pass)).status).toBe(201);
    for (const [route, path] of [[platformDashboardRoute.GET, "/api/platform/dashboard"], [platformBusinessesRoute.GET, "/api/platform/businesses"]] as const) {
      expect((await h.call(route, { method: "GET", path, actor: merchant })).status).toBe(404);
    }
    const platformLogin = await h.call(platformSignInRoute.POST, { path: "/api/platform/auth/sign-in", body: { username, password: PASSWORD }, headers: { "x-forwarded-for": ip() } });
    expect(platformLogin.status).not.toBe(200);
    expect(platformLogin.headers.get("set-cookie") ?? "").not.toContain("platform");
    expect(await h.count("select count(*)::text n from platform_admin where user_id = $1", [merchant.userId])).toBe(0);
    expect(await h.count("select count(*)::text n from platform_session where user_id = $1", [merchant.userId])).toBe(0);
  });
});
