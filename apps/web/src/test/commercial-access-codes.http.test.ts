import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as meRoute from "@/app/api/account/me/route";
import * as activeBusinessRoute from "@/app/api/account/active-business/route";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as dashboardRoute from "@/app/api/business/dashboard/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as redeemRoute from "@/app/api/business/subscription/promotion/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as teamCodesRoute from "@/app/api/business/team/codes/route";
import * as revokeRoute from "@/app/api/platform/access-codes/[codeId]/revoke/route";
import * as accessCodesRoute from "@/app/api/platform/access-codes/route";
import * as checkRoute from "@/app/api/public/access-codes/check/route";
import * as passRoute from "@/app/api/public/access-codes/pass/route";
import * as teamAcceptRoute from "@/app/api/public/team-codes/accept/route";
import * as teamCheckRoute from "@/app/api/public/team-codes/check/route";
import { addAccessDuration } from "@/lib/domain/commercial-codes";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Modèle commercial du 2026-11-16 (docs/commercial-access-codes.md) : codes d'accès commerciaux générés par le
 * Super Admin après un paiement vérifié à la main, saisis sur /redeem-code, consommés une seule fois à la création
 * du commerce ou au renouvellement. Mandat § 13.1 (cas 1 à 18) et § 13.2 (parcours client).
 * Vraies routes, vraies sessions Better Auth, base PGlite migrée ; seul `@/lib/db/client` est remplacé.
 */
const PASSWORD = "mot-de-passe-de-test-harnais";
const PLAN = "plan-standard-codes";
const OTHER_PLAN = "plan-autre-codes";
const day = 86_400_000;

