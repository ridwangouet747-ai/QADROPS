import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as activeBusinessRoute from "@/app/api/account/active-business/route";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as meRoute from "@/app/api/account/me/route";
import * as usernameSignInRoute from "@/app/api/account/sign-in/username/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as teamRoute from "@/app/api/business/team/route";
import * as revokeCodeRoute from "@/app/api/business/team/codes/[codeId]/revoke/route";
import * as teamCodesRoute from "@/app/api/business/team/codes/route";
import * as memberAccessRoute from "@/app/api/business/team/members/[memberId]/access/route";
import * as memberRoute from "@/app/api/business/team/members/[memberId]/route";
import * as memberSessionsRoute from "@/app/api/business/team/members/[memberId]/sessions/route";
import * as acceptRoute from "@/app/api/public/team-codes/accept/route";
import * as checkRoute from "@/app/api/public/team-codes/check/route";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Codes d'invitation des employés (2026-11-16, docs/team-invite-codes.md) : le propriétaire (ou un administrateur)
 * crée un code `EQP-…` pour un rôle ; l'employé choisit son nom d'utilisateur et son mot de passe sur /join-business,
 * sans adresse e-mail. Mandat § 13.3 (cas 1 à 15) et changements de rôle.
 * Vraies routes, vraies sessions Better Auth, base PGlite migrée ; seul `@/lib/db/client` est remplacé.
 */
const EMPLOYEE_PASSWORD = "mot-de-passe-employe-2026";
const day = 86_400_000;

