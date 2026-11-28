import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as redeemRoute from "@/app/api/business/subscription/promotion/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as accessCodesRoute from "@/app/api/platform/access-codes/route";
import * as lifetimeRoute from "@/app/api/platform/businesses/[businessId]/lifetime/route";
import * as businessRoute from "@/app/api/platform/businesses/[businessId]/route";
import * as planRoute from "@/app/api/platform/plans/[planId]/route";
import * as plansRoute from "@/app/api/platform/plans/route";
import * as platformSubscriptionRoute from "@/app/api/platform/subscriptions/[subscriptionId]/route";
import { commercialAccess } from "@/lib/domain/commercial-access";
import { assertBusinessOperational } from "@/lib/domain/operation-guard";
import { expireDueSubscriptions } from "@/lib/domain/subscription-lifecycle";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Accès à vie (2026-11-27, docs/lifetime-access.md) : formule « Accès à vie », code d'accès à vie, attribution directe
 * par la plateforme, règle d'accès unique. Vraies routes, vraies sessions, base PGlite migrée (0029 comprise).
 * L'horloge est contrôlée en passant `now` aux fonctions du domaine (des années plus tard).
 */
const FIXED_PLAN = "plan-fixe-vie";
const LIFETIME_PLAN = "plan-a-vie";
const year = 365 * 86_400_000;