describe("codes d'accès commerciaux (mandat § 13.1 et § 13.2)", () => {
  let h: HttpHarness;
  let admin: Actor;
  let counter = 0;
  let ipCounter = 0;

  beforeAll(async () => {
    h = await startHttpHarness();
    await h.client.query(`insert into subscription_plan (id,code,name,price_xof,duration_days,active) values ($1,'STANDARD','Standard',5000,30,true), ($2,'AUTRE','Autre formule',9000,30,true)`, [PLAN, OTHER_PLAN]);
    admin = await h.signUp("Super Admin", "admin@codes-commerciaux.test");
    await h.grantPlatformAdmin(admin);
  });
  beforeEach(async () => { await h.client.query("delete from rate_limit_bucket where true"); });
  afterEach(() => { delete process.env.QADR_ACCESS_CODE; });
  afterAll(async () => { await h?.close(); });

  /* ------------------------------------------------------------------ outils */

  const ip = () => `198.51.100.${(ipCounter++ % 250) + 1}`;
  async function generate(overrides: Record<string, unknown> = {}) {
    const result = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin,
      body: { planId: PLAN, duration: "m1", paymentVerified: true, ...overrides } });
    expect(result.status, result.text).toBe(201);
    return result.body as { codes: { id: string; code: string; hint: string }[]; duration: { unit: string; value: number }; activationDeadline: string; plan: { code: string } };
  }
  const oneCode = async (overrides: Record<string, unknown> = {}) => (await generate(overrides)).codes[0]!;
  const check = (code: unknown, options: { actor?: Actor; ipAddress?: string } = {}) => h.call(checkRoute.POST, {
    path: "/api/public/access-codes/check", actor: options.actor, body: { code }, headers: { "x-forwarded-for": options.ipAddress ?? ip() } });
  const passOf = (result: HttpResult) => result.headers.getSetCookie().map((value) => value.split(";")[0]!).find((pair) => pair.startsWith("qadr-access-pass=") && !pair.endsWith("="));
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";")[0]!).filter((pair) => !pair.endsWith("=")).join("; ");
  const withPass = (actor: Actor, pass: string | undefined) => ({ ...actor, cookie: pass ? `${actor.cookie}; ${pass}` : actor.cookie });

  /** Inscription par la vraie route Better Auth, avec ou sans laissez-passer. */
  async function signUpWith(label: string, pass?: string, password = PASSWORD) {
    await h.client.query("delete from rate_limit_bucket where key like 'auth.%'");
    counter += 1;
    const email = `${label}-${counter}@codes-commerciaux.test`;
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, ...(pass ? { cookie: pass } : {}) },
      body: JSON.stringify({ name: `Commerçant ${label}`, email, password }),
    }));
    const text = await response.text();
    const userId = response.ok ? (JSON.parse(text) as { user: { id: string } }).user.id : "";
    return { status: response.status, text, email, actor: { name: `Commerçant ${label}`, email, userId, cookie: cookiesOf(response) } as Actor };
  }
  const newcomer = async (label: string) => (await signUpWith(label)).actor;
  const createBusiness = (actor: Actor, pass?: string, extra: Record<string, unknown> = {}) => h.call(accountBusinessesRoute.POST, {
    path: "/api/account/businesses", actor: withPass(actor, pass), body: { name: `Boutique ${actor.name}`, activity: "general", ...extra } });
  const redeem = (actor: Actor, code: unknown) => h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor, body: { code } });
  const codeRow = async (id: string) => (await h.client.query<{ consumed_at: Date | null; consumed_business_id: string | null; revoked_at: Date | null; subscription_id: string | null }>(
    "select consumed_at, consumed_business_id, revoked_at, subscription_id from commercial_access_code where id = $1", [id])).rows[0]!;
  const subscriptionsOf = async (businessId: string) => (await h.client.query<{ id: string; status: string; plan_id: string; starts_at: Date; ends_at: Date; origin: string }>(
    "select id, status, plan_id, starts_at, ends_at, origin from business_subscription where business_id = $1 order by created_at", [businessId])).rows;
  const lifecycleOf = async (actor: Actor) =>
    ((await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor })).body.businesses as { active: boolean; lifecycle: string }[]).find((item) => item.active)?.lifecycle;

  /** Commerçant dont le commerce vient d'être ouvert par un code (sans le droit d'essai du harnais). */
  async function openedWithCode(label: string, duration = "m1") {
    const code = await oneCode({ duration });
    const owner = await newcomer(label);
    const businessId = await h.createBusiness(owner, `Boutique ${label}`, "general", { access: "none" });
    const activated = await redeem(owner, code.code);
    expect(activated.status, activated.text).toBe(200);
    return { owner, businessId, code, activation: activated.body as { startsAt: string; endsAt: string; status: string } };
  }

  /* ------------------------------------------------------------------ § 13.1 */

  it("1. génération d'un code Standard : format QADR, montré une fois, seule l'empreinte est en base, audit", async () => {
    const generated = await generate({ note: "Paiement Wave vérifié" });
    const { code, id, hint } = generated.codes[0]!;
    expect(code).toMatch(/^QADR(-[2-9A-HJKMNP-Z]{4}){4}$/);
    expect(hint).toBe(code.replace(/-/g, "").slice(-4));
    expect(generated.plan.code).toBe("STANDARD");
    const stored = (await h.client.query<{ row: string }>("select row_to_json(c)::text as row from commercial_access_code c where id = $1", [id])).rows[0]!.row;
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(code.replace(/-/g, ""));
    expect(stored).toContain(hint);
    // La liste ne rend jamais le code en clair.
    const listed = await h.call(accessCodesRoute.GET, { method: "GET", path: "/api/platform/access-codes", actor: admin });
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(code);
    expect(listed.body.items.find((item: { id: string }) => item.id === id)).toMatchObject({ state: "unused", hint, planCode: "STANDARD", note: "Paiement Wave vérifié" });
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'platform.commercial_code_created' and entity_id = $1", [id])).toBe(1);
  });

  it("1 bis. aucune génération sans paiement vérifié, sans formule connue, ni par un compte qui n'est pas Super Admin", async () => {
    const unpaid = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId: PLAN, duration: "m1" } });
    expect(unpaid.status).toBe(400);
    const unknownPlan = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId: "inconnue", duration: "m1", paymentVerified: true } });
    expect(unknownPlan.status).toBe(404);
    const merchant = await newcomer("intrus");
    const forbidden = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: merchant, body: { planId: PLAN, duration: "m1", paymentVerified: true } });
    expect(forbidden.status).toBe(404);
    expect((await h.call(accessCodesRoute.GET, { method: "GET", path: "/api/platform/access-codes", actor: merchant })).status).toBe(404);
    expect((await h.call(accessCodesRoute.GET, { method: "GET", path: "/api/platform/access-codes", actor: null })).status).toBe(401);
  });

  it("2. unicité : un lot de 20 codes donne 20 codes et 20 empreintes distincts", async () => {
    const generated = await generate({ quantity: 20 });
    expect(generated.codes).toHaveLength(20);
    expect(new Set(generated.codes.map((item) => item.code)).size).toBe(20);
    const hashes = await h.client.query<{ code_hash: string }>("select code_hash from commercial_access_code where id = any($1::text[])", [generated.codes.map((item) => item.id)]);
    expect(new Set(hashes.rows.map((row) => row.code_hash)).size).toBe(20);
    const tooMany = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId: PLAN, duration: "m1", paymentVerified: true, quantity: 21 } });
    expect(tooMany.status).toBe(400);
  });

  it("3. chaque code porte la durée choisie (7 j, 21 j, 1 mois, 3 mois, personnalisée)", async () => {
    expect((await generate({ duration: "d7" })).duration).toEqual({ unit: "day", value: 7 });
    expect((await generate({ duration: "d21" })).duration).toEqual({ unit: "day", value: 21 });
    expect((await generate({ duration: "m1" })).duration).toEqual({ unit: "month", value: 1 });
    expect((await generate({ duration: "m3" })).duration).toEqual({ unit: "month", value: 3 });
    const custom = await generate({ duration: "custom", customDays: 45 });
    expect(custom.duration).toEqual({ unit: "day", value: 45 });
    const stored = (await h.client.query<{ duration_unit: string; duration_value: number }>("select duration_unit, duration_value from commercial_access_code where id = $1", [custom.codes[0]!.id])).rows[0]!;
    expect(stored).toEqual({ duration_unit: "day", duration_value: 45 });
    const missingDays = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId: PLAN, duration: "custom", paymentVerified: true } });
    expect(missingDays.status).toBe(400);
    // La vérification publique annonce la durée et la date limite d'activation.
    const checked = await check(custom.codes[0]!.code);
    expect(checked.body).toMatchObject({ valid: true, duration: { unit: "day", value: 45 }, plan: { code: "STANDARD" } });
    expect(checked.body.activationDeadline).toBe(custom.activationDeadline);
  });

  it("4. code inutilisé : la vérification l'accepte, pose le laissez-passer et ne consomme rien", async () => {
    const code = await oneCode();
    const checked = await check(` ${code.code.toLowerCase()} `);
    expect(checked.status, checked.text).toBe(200);
    expect(checked.headers.get("cache-control")).toBe("no-store");
    expect(checked.body).toMatchObject({ valid: true, next: "register", businessName: null, plan: { code: "STANDARD" } });
    expect(checked.text).not.toContain(code.code);
    const pass = passOf(checked);
    expect(pass).toBeTruthy();
    expect(pass).not.toContain(code.code);
    expect(checked.headers.getSetCookie()[0]).toMatch(/HttpOnly/);
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    const status = await h.call(passRoute.GET, { method: "GET", path: "/api/public/access-codes/pass", headers: { cookie: pass! } });
    expect(status.body).toMatchObject({ pass: { plan: { code: "STANDARD" } } });
  });

  it("5. code expiré (date limite d'activation dépassée) : refusé, rien n'est consommé", async () => {
    const code = await oneCode();
    await h.client.query("update commercial_access_code set created_at = $2, activation_deadline = $3 where id = $1", [code.id, new Date(Date.now() - 2 * day), new Date(Date.now() - 1000)]);
    const checked = await check(code.code);
    expect(checked.status).toBe(410);
    expect(checked.body.code).toBe("expired");
    expect(passOf(checked)).toBeUndefined();
    const { owner } = await openedWithCode("expire-proprio");
    const refused = await redeem(owner, code.code);
    expect(refused.status).toBe(410);
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    const listed = await h.call(accessCodesRoute.GET, { method: "GET", path: "/api/platform/access-codes?state=expired", actor: admin });
    expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(code.id);
  });

  it("6. code révoqué : motif exigé, refus partout ensuite, révocation rejouée sans effet, code utilisé non révocable", async () => {
    const code = await oneCode();
    const revoke = (codeId: string, reason: string) => h.call(revokeRoute.POST, { path: `/api/platform/access-codes/${codeId}/revoke`, actor: admin, body: { reason }, params: { codeId } });
    expect((await revoke(code.id, "non")).status).toBe(400);
    const revoked = await revoke(code.id, "Paiement annulé par le client");
    expect(revoked.status, revoked.text).toBe(200);
    expect((await revoke(code.id, "Paiement annulé par le client")).body).toMatchObject({ replayed: true });
    const checked = await check(code.code);
    expect(checked.status).toBe(410);
    expect(checked.body.code).toBe("revoked");
    const { owner } = await openedWithCode("revoque-proprio");
    expect((await redeem(owner, code.code)).body.code).toBe("revoked");
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'platform.commercial_code_revoked' and entity_id = $1", [code.id])).toBe(1);
    // Un code déjà utilisé ne se révoque plus : le droit accordé reste traçable.
    const used = await openedWithCode("revoque-utilise");
    const late = await revoke(used.code.id, "Erreur de saisie");
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("already_used");
    // Un commerçant ne peut pas révoquer.
    expect((await h.call(revokeRoute.POST, { path: `/api/platform/access-codes/${code.id}/revoke`, actor: owner, body: { reason: "Tentative du commerçant" }, params: { codeId: code.id } })).status).toBe(404);
  });

  it("7. code déjà utilisé : refusé à la vérification et sur un autre commerce", async () => {
    const used = await openedWithCode("deja-utilise");
    const checked = await check(used.code.code);
    expect(checked.status).toBe(409);
    expect(checked.body.code).toBe("already_used");
    const other = await openedWithCode("autre-commerce");
    const refused = await redeem(other.owner, used.code.code);
    expect(refused.status).toBe(409);
    expect((await codeRow(used.code.id)).consumed_business_id).toBe(used.businessId);
  });

  it("8. code invalide : même réponse générique pour un code inconnu, mal formé ou vide, et refus tracé", async () => {
    const before = await h.count("select count(*)::text n from audit_event where event_type = 'platform.commercial_code_rejected'");
    const unknown = await check("QADR-2345-6789-ABCD-EFGH");
    const malformed = await check("QADR-1234");
    const empty = await check("");
    for (const result of [unknown, malformed, empty]) {
      expect(result.status).toBe(404);
      expect(result.body).toEqual(unknown.body);
      expect(passOf(result)).toBeUndefined();
    }
    expect(unknown.body.code).toBe("invalid");
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'platform.commercial_code_rejected'")).toBe(before + 3);
    // La trace ne contient jamais le code saisi.
    const traces = await h.client.query<{ m: string }>("select metadata::text as m from audit_event where event_type = 'platform.commercial_code_rejected'");
    for (const row of traces.rows) expect(row.m).not.toContain("2345-6789");
  });

  it("8 bis. essais répétés : 10 échecs par adresse en 15 minutes, puis 429 même pour un bon code", async () => {
    const address = "203.0.113.77";
    for (let attempt = 0; attempt < 10; attempt += 1) expect((await check("QADR-2345-6789-ABCD-EFGH", { ipAddress: address })).status).toBe(404);
    const good = await oneCode();
    const blocked = await check(good.code, { ipAddress: address });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("rate_limited");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await check(good.code)).status).toBe(200);
  });

  it("9. code soumis plusieurs fois : vérifications répétées sans effet, application rejouée sans double période", async () => {
    const code = await oneCode();
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await check(code.code)).status).toBe(200);
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    const owner = await newcomer("rejeu");
    const businessId = await h.createBusiness(owner, "Boutique rejeu", "general", { access: "none" });
    const first = await redeem(owner, code.code);
    const second = await redeem(owner, code.code);
    expect(first.status, first.text).toBe(200);
    expect(second.status, second.text).toBe(200);
    expect(first.body.replayed).toBe(false);
    expect(second.body.replayed).toBe(true);
    expect(second.body.endsAt).toBe(first.body.endsAt);
    expect(await subscriptionsOf(businessId)).toHaveLength(1);
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'subscription.commercial_code_activated' and business_id = $1", [businessId])).toBe(1);
  });

  it("10. double consommation concurrente : un seul commerce obtient le code", async () => {
    const code = await oneCode();
    const first = await newcomer("course-a");
    const second = await newcomer("course-b");
    const firstBusiness = await h.createBusiness(first, "Boutique course A", "general", { access: "none" });
    const secondBusiness = await h.createBusiness(second, "Boutique course B", "general", { access: "none" });
    const results = await Promise.all([redeem(first, code.code), redeem(second, code.code)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results[0]!.status === 200 ? firstBusiness : secondBusiness;
    const loser = winner === firstBusiness ? secondBusiness : firstBusiness;
    expect((await codeRow(code.id)).consumed_business_id).toBe(winner);
    expect(await subscriptionsOf(winner)).toHaveLength(1);
    expect(await subscriptionsOf(loser)).toHaveLength(0);
  });

  it("10 bis. concurrence à la création : deux comptes avec le laissez-passer du même code, un seul commerce est ouvert", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    const code = await oneCode();
    const pass = passOf(await check(code.code))!;
    const first = await signUpWith("creation-a", pass);
    const second = await signUpWith("creation-b", pass);
    expect([first.status, second.status]).toEqual([200, 200]);
    const [a, b] = await Promise.all([createBusiness(first.actor, pass), createBusiness(second.actor, pass)]);
    const outcomes = [a, b].map((result) => result.status === 201 ? result.body.business.access?.status : `http-${result.status}`).sort();
    expect(outcomes[0]).toBe("activated");
    expect(["failed", "http-403"]).toContain(outcomes[1]);
    expect(await h.count("select count(*)::text n from business_subscription where plan_id = $1 and business_id in (select consumed_business_id from commercial_access_code where id = $2)", [PLAN, code.id])).toBe(1);
  });

  it("11. activation réussie : code → laissez-passer → compte → commerce ouvert pour la durée du code", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    const code = await oneCode({ duration: "m1" });
    const checked = await check(code.code);
    const pass = passOf(checked)!;
    const signedUp = await signUpWith("parcours", pass);
    expect(signedUp.status, signedUp.text).toBe(200);
    const before = Date.now();
    const created = await createBusiness(signedUp.actor, pass);
    expect(created.status, created.text).toBe(201);
    expect(created.body.business.access).toMatchObject({ status: "activated", replayed: false });
    // Le laissez-passer, devenu inutile, est effacé.
    expect(created.headers.getSetCookie().some((value) => /^qadr-access-pass=;.*Max-Age=0/.test(value))).toBe(true);
    const businessId = created.body.business.id as string;
    const [subscription] = await subscriptionsOf(businessId);
    expect(subscription).toMatchObject({ status: "active", plan_id: PLAN, origin: "access_code" });
    expect(subscription!.starts_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(subscription!.ends_at.toISOString()).toBe(addAccessDuration(subscription!.starts_at, "month", 1).toISOString());
    expect(created.body.business.access.endsAt).toBe(subscription!.ends_at.toISOString());
    expect((await codeRow(code.id))).toMatchObject({ consumed_business_id: businessId, subscription_id: subscription!.id });
    expect(await lifecycleOf(signedUp.actor)).toBe("active");
    expect((await h.call(dashboardRoute.GET, { method: "GET", path: "/api/business/dashboard", actor: signedUp.actor })).status).toBe(200);
  });

  it("12. échec de création de compte : rien n'est consommé et le code reste utilisable ; aucun compte sans code", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    const code = await oneCode();
    const pass = passOf(await check(code.code))!;
    const weak = await signUpWith("faible", pass, "court");
    expect(weak.status).toBeGreaterThanOrEqual(400);
    expect(await h.count("select count(*)::text n from \"user\" where email = $1", [weak.email])).toBe(0);
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    expect((await check(code.code)).status).toBe(200);
    // Sans laissez-passer, ou avec un laissez-passer falsifié : refus générique, aucun compte.
    const without = await signUpWith("sans-code");
    expect(without.status).toBe(422);
    // Même refus générique que pour une adresse déjà inscrite (mission 16) : rien ne révèle la cause.
    expect(without.text).toContain("SIGN_UP_FAILED");
    const forged = await signUpWith("faux-pass", `qadr-access-pass=${Buffer.from(JSON.stringify({ v: 1, c: code.id, e: Date.now() + 60_000 })).toString("base64url")}.signature`);
    expect(forged.status).toBe(422);
    expect(await h.count("select count(*)::text n from \"user\" where email in ($1, $2)", [without.email, forged.email])).toBe(0);
    // Le laissez-passer d'un code révoqué entre-temps n'ouvre plus rien.
    await h.call(revokeRoute.POST, { path: `/api/platform/access-codes/${code.id}/revoke`, actor: admin, body: { reason: "Paiement remboursé" }, params: { codeId: code.id } });
    expect((await signUpWith("apres-revocation", pass)).status).toBe(422);
  });

  it("12 bis. compte créé mais commerce refusé : sans code valide, aucun commerce ne s'ouvre", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    const code = await oneCode();
    const pass = passOf(await check(code.code))!;
    const signedUp = await signUpWith("commerce-refuse", pass);
    expect(signedUp.status).toBe(200);
    const without = await createBusiness(signedUp.actor);
    expect(without.status).toBe(403);
    expect(without.body.code).toBe("access_code_required");
    expect(await h.count("select count(*)::text n from member where user_id = $1", [signedUp.actor.userId])).toBe(0);
    expect((await codeRow(code.id)).consumed_at).toBeNull();
  });

  it("13. reprise après erreur réseau : la même création renvoyée ne crée ni second commerce ni seconde période", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    const code = await oneCode();
    const pass = passOf(await check(code.code))!;
    const signedUp = await signUpWith("reprise", pass);
    const creationKey = `creation-${randomUUID()}`;
    const first = await createBusiness(signedUp.actor, pass, { creationKey });
    expect(first.status, first.text).toBe(201);
    // La réponse est perdue : le navigateur renvoie exactement la même requête.
    const retry = await createBusiness(signedUp.actor, pass, { creationKey });
    expect(retry.status, retry.text).toBe(201);
    expect(retry.body.business).toMatchObject({ id: first.body.business.id, replayed: true });
    expect(await h.count("select count(*)::text n from member where user_id = $1", [signedUp.actor.userId])).toBe(1);
    expect(await subscriptionsOf(first.body.business.id)).toHaveLength(1);
    // La page de l'abonnement montre l'accès ouvert : rien à ressaisir.
    expect(await lifecycleOf(signedUp.actor)).toBe("active");
  });

  it("14. renouvellement d'un abonnement en cours : la durée s'ajoute à la date de fin actuelle", async () => {
    const opened = await openedWithCode("renouvelle-actif", "m1");
    const renewal = await oneCode({ duration: "d7" });
    const checked = await check(renewal.code, { actor: opened.owner });
    expect(checked.body).toMatchObject({ valid: true, next: "renew", businessName: "Boutique renouvelle-actif" });
    const renewed = await redeem(opened.owner, renewal.code);
    expect(renewed.status, renewed.text).toBe(200);
    expect(renewed.body.endsAt).toBe(addAccessDuration(new Date(opened.activation.endsAt), "day", 7).toISOString());
    expect(renewed.body.startsAt).toBe(opened.activation.startsAt);
    const rows = await subscriptionsOf(opened.businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ends_at.toISOString()).toBe(renewed.body.endsAt);
    // Code d'une autre formule pendant une période en cours : refus, rien n'est consommé.
    const other = await oneCode({ planId: OTHER_PLAN });
    const refused = await redeem(opened.owner, other.code);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("incompatible_subscription");
    expect((await codeRow(other.id)).consumed_at).toBeNull();
  });

  it("15. renouvellement d'un abonnement échu : la nouvelle période commence au moment de l'activation", async () => {
    const opened = await openedWithCode("renouvelle-echu", "m1");
    const lapsed = new Date(Date.now() - 3 * day);
    await h.client.query("update business_subscription set status = 'expired', ends_at = $2 where business_id = $1", [opened.businessId, lapsed]);
    await h.client.query("update business_profile set status = 'expired' where business_id = $1", [opened.businessId]);
    expect(await lifecycleOf(opened.owner)).toBe("expired");
    const renewal = await oneCode({ duration: "m3" });
    const before = Date.now();
    const renewed = await redeem(opened.owner, renewal.code);
    expect(renewed.status, renewed.text).toBe(200);
    const startsAt = new Date(renewed.body.startsAt);
    expect(startsAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(startsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(renewed.body.endsAt).toBe(addAccessDuration(startsAt, "month", 3).toISOString());
    expect(await lifecycleOf(opened.owner)).toBe("active");
    expect((await h.call(productsRoute.POST, { path: "/api/business/products", actor: opened.owner, body: { name: "Ciment 50 kg", salePriceXof: "6500" } })).status).toBe(201);
  });

  it("16. date d'expiration exacte, mois du calendrier compris (fin de mois)", async () => {
    // Durée en jours : à la milliseconde près depuis l'activation.
    const days = await openedWithCode("date-jours", "d21");
    expect(days.activation.endsAt).toBe(addAccessDuration(new Date(days.activation.startsAt), "day", 21).toISOString());
    expect(new Date(days.activation.endsAt).getTime() - new Date(days.activation.startsAt).getTime()).toBe(21 * day);
    // Prolongation d'une période qui finit un 31 janvier : 1 mois → dernier jour de février.
    const months = await openedWithCode("date-mois", "m1");
    const january31 = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 31, 9, 30));
    await h.client.query("update business_subscription set ends_at = $2 where business_id = $1", [months.businessId, january31]);
    const renewal = await oneCode({ duration: "m1" });
    const renewed = await redeem(months.owner, renewal.code);
    const year = january31.getUTCFullYear();
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    expect(renewed.body.endsAt).toBe(new Date(Date.UTC(year, 1, leap ? 29 : 28, 9, 30)).toISOString());
    const summary = await h.call(subscriptionRoute.GET, { method: "GET", path: "/api/business/subscription", actor: months.owner });
    expect(summary.status).toBe(200);
    expect(summary.text).toContain(renewed.body.endsAt);
  });

  it("17. un code employé est refusé sur les routes commerciales", async () => {
    const opened = await openedWithCode("code-employe");
    const invite = await h.call(teamCodesRoute.POST, { path: "/api/business/team/codes", actor: opened.owner, body: { role: "cashier" } });
    expect(invite.status, invite.text).toBe(201);
    const employeeCode = invite.body.code as string;
    expect(employeeCode).toMatch(/^EQP-/);
    const checked = await check(employeeCode);
    expect(checked.status).toBe(422);
    expect(checked.body.code).toBe("invite_code");
    expect(passOf(checked)).toBeUndefined();
    const redeemed = await redeem(opened.owner, employeeCode);
    expect(redeemed.status).toBe(422);
    expect(redeemed.body.code).toBe("invite_code");
    expect(await h.count("select count(*)::text n from business_invite_code where id = $1 and consumed_at is null", [invite.body.id])).toBe(1);
  });

  it("18. un code commercial est refusé sur les routes employé", async () => {
    const code = await oneCode();
    const checked = await h.call(teamCheckRoute.POST, { path: "/api/public/team-codes/check", body: { code: code.code }, headers: { "x-forwarded-for": ip() } });
    expect(checked.status).toBe(422);
    expect(checked.body.code).toBe("commercial_code");
    const accepted = await h.call(teamAcceptRoute.POST, { path: "/api/public/team-codes/accept", headers: { "x-forwarded-for": ip() },
      body: { code: code.code, name: "Employé pressé", username: "employe.presse", password: "mot-de-passe-employe" } });
    expect(accepted.status).toBe(422);
    expect(accepted.body.code).toBe("commercial_code");
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    expect(await h.count("select count(*)::text n from \"user\" where username = 'employe.presse'")).toBe(0);
  });

  /* ------------------------------------------------------------------ § 13.2 */

  it("parcours § 13.2 : compte existant, reconnexion après activation, accès après expiration", async () => {
    process.env.QADR_ACCESS_CODE = "required";
    // Compte existant sans commerce : la vérification oriente vers l'ouverture du commerce.
    const firstCode = await oneCode();
    const pass = passOf(await check(firstCode.code))!;
    const signedUp = await signUpWith("existant", pass);
    const code = await oneCode({ duration: "d7" });
    const checked = await check(code.code, { actor: signedUp.actor });
    expect(checked.body.next).toBe("onboarding");
    const created = await createBusiness(signedUp.actor, passOf(checked));
    expect(created.body.business.access.status).toBe("activated");
    // Le premier laissez-passer n'a pas été consommé : son code reste disponible.
    expect((await codeRow(firstCode.id)).consumed_at).toBeNull();
    expect((await codeRow(code.id)).consumed_business_id).toBe(created.body.business.id);

    // Reconnexion : nouvelle session, le commerce et son accès sont retrouvés.
    const again = await h.signIn(signedUp.actor);
    const businessId = created.body.business.id as string;
    expect((await h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor: again, body: { businessId } })).status).toBe(200);
    expect(await lifecycleOf(again)).toBe("active");

    // Après la date de fin : lecture ouverte, écriture refusée, données conservées.
    await h.client.query("update business_subscription set ends_at = $2 where business_id = $1", [created.body.business.id, new Date(Date.now() - 60_000)]);
    expect(await lifecycleOf(again)).toBe("expired");
    expect((await h.call(dashboardRoute.GET, { method: "GET", path: "/api/business/dashboard", actor: again })).status).toBe(200);
    const refused = await h.call(productsRoute.POST, { path: "/api/business/products", actor: again, body: { name: "Clou 10 cm", salePriceXof: "50" } });
    expect(refused.status).toBe(403);
  });

  it("parcours § 13.2 : un caissier ne peut pas appliquer un code ; le commerce visé est toujours celui de la session", async () => {
    const opened = await openedWithCode("roles");
    const cashier = await h.addMember(opened.owner, "Caissière", `caissiere-${randomUUID().slice(0, 6)}@codes-commerciaux.test`, "cashier");
    const code = await oneCode();
    const checked = await check(code.code, { actor: cashier });
    expect(checked.body.next).toBe("onboarding");
    const refused = await redeem(cashier, code.code);
    expect(refused.status).toBe(403);
    expect((await codeRow(code.id)).consumed_at).toBeNull();
    // Un identifiant de commerce glissé dans le corps n'est jamais lu.
    const other = await openedWithCode("cible");
    const forced = await h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor: opened.owner, body: { code: code.code, businessId: other.businessId } });
    expect(forced.status).toBe(200);
    expect((await codeRow(code.id)).consumed_business_id).toBe(opened.businessId);
  });
});