describe("codes d'invitation des employés (mandat § 13.3)", () => {
  let h: HttpHarness;
  let owner: Actor;
  let businessId = "";
  let otherOwner: Actor;
  let otherBusinessId = "";
  let counter = 0;
  let ipCounter = 0;

  beforeAll(async () => {
    h = await startHttpHarness();
    owner = await h.signUp("Propriétaire A", "proprio-a@codes-equipe.test");
    businessId = await h.createBusiness(owner, "Quincaillerie A");
    otherOwner = await h.signUp("Propriétaire B", "proprio-b@codes-equipe.test");
    otherBusinessId = await h.createBusiness(otherOwner, "Boutique B");
  });
  beforeEach(async () => { await h.client.query("delete from rate_limit_bucket where true"); });
  afterAll(async () => { await h?.close(); });

  /* ------------------------------------------------------------------ outils */

  const ip = () => `192.0.2.${(ipCounter++ % 250) + 1}`;
  const username = (label: string) => `${label}.${++counter}`;
  const cookiesOf = (result: HttpResult) => result.headers.getSetCookie().map((value) => value.split(";")[0]!).filter((pair) => !pair.endsWith("=")).join("; ");
  const createCode = (actor: Actor, body: Record<string, unknown>) => h.call(teamCodesRoute.POST, { path: "/api/business/team/codes", actor, body });
  async function code(actor: Actor, role: string, extra: Record<string, unknown> = {}) {
    const result = await createCode(actor, { role, ...extra });
    expect(result.status, result.text).toBe(201);
    return result.body as { id: string; code: string; hint: string; role: string; displayName: string | null; expiresAt: string };
  }
  const check = (value: unknown) => h.call(checkRoute.POST, { path: "/api/public/team-codes/check", body: { code: value }, headers: { "x-forwarded-for": ip() } });
  const accept = (body: Record<string, unknown>) => h.call(acceptRoute.POST, { path: "/api/public/team-codes/accept", body, headers: { "x-forwarded-for": ip() } });
  /** Code créé par `actor`, puis accepté : renvoie l'employé connecté (cookie posé par la route). */
  async function join(actor: Actor, role: string, label = role) {
    const invite = await code(actor, role);
    const name = username(label);
    const joined = await accept({ code: invite.code, name: `Employé ${label}`, username: name, password: EMPLOYEE_PASSWORD });
    expect(joined.status, joined.text).toBe(201);
    const userId = (await h.client.query<{ id: string }>("select id from \"user\" where username = $1", [name])).rows[0]!.id;
    const memberId = (await h.client.query<{ id: string }>("select id from member where user_id = $1", [userId])).rows[0]!.id;
    const employee: Actor = { name: `Employé ${label}`, email: "", userId, cookie: cookiesOf(joined) };
    return { invite, joined, employee, username: name, memberId };
  }
  const signInByUsername = (name: string, password = EMPLOYEE_PASSWORD) => h.call(usernameSignInRoute.POST, {
    path: "/api/account/sign-in/username", body: { username: name, password }, headers: { "x-forwarded-for": ip() } });
  const listProducts = (actor: Actor) => h.call(productsRoute.GET, { method: "GET", path: "/api/business/products", actor });
  const createProduct = (actor: Actor) => h.call(productsRoute.POST, { path: "/api/business/products", actor, body: { name: `Article ${randomUUID().slice(0, 6)}`, salePriceXof: "1500" } });
  const roleOf = async (memberId: string) => (await h.client.query<{ role: string }>("select role from member where id = $1", [memberId])).rows[0]!.role;

  /* ------------------------------------------------------------------ § 13.3 */

  it("1. le propriétaire ouvre la gestion des employés et voit les rôles qu'il peut confier", async () => {
    const codes = await h.call(teamCodesRoute.GET, { method: "GET", path: "/api/business/team/codes", actor: owner });
    expect(codes.status, codes.text).toBe(200);
    expect(codes.headers.get("cache-control")).toBe("private, no-store");
    expect([...codes.body.delegableRoles].sort()).toEqual(["accountant", "admin", "cashier", "member", "stock_manager"]);
    expect((await h.call(teamRoute.GET, { method: "GET", path: "/api/business/team", actor: owner })).status).toBe(200);
  });

  it("2. seul un rôle valide est accepté : jamais propriétaire, jamais Super Admin", async () => {
    for (const role of ["owner", "platform_admin", "superadmin", ""]) {
      const refused = await createCode(owner, { role });
      expect(refused.status, role).toBe(400);
    }
    expect((await createCode(owner, { role: "cashier", expiresInDays: 31 })).status).toBe(400);
    expect((await createCode(owner, { role: "cashier", expiresInDays: 0 })).status).toBe(400);
    expect(await h.count("select count(*)::text n from business_invite_code where business_id = $1 and role not in ('admin','cashier','stock_manager','accountant','member')", [businessId])).toBe(0);
  });

  it("3. création du code : format EQP, expiration à 7 jours par défaut, empreinte seule en base, audit", async () => {
    const before = Date.now();
    const created = await code(owner, "cashier", { displayName: "Awa (caisse)" });
    expect(created.code).toMatch(/^EQP(-[2-9A-HJKMNP-Z]{4}){3}$/);
    expect(created.displayName).toBe("Awa (caisse)");
    const expiresIn = new Date(created.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(7 * day - 5_000);
    expect(expiresIn).toBeLessThanOrEqual(7 * day + 5_000);
    const stored = (await h.client.query<{ row: string }>("select row_to_json(c)::text as row from business_invite_code c where id = $1", [created.id])).rows[0]!.row;
    expect(stored).not.toContain(created.code);
    expect(stored).not.toContain(created.code.replace(/-/g, ""));
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'team.invite_code_created' and entity_id = $1 and business_id = $2", [created.id, businessId])).toBe(1);
    const custom = await code(owner, "member", { expiresInDays: 2 });
    expect(new Date(custom.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(2 * day);
  });

  it("4. copie de l'invitation : le code n'apparaît qu'à la création, la liste ne montre que ses 4 derniers signes", async () => {
    const created = await code(owner, "stock_manager");
    const listed = await h.call(teamCodesRoute.GET, { method: "GET", path: "/api/business/team/codes", actor: owner });
    expect(listed.text).not.toContain(created.code);
    expect(listed.text).not.toContain(created.code.replace(/-/g, ""));
    expect(listed.body.codes.find((item: { id: string }) => item.id === created.id)).toMatchObject({ hint: created.hint, role: "stock_manager", state: "pending", canRevoke: true });
    expect(created.hint).toBe(created.code.replace(/-/g, "").slice(-4));
  });

  it("5 à 7. activation par l'employé : il voit le commerce et le rôle, crée ses identifiants, le rôle vient du code", async () => {
    const invite = await code(owner, "cashier");
    const checked = await check(invite.code.toLowerCase());
    expect(checked.status, checked.text).toBe(200);
    expect(checked.body).toMatchObject({ valid: true, businessName: "Quincaillerie A", role: "cashier" });
    // Rôle et commerce glissés dans le corps : ignorés.
    const name = username("Awa");
    const joined = await accept({ code: invite.code, name: "Awa Koné", username: name.toUpperCase(), password: EMPLOYEE_PASSWORD, role: "owner", businessId: otherBusinessId });
    expect(joined.status, joined.text).toBe(201);
    expect(joined.body).toMatchObject({ joined: true, businessId, role: "cashier", username: name.toLowerCase(), signedIn: true });
    const [created] = (await h.client.query<{ id: string; email: string | null; username: string; email_verified: boolean }>(
      "select id, email, username, email_verified from \"user\" where username = $1", [name.toLowerCase()])).rows;
    expect(created).toMatchObject({ email: null, username: name.toLowerCase() });
    const credential = (await h.client.query<{ password: string }>("select password from account where user_id = $1 and provider_id = 'credential'", [created!.id])).rows[0]!;
    expect(credential.password).not.toContain(EMPLOYEE_PASSWORD);
    const memberships = (await h.client.query<{ organization_id: string; role: string }>("select organization_id, role from member where user_id = $1", [created!.id])).rows;
    expect(memberships).toEqual([{ organization_id: businessId, role: "cashier" }]);
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'team.member_joined_by_code' and business_id = $1 and actor_user_id = $2", [businessId, created!.id])).toBe(1);
    // La session ouverte par l'acceptation désigne déjà le commerce.
    const employee: Actor = { name: "Awa Koné", email: "", userId: created!.id, cookie: cookiesOf(joined) };
    expect((await listProducts(employee)).status).toBe(200);
  });

  it("6 bis. identifiants refusés : nom d'utilisateur pris, mal formé, mot de passe trop court ; le code reste utilisable", async () => {
    const first = await join(owner, "member", "unique");
    const invite = await code(owner, "member");
    const taken = await accept({ code: invite.code, name: "Doublon", username: first.username, password: EMPLOYEE_PASSWORD });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("username_taken");
    for (const bad of ["ab", "nom avec espace", "électricien", "a".repeat(31)]) {
      expect((await accept({ code: invite.code, name: "Employé", username: bad, password: EMPLOYEE_PASSWORD })).status, bad).toBe(400);
    }
    expect((await accept({ code: invite.code, name: "Employé", username: username("court"), password: "1234567" })).status).toBe(400);
    expect((await check(invite.code)).status).toBe(200);
    expect(await h.count("select count(*)::text n from business_invite_code where id = $1 and consumed_at is null", [invite.id])).toBe(1);
  });

  it("8. connexion sans e-mail, par nom d'utilisateur ; refus identique pour un mauvais mot de passe ou un compte inconnu", async () => {
    const { username: name } = await join(owner, "cashier", "connexion");
    const signedIn = await signInByUsername(name.toUpperCase());
    expect(signedIn.status, signedIn.text).toBe(200);
    const employee: Actor = { name, email: "", userId: "", cookie: cookiesOf(signedIn) };
    // Nouvelle session : l'employé choisit son commerce (il n'en a qu'un), puis travaille.
    expect((await h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor: employee, body: { businessId } })).status).toBe(200);
    expect((await listProducts(employee)).status).toBe(200);
    const wrong = await signInByUsername(name, "mauvais-mot-de-passe");
    const unknown = await signInByUsername("personne.inconnue");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe("invalid_credentials");
    expect(wrong.headers.getSetCookie()).toHaveLength(0);
  });

  it("8 bis. déconnexion puis reconnexion de l'employé avec ses identifiants : même commerce, même rôle, code non requis", async () => {
    const { employee, username: name, invite } = await join(owner, "cashier", "retour");
    const signOut = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-out`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, cookie: employee.cookie }, body: "{}",
    }));
    expect(signOut.status).toBe(200);
    expect((await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor: employee })).status).toBe(401);
    expect((await listProducts(employee)).status).toBe(401);
    // Retour sur /login : nom d'utilisateur + mot de passe seulement ; le code d'invitation déjà consommé ne sert plus.
    const again = await signInByUsername(name);
    expect(again.status, again.text).toBe(200);
    const returning: Actor = { name, email: "", userId: employee.userId, cookie: cookiesOf(again) };
    const me = await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor: returning });
    expect(me.status, me.text).toBe(200);
    const businesses = (me.body as { businesses: { id: string; disabled: boolean; role: string }[] }).businesses;
    expect(businesses.map((row) => [row.id, row.disabled, row.role])).toEqual([[businessId, false, "cashier"]]);
    expect((await h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor: returning, body: { businessId } })).status).toBe(200);
    expect((await listProducts(returning)).status).toBe(200);
    expect((await accept({ code: invite.code, name: "Autre", username: username("reprise"), password: EMPLOYEE_PASSWORD })).status).toBe(409);
  });

  it("9 et 10. permissions du rôle : le caissier lit le catalogue mais ne crée ni article ni code, ne change aucun rôle", async () => {
    const cashier = await join(owner, "cashier", "permissions");
    const target = await join(owner, "member", "cible");
    expect((await listProducts(cashier.employee)).status).toBe(200);
    expect((await createProduct(cashier.employee)).status).toBe(403);
    expect((await createCode(cashier.employee, { role: "cashier" })).status).toBe(403);
    expect((await h.call(teamCodesRoute.GET, { method: "GET", path: "/api/business/team/codes", actor: cashier.employee })).status).toBe(403);
    const escalate = await h.call(memberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${cashier.memberId}`, actor: cashier.employee, body: { role: "admin" }, params: { memberId: cashier.memberId } });
    expect(escalate.status).toBe(403);
    const other = await h.call(memberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${target.memberId}`, actor: cashier.employee, body: { role: "admin" }, params: { memberId: target.memberId } });
    expect(other.status).toBe(403);
    expect(await roleOf(cashier.memberId)).toBe("cashier");
    expect(await roleOf(target.memberId)).toBe("member");
    // Le gestionnaire de stock, lui, crée des articles.
    const stock = await join(owner, "stock_manager", "stock");
    expect((await createProduct(stock.employee)).status).toBe(201);
  });

  it("changements de rôle : le propriétaire promeut un employé, les droits suivent aussitôt ; tout est tracé", async () => {
    const employee = await join(owner, "cashier", "promu");
    expect((await createProduct(employee.employee)).status).toBe(403);
    const changed = await h.call(memberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${employee.memberId}`, actor: owner, body: { role: "stock_manager" }, params: { memberId: employee.memberId } });
    expect(changed.status, changed.text).toBe(200);
    expect(await roleOf(employee.memberId)).toBe("stock_manager");
    expect((await createProduct(employee.employee)).status).toBe(201);
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'team.role_changed' and entity_id = $1", [employee.memberId])).toBe(1);
  });

  it("aucune auto-promotion : un administrateur ne crée ni ne révoque de code administrateur et ne nomme pas d'administrateur", async () => {
    const admin = await join(owner, "admin", "admin");
    const listed = await h.call(teamCodesRoute.GET, { method: "GET", path: "/api/business/team/codes", actor: admin.employee });
    expect(listed.status).toBe(200);
    expect(listed.body.delegableRoles).not.toContain("admin");
    const refused = await createCode(admin.employee, { role: "admin" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("role_not_delegable");
    expect((await createCode(admin.employee, { role: "cashier" })).status).toBe(201);
    // Code administrateur créé par le propriétaire : l'administrateur ne peut pas le révoquer.
    const ownerAdminCode = await code(owner, "admin");
    const revokeAttempt = await h.call(revokeCodeRoute.POST, { path: `/api/business/team/codes/${ownerAdminCode.id}/revoke`, actor: admin.employee, params: { codeId: ownerAdminCode.id } });
    expect(revokeAttempt.status).toBe(403);
    const cashier = await join(owner, "cashier", "sousadmin");
    const promote = await h.call(memberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${cashier.memberId}`, actor: admin.employee, body: { role: "admin" }, params: { memberId: cashier.memberId } });
    expect(promote.status).toBe(403);
    expect(await roleOf(cashier.memberId)).toBe("cashier");
    const self = await h.call(memberRoute.PATCH, { method: "PATCH", path: `/api/business/team/members/${admin.memberId}`, actor: admin.employee, body: { role: "owner" }, params: { memberId: admin.memberId } });
    expect(self.status).toBe(403);
    expect(await roleOf(admin.memberId)).toBe("admin");
    // Un administrateur ne coupe pas les sessions d'un autre administrateur ni du propriétaire.
    const otherAdmin = await join(owner, "admin", "admin2");
    expect((await h.call(memberSessionsRoute.DELETE, { method: "DELETE", path: `/api/business/team/members/${otherAdmin.memberId}/sessions`, actor: admin.employee, params: { memberId: otherAdmin.memberId } })).status).toBe(403);
  });

  it("11. révocation de l'employé : son accès au commerce est coupé aussitôt, son historique reste", async () => {
    const employee = await join(owner, "stock_manager", "revoque");
    expect((await createProduct(employee.employee)).status).toBe(201);
    const disabled = await h.call(memberAccessRoute.POST, { path: `/api/business/team/members/${employee.memberId}/access`, actor: owner, body: { disabled: true }, params: { memberId: employee.memberId } });
    expect(disabled.status, disabled.text).toBe(200);
    expect((await listProducts(employee.employee)).status).toBeGreaterThanOrEqual(400);
    expect((await createProduct(employee.employee)).status).toBeGreaterThanOrEqual(400);
    expect(await h.count("select count(*)::text n from member where id = $1", [employee.memberId])).toBe(1);
    // Une reconnexion ne rouvre pas l'accès.
    const again = await signInByUsername(employee.username);
    const reconnected: Actor = { ...employee.employee, cookie: cookiesOf(again) };
    expect((await h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor: reconnected, body: { businessId } })).status).toBeGreaterThanOrEqual(400);
  });

  it("12. révocation des sessions : l'employé est déconnecté partout, la trace est écrite", async () => {
    const employee = await join(owner, "cashier", "sessions");
    const second = await signInByUsername(employee.username);
    const secondDevice: Actor = { ...employee.employee, cookie: cookiesOf(second) };
    expect(await h.count("select count(*)::text n from session where user_id = $1", [employee.employee.userId])).toBe(2);
    const revoked = await h.call(memberSessionsRoute.DELETE, { method: "DELETE", path: `/api/business/team/members/${employee.memberId}/sessions`, actor: owner, params: { memberId: employee.memberId } });
    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body).toMatchObject({ sessions: 2, scope: "account" });
    expect(await h.count("select count(*)::text n from session where user_id = $1", [employee.employee.userId])).toBe(0);
    for (const actor of [employee.employee, secondDevice]) expect((await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor })).status).toBe(401);
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'team.sessions_revoked' and entity_id = $1", [employee.memberId])).toBe(1);
    // Le propriétaire ne ferme pas ses propres sessions par cette voie.
    const ownerMember = (await h.client.query<{ id: string }>("select id from member where user_id = $1 and organization_id = $2", [owner.userId, businessId])).rows[0]!.id;
    expect((await h.call(memberSessionsRoute.DELETE, { method: "DELETE", path: `/api/business/team/members/${ownerMember}/sessions`, actor: owner, params: { memberId: ownerMember } })).status).toBe(403);
  });

  it("13. code expiré : refusé à la vérification et à l'acceptation", async () => {
    const invite = await code(owner, "cashier");
    await h.client.query("update business_invite_code set created_at = $2, expires_at = $3 where id = $1", [invite.id, new Date(Date.now() - 8 * day), new Date(Date.now() - 1000)]);
    const checked = await check(invite.code);
    expect(checked.status).toBe(410);
    expect(checked.body.code).toBe("expired");
    const joined = await accept({ code: invite.code, name: "Trop tard", username: username("tard"), password: EMPLOYEE_PASSWORD });
    expect(joined.status).toBe(410);
    const listed = await h.call(teamCodesRoute.GET, { method: "GET", path: "/api/business/team/codes", actor: owner });
    expect(listed.body.codes.find((item: { id: string }) => item.id === invite.id)).toMatchObject({ state: "expired", canRevoke: false });
  });

  it("13 bis. code révoqué par le commerce : refusé ; révocation rejouée sans effet", async () => {
    const invite = await code(owner, "accountant");
    const revoke = () => h.call(revokeCodeRoute.POST, { path: `/api/business/team/codes/${invite.id}/revoke`, actor: owner, params: { codeId: invite.id } });
    expect((await revoke()).status).toBe(200);
    expect((await revoke()).body).toMatchObject({ replayed: true });
    const joined = await accept({ code: invite.code, name: "Comptable", username: username("comptable"), password: EMPLOYEE_PASSWORD });
    expect(joined.status).toBe(410);
    expect(joined.body.code).toBe("revoked");
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'team.invite_code_revoked' and entity_id = $1", [invite.id])).toBe(1);
  });

  it("14. code déjà utilisé : la seconde acceptation est refusée, même en parallèle", async () => {
    const used = await join(owner, "member", "deja");
    const again = await accept({ code: used.invite.code, name: "Second", username: username("second"), password: EMPLOYEE_PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_used");
    const revokeUsed = await h.call(revokeCodeRoute.POST, { path: `/api/business/team/codes/${used.invite.id}/revoke`, actor: owner, params: { codeId: used.invite.id } });
    expect(revokeUsed.status).toBe(409);
    const race = await code(owner, "member");
    const results = await Promise.all([
      accept({ code: race.code, name: "Course 1", username: username("course"), password: EMPLOYEE_PASSWORD }),
      accept({ code: race.code, name: "Course 2", username: username("course"), password: EMPLOYEE_PASSWORD }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'team.member_joined_by_code' and metadata->>'codeId' = $1", [race.id])).toBe(1);
  });

  it("15. tentative d'accès depuis une autre boutique : rien n'est visible ni modifiable chez A", async () => {
    const employee = await join(owner, "cashier", "isole");
    const invite = await code(owner, "cashier");
    // L'employé de A ne peut pas basculer sur B.
    expect((await h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor: employee.employee, body: { businessId: otherBusinessId } })).status).toBeGreaterThanOrEqual(400);
    // Le propriétaire de B ne voit, ne révoque et ne déconnecte rien chez A : même réponse qu'un identifiant inconnu.
    const listed = await h.call(teamCodesRoute.GET, { method: "GET", path: "/api/business/team/codes", actor: otherOwner });
    expect(listed.text).not.toContain(invite.id);
    const unknownId = randomUUID();
    const foreignRevoke = await h.call(revokeCodeRoute.POST, { path: `/api/business/team/codes/${invite.id}/revoke`, actor: otherOwner, params: { codeId: invite.id } });
    const unknownRevoke = await h.call(revokeCodeRoute.POST, { path: `/api/business/team/codes/${unknownId}/revoke`, actor: otherOwner, params: { codeId: unknownId } });
    expect(foreignRevoke.status).toBe(404);
    expect(foreignRevoke.body).toEqual(unknownRevoke.body);
    const foreignSessions = await h.call(memberSessionsRoute.DELETE, { method: "DELETE", path: `/api/business/team/members/${employee.memberId}/sessions`, actor: otherOwner, params: { memberId: employee.memberId } });
    const unknownSessions = await h.call(memberSessionsRoute.DELETE, { method: "DELETE", path: `/api/business/team/members/${unknownId}/sessions`, actor: otherOwner, params: { memberId: unknownId } });
    expect(foreignSessions.status).toBe(404);
    expect(foreignSessions.body).toEqual(unknownSessions.body);
    expect(await h.count("select count(*)::text n from business_invite_code where id = $1 and revoked_at is null", [invite.id])).toBe(1);
    expect(await h.count("select count(*)::text n from session where user_id = $1", [employee.employee.userId])).toBe(1);
    // Un code de A ne fait jamais entrer chez B, quoi que dise la requête.
    const joined = await accept({ code: invite.code, name: "Intrus", username: username("intrus"), password: EMPLOYEE_PASSWORD, businessId: otherBusinessId });
    expect(joined.body.businessId).toBe(businessId);
    expect(await h.count("select count(*)::text n from member where organization_id = $1", [otherBusinessId])).toBe(1);
  });

  it("commerce sans abonnement en cours : aucun code créé ni accepté", async () => {
    const lateOwner = await h.signUp("Propriétaire C", `proprio-c-${randomUUID().slice(0, 6)}@codes-equipe.test`);
    const lateBusiness = await h.createBusiness(lateOwner, "Boutique C");
    const invite = await code(lateOwner, "cashier");
    await h.client.query("update business_subscription set ends_at = $2, trial_ends_at = $2 where business_id = $1", [lateBusiness, new Date(Date.now() - 60_000)]);
    const created = await createCode(lateOwner, { role: "cashier" });
    expect(created.status).toBe(403);
    const checked = await check(invite.code);
    expect(checked.status).toBe(403);
    expect(checked.body.code).toBe("business_closed");
    const joined = await accept({ code: invite.code, name: "Employé C", username: username("c"), password: EMPLOYEE_PASSWORD });
    expect(joined.status).toBe(403);
    expect(await h.count("select count(*)::text n from member where organization_id = $1", [lateBusiness])).toBe(1);
  });
});