describe("accès à vie (formules, codes, attribution, règle d'accès)", () => {
  let h: HttpHarness;
  let admin: Actor;
  let counter = 0;

  beforeAll(async () => {
    h = await startHttpHarness();
    await h.client.query(`insert into subscription_plan (id,code,name,price_xof,duration_kind,duration_days,active) values
      ($1,'FIXE_VIE','Standard 30 jours',5000,'fixed_duration',30,true), ($2,'A_VIE','Qadr à vie',150000,'lifetime',null,true)`, [FIXED_PLAN, LIFETIME_PLAN]);
    admin = await h.signUp("Super Admin", "admin@acces-a-vie.test");
    await h.grantPlatformAdmin(admin);
  });
  beforeEach(async () => { await h.client.query("delete from rate_limit_bucket where true"); });
  afterAll(async () => { await h?.close(); });

  /* ------------------------------------------------------------------ outils */

  async function merchant(label: string, access: "trial" | "none" = "none") {
    counter += 1;
    const owner = await h.signUp(`Commerçant ${label}`, `${label}-${counter}@acces-a-vie.test`);
    const businessId = await h.createBusiness(owner, `Boutique ${label} ${counter}`, "general", { access });
    return { owner, businessId };
  }
  async function code(planId: string, duration: string) {
    const result = await h.call(accessCodesRoute.POST, { path: "/api/platform/access-codes", actor: admin, body: { planId, duration, paymentVerified: true } });
    return result;
  }
  const redeem = (actor: Actor, raw: unknown, extra: Record<string, unknown> = {}) =>
    h.call(redeemRoute.POST, { path: "/api/business/subscription/promotion", actor, body: { code: raw, ...extra } });
  const grant = (businessId: string, body: Record<string, unknown>, actor = admin) => h.call(lifetimeRoute.POST, {
    path: `/api/platform/businesses/${businessId}/lifetime`, actor, params: { businessId }, body });
  const grantBody = (overrides: Record<string, unknown> = {}) => ({ planId: LIFETIME_PLAN, reason: "Partenaire fondateur", confirm: true, ...overrides });
  const overview = async (actor: Actor) => (await h.call(subscriptionRoute.GET, { method: "GET", path: "/api/business/subscription", actor })).body;
  const subscriptionsOf = async (businessId: string) => (await h.client.query<{ id: string; status: string; duration_kind: string; ends_at: Date | null; plan_id: string; origin: string }>(
    "select id, status, duration_kind, ends_at, plan_id, origin from business_subscription where business_id = $1 order by created_at", [businessId])).rows;
  /** Écriture commerciale contrôlée à une date donnée (assertBusinessOperational, même règle que toutes les écritures). */
  const canWriteAt = async (businessId: string, now: Date) => {
    try { await h.db.transaction((tx) => assertBusinessOperational(tx, businessId, now)); return true; } catch { return false; }
  };

  /* ------------------------------------------------------------------ formules */

  it("formules : type de durée validé, jamais de durée fictive pour un accès à vie", async () => {
    const lifetimeWithDays = await h.call(plansRoute.POST, { path: "/api/platform/plans", actor: admin, body: {
      code: "VIE_JOURS", name: "Vie avec jours", priceXof: "1000", durationKind: "lifetime", durationDays: 999999,
      features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } } });
    expect(lifetimeWithDays.status).toBe(400); // 999999 dépasse le maximum de jours : refusé avant même la règle du type
    const lifetimeDays = await h.call(plansRoute.POST, { path: "/api/platform/plans", actor: admin, body: {
      code: "VIE_30", name: "Vie 30", priceXof: "1000", durationKind: "lifetime", durationDays: 30,
      features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } } });
    expect(lifetimeDays.status).toBe(422);
    expect(lifetimeDays.body.code).toBe("lifetime_without_days");
    const fixedWithoutDays = await h.call(plansRoute.POST, { path: "/api/platform/plans", actor: admin, body: {
      code: "FIXE_SANS", name: "Fixe sans jours", priceXof: "1000", durationKind: "fixed_duration",
      features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } } });
    expect(fixedWithoutDays.status).toBe(422);
    expect(fixedWithoutDays.body.code).toBe("duration_required");
    const created = await h.call(plansRoute.POST, { path: "/api/platform/plans", actor: admin, body: {
      code: "VIE_OK", name: "Vie publiée", priceXof: "200000", durationKind: "lifetime", active: false,
      features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } } });
    expect(created.status, created.text).toBe(201);
    const listed = await h.call(plansRoute.GET, { method: "GET", path: "/api/platform/plans", actor: admin });
    expect(listed.body.find((plan: { code: string }) => plan.code === "VIE_OK")).toMatchObject({ durationKind: "lifetime", durationDays: null });
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'platform.plan_created' and metadata->>'durationKind' = 'lifetime' and entity_id = $1", [created.body.id])).toBe(1);
    // La base refuse aussi tout état ambigu, même hors de l'application.
    await expect(h.client.query("insert into subscription_plan (id,code,name,price_xof,duration_kind,duration_days) values ('x1','AMBIGU','Ambigu',0,'lifetime',30)")).rejects.toThrow();
    await expect(h.client.query("insert into subscription_plan (id,code,name,price_xof,duration_kind,duration_days) values ('x2','AMBIGU2','Ambigu',0,'fixed_duration',null)")).rejects.toThrow();
  });

  it("base : un abonnement à durée déterminée exige une fin ; un accès à vie n'en a aucune ; une date nulle seule ne vaut jamais « à vie »", async () => {
    const { businessId } = await merchant("contraintes");
    const now = new Date();
    await expect(h.client.query(`insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,duration_kind) values ($1,$2,$3,'active',$4,null,'fixed_duration')`,
      [randomUUID(), businessId, FIXED_PLAN, now])).rejects.toThrow();
    await expect(h.client.query(`insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,duration_kind) values ($1,$2,$3,'active',$4,$5,'lifetime')`,
      [randomUUID(), businessId, LIFETIME_PLAN, now, new Date(now.getTime() + year)])).rejects.toThrow();
    // Un accès à vie n'est jamais « en essai » ni « expiré ».
    await expect(h.client.query(`insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,duration_kind) values ($1,$2,$3,'trialing',$4,null,'lifetime')`,
      [randomUUID(), businessId, LIFETIME_PLAN, now])).rejects.toThrow();
  });

  /* ------------------------------------------------------------------ scénarios 1 à 3 */

  it("scénarios 1 et 2 : un abonnement à durée déterminée et un code de 3 mois fonctionnent comme avant (et expirent)", async () => {
    const { owner, businessId } = await merchant("fixe");
    const generated = await code(FIXED_PLAN, "m3");
    expect(generated.status, generated.text).toBe(201);
    const activated = await redeem(owner, generated.body.codes[0].code);
    expect(activated.status, activated.text).toBe(200);
    expect(activated.body).toMatchObject({ lifetime: false, status: "active", duration: { unit: "month", value: 3 } });
    expect(activated.body.endsAt).not.toBeNull();
    const [row] = await subscriptionsOf(businessId);
    expect(row).toMatchObject({ duration_kind: "fixed_duration" });
    const endsAt = new Date(activated.body.endsAt);
    expect(await canWriteAt(businessId, new Date(endsAt.getTime() - 60_000))).toBe(true);
    expect(await canWriteAt(businessId, new Date(endsAt.getTime() + 60_000))).toBe(false);
    expect((await commercialAccess(h.db, businessId, new Date(endsAt.getTime() + 60_000))).lifecycle).toBe("expired");
  });

  it("codes : le type d'accès suit la formule enregistrée (refus croisés), la date limite d'activation reste distincte", async () => {
    expect((await code(LIFETIME_PLAN, "m1")).body.code).toBe("lifetime_plan_requires_lifetime");
    expect((await code(FIXED_PLAN, "lifetime")).body.code).toBe("lifetime_requires_lifetime_plan");
    const generated = await code(LIFETIME_PLAN, "lifetime");
    expect(generated.status, generated.text).toBe(201);
    expect(generated.body.duration).toEqual({ unit: "lifetime", value: null });
    expect(new Date(generated.body.activationDeadline).getTime()).toBeGreaterThan(Date.now());
    const stored = (await h.client.query<{ duration_unit: string; duration_value: number | null }>("select duration_unit, duration_value from commercial_access_code where id = $1", [generated.body.codes[0].id])).rows[0]!;
    expect(stored).toEqual({ duration_unit: "lifetime", duration_value: null });
  });

  it("scénario 3 : un code à vie rend l'accès permanent — aucune date de fin, toujours ouvert 20 ans plus tard, ignoré par le cron d'expiration", async () => {
    const { owner, businessId } = await merchant("code-vie");
    const generated = await code(LIFETIME_PLAN, "lifetime");
    // Champs du navigateur ignorés : seul le code compte.
    const activated = await redeem(owner, generated.body.codes[0].code, { isLifetime: false, expiresAt: "2027-01-01T00:00:00Z", durationDays: 999999, status: "expired" });
    expect(activated.status, activated.text).toBe(200);
    expect(activated.body).toMatchObject({ lifetime: true, endsAt: null, status: "active", duration: { unit: "lifetime", value: null } });
    const [row] = await subscriptionsOf(businessId);
    expect(row).toMatchObject({ duration_kind: "lifetime", ends_at: null, status: "active", origin: "access_code" });
    const shown = await overview(owner);
    expect(shown.lifecycle).toBe("active");
    expect(shown.subscription).toMatchObject({ lifetime: true, durationKind: "lifetime", endsAt: null, remainingDays: null, inForce: true, planName: "Qadr à vie" });
    const later = new Date(Date.now() + 20 * year);
    expect(await canWriteAt(businessId, later)).toBe(true);
    expect((await commercialAccess(h.db, businessId, later)).lifecycle).toBe("active");
    await expireDueSubscriptions(h.db, later);
    expect((await subscriptionsOf(businessId))[0]).toMatchObject({ status: "active", duration_kind: "lifetime" });
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'subscription.commercial_code_activated' and business_id = $1 and metadata->'after'->>'durationKind' = 'lifetime'", [businessId])).toBe(1);
  });

  /* ------------------------------------------------------------------ scénarios 4 et 5 */

  it("scénario 4 : abonnement fixe puis attribution directe à vie — accès permanent, période fixe conservée intacte, audit de l'administrateur", async () => {
    const { owner, businessId } = await merchant("attribution", "trial");
    const before = await subscriptionsOf(businessId);
    expect(before).toHaveLength(1);
    const granted = await grant(businessId, grantBody());
    expect(granted.status, granted.text).toBe(201);
    expect(granted.body).toMatchObject({ durationKind: "lifetime", endsAt: null, status: "active" });
    const after = await subscriptionsOf(businessId);
    expect(after).toHaveLength(2);
    // La période d'essai n'est ni supprimée ni modifiée.
    expect(after[0]).toMatchObject({ id: before[0]!.id, status: before[0]!.status, duration_kind: "fixed_duration" });
    expect(after[0]!.ends_at!.getTime()).toBe(before[0]!.ends_at!.getTime());
    expect(after[1]).toMatchObject({ duration_kind: "lifetime", ends_at: null, origin: "manual" });
    const shown = await overview(owner);
    expect(shown.subscription).toMatchObject({ lifetime: true, endsAt: null });
    expect(await canWriteAt(businessId, new Date(Date.now() + 10 * year))).toBe(true);
    const audit = (await h.client.query<{ actor_user_id: string; metadata: { reason: string; before: { subscriptionId: string } } }>(
      "select actor_user_id, metadata from audit_event where event_type = 'subscription.lifetime_granted' and business_id = $1", [businessId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: admin.userId, metadata: { reason: "Partenaire fondateur", before: { subscriptionId: before[0]!.id } } });
    // Un second accès à vie est refusé ; prolonger un accès à vie aussi.
    expect((await grant(businessId, grantBody())).body.code).toBe("lifetime_active");
    const extend = await h.call(platformSubscriptionRoute.PATCH, { path: `/api/platform/subscriptions/${after[1]!.id}`, actor: admin,
      params: { subscriptionId: after[1]!.id }, body: { action: "extend", days: 30, reason: "Essai de prolongation" } });
    expect(extend.body.code).toBe("lifetime_not_extendable");
  });

  it("scénario 5 : un code à durée déterminée ne raccourcit pas un accès à vie (409, le code reste utilisable)", async () => {
    const { owner, businessId } = await merchant("vie-puis-fixe");
    expect((await grant(businessId, grantBody())).status).toBe(201);
    const fixed = await code(FIXED_PLAN, "d7");
    const refused = await redeem(owner, fixed.body.codes[0].code);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("lifetime_active");
    const stored = (await h.client.query<{ consumed_at: Date | null }>("select consumed_at from commercial_access_code where id = $1", [fixed.body.codes[0].id])).rows[0]!;
    expect(stored.consumed_at).toBeNull();
    expect(await subscriptionsOf(businessId)).toHaveLength(1);
    const another = await code(LIFETIME_PLAN, "lifetime");
    expect((await redeem(owner, another.body.codes[0].code)).body.code).toBe("lifetime_active");
  });

  /* ------------------------------------------------------------------ scénarios 6 et 7 */

  it("scénario 6 : modifier ou retirer une formule à vie ne change aucun droit acquis", async () => {
    const created = await h.call(plansRoute.POST, { path: "/api/platform/plans", actor: admin, body: {
      code: "VIE_ARCHIVE", name: "Vie à archiver", priceXof: "100000", durationKind: "lifetime", active: true,
      features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null } } });
    const planId = created.body.id as string;
    const { owner, businessId } = await merchant("archive");
    expect((await grant(businessId, grantBody({ planId }))).status).toBe(201);
    const renamed = await h.call(planRoute.PATCH, { path: `/api/platform/plans/${planId}`, actor: admin, params: { planId }, body: { name: "Vie renommée", priceXof: "1" } });
    expect(renamed.status, renamed.text).toBe(200);
    const archived = await h.call(planRoute.PATCH, { path: `/api/platform/plans/${planId}`, actor: admin, params: { planId }, body: { active: false } });
    expect(archived.status).toBe(200);
    // Même un changement de type de la formule ne touche pas l'abonnement déjà accordé.
    const retyped = await h.call(planRoute.PATCH, { path: `/api/platform/plans/${planId}`, actor: admin, params: { planId }, body: { durationKind: "fixed_duration", durationDays: 30 } });
    expect(retyped.status, retyped.text).toBe(200);
    expect((await subscriptionsOf(businessId))[0]).toMatchObject({ duration_kind: "lifetime", ends_at: null, status: "active" });
    expect((await overview(owner)).subscription).toMatchObject({ lifetime: true, planName: "Vie renommée" });
    expect(await canWriteAt(businessId, new Date(Date.now() + 5 * year))).toBe(true);
    // Une formule retirée ne s'attribue plus.
    const { businessId: other } = await merchant("archive-autre");
    await h.call(planRoute.PATCH, { path: `/api/platform/plans/${planId}`, actor: admin, params: { planId }, body: { durationKind: "lifetime" } });
    expect((await grant(other, grantBody({ planId }))).body.code).toBe("plan_inactive");
  });

  it("scénario 7 : révoquer un accès à vie bloque l'accès ; suspendre puis réactiver le commerce le rétablit", async () => {
    const { owner, businessId } = await merchant("revocation");
    const granted = await grant(businessId, grantBody());
    const subscriptionId = granted.body.subscriptionId as string;
    // Suspension du commerce : bloqué ; réactivation : l'accès à vie reprend (pas d'échéance à vérifier).
    const suspended = await h.call(businessRoute.PATCH, { path: `/api/platform/businesses/${businessId}`, actor: admin, params: { businessId }, body: { status: "suspended", reason: "Contrôle de compte" } });
    expect(suspended.status, suspended.text).toBe(200);
    expect(await canWriteAt(businessId, new Date())).toBe(false);
    expect((await grant(businessId, grantBody())).status).toBe(409);
    const resumed = await h.call(businessRoute.PATCH, { path: `/api/platform/businesses/${businessId}`, actor: admin, params: { businessId }, body: { status: "active", reason: "Contrôle terminé" } });
    expect(resumed.status).toBe(200);
    expect((await subscriptionsOf(businessId))[0]).toMatchObject({ status: "active", duration_kind: "lifetime" });
    expect(await canWriteAt(businessId, new Date(Date.now() + 3 * year))).toBe(true);
    // Révocation : terminale, auditée, l'espace se ferme.
    const revoked = await h.call(platformSubscriptionRoute.PATCH, { path: `/api/platform/subscriptions/${subscriptionId}`, actor: admin, params: { subscriptionId }, body: { action: "cancel", reason: "Fin du partenariat" } });
    expect(revoked.status, revoked.text).toBe(200);
    expect((await commercialAccess(h.db, businessId)).open).toBe(false);
    expect((await overview(owner)).lifecycle).not.toBe("active");
    expect(await h.count("select count(*)::text n from audit_event where event_type = 'platform.lifetime_access_revoked' and entity_id = $1", [subscriptionId])).toBe(1);
  });

  /* ------------------------------------------------------------------ sécurité et concurrence */

  it("sécurité : ni le propriétaire, ni un employé, ni un compte sans droit ne peuvent s'accorder un accès à vie ; corps falsifiés refusés", async () => {
    const { owner, businessId } = await merchant("securite", "trial");
    const cashier = await h.addMember(owner, "Caissier", `caissier-${counter}@acces-a-vie.test`, "cashier");
    const stranger = await h.signUp("Inconnu", `inconnu-${counter}@acces-a-vie.test`);
    for (const actor of [owner, cashier, stranger]) {
      const refused = await grant(businessId, grantBody(), actor);
      expect(refused.status).toBe(404);
    }
    // Confirmation absente, type imposé par le corps, champs inconnus : tout est refusé, rien n'est écrit.
    expect((await grant(businessId, grantBody({ confirm: false }))).status).toBe(400);
    expect((await grant(businessId, grantBody({ durationKind: "lifetime", endsAt: null }))).status).toBe(400);
    expect((await grant(businessId, grantBody({ planId: FIXED_PLAN }))).body.code).toBe("lifetime_requires_lifetime_plan");
    expect((await grant("commerce-inconnu", grantBody())).status).toBe(404);
    expect(await h.count("select count(*)::text n from business_subscription where business_id = $1 and duration_kind = 'lifetime'", [businessId])).toBe(0);
    // Le commerçant ne peut pas non plus créer de commerce « à vie » par la route de création.
    const created = await h.call(accountBusinessesRoute.POST, { path: "/api/account/businesses", actor: stranger, body: { name: "Tentative", activity: "general", isLifetime: true, durationDays: 999999, status: "active" } });
    expect([201, 400, 403]).toContain(created.status);
    if (created.status === 201) expect(await h.count("select count(*)::text n from business_subscription where business_id = $1 and duration_kind = 'lifetime'", [created.body.business.id])).toBe(0);
  });

  it("concurrence : deux attributions simultanées donnent un seul accès à vie (une réussite, un 409)", async () => {
    const { businessId } = await merchant("concurrence");
    const results = await Promise.all([grant(businessId, grantBody()), grant(businessId, grantBody({ reason: "Second envoi simultané" }))]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(await h.count("select count(*)::text n from business_subscription where business_id = $1 and duration_kind = 'lifetime'", [businessId])).toBe(1);
  });

  it("concurrence : code à vie et attribution simultanés sur le même commerce → un seul accès à vie", async () => {
    const { owner, businessId } = await merchant("course-code");
    const generated = await code(LIFETIME_PLAN, "lifetime");
    const [redeemed, granted] = await Promise.all([redeem(owner, generated.body.codes[0].code), grant(businessId, grantBody())]);
    expect([redeemed.status, granted.status].filter((status) => status === 200 || status === 201)).toHaveLength(1);
    expect(await h.count("select count(*)::text n from business_subscription where business_id = $1 and duration_kind = 'lifetime'", [businessId])).toBe(1);
  });
});
