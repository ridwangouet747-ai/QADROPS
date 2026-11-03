import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as checkoutRoute from "@/app/api/business/subscription/checkout/route";
import * as paymentStatusRoute from "@/app/api/business/subscription/payments/[attemptId]/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as cronSubscriptionsRoute from "@/app/api/cron/subscriptions/route";
import * as webhookRoute from "@/app/api/webhooks/geniuspay/route";
import { getBillingProvider } from "@/lib/billing";
import { reconcilePendingSubscriptionPayments } from "@/lib/domain/subscription-billing";
import { configureFakeGeniusPay, FakeGeniusPay, signedWebhook, unconfigureGeniusPay } from "./fake-geniuspay";
import { newKey, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 12, lot L1b : paiement des abonnements par GeniusPay, de bout en bout sur les vraies routes.
 * Base PGlite migrée, vraies sessions Better Auth, vraies permissions ; seul `fetch` est remplacé par un
 * GeniusPay simulé. Chaque test vérifie l'état FINAL de l'abonnement en base.
 */

const dayMs = 86_400_000;

describe("mission 12 : paiement d'abonnement GeniusPay (PGlite, vraie session, GeniusPay simulé)", () => {
  let h: HttpHarness;
  const fake = new FakeGeniusPay();

  beforeAll(async () => {
    h = await startHttpHarness();
    configureFakeGeniusPay();
    vi.stubGlobal("fetch", fake.fetch);
    await h.client.query(`insert into subscription_plan (id,code,name,price_xof,duration_days,active) values
      ('plan-mensuel','MENSUEL','Mensuel',15000,30,true),('plan-annuel','ANNUEL','Annuel',150000,365,true),
      ('plan-mini','MINI','Trop petit',100,30,true),('plan-retire','RETIRE','Retiré',9000,30,false)`);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    unconfigureGeniusPay();
    await h?.close();
  });

  let counter = 0;
  async function merchant() {
    counter += 1;
    const owner = await h.signUp(`Propriétaire ${counter}`, `owner${counter}@abonnement.test`);
    const businessId = await h.createBusiness(owner, `Commerce ${counter}`);
    return { owner, businessId };
  }

  const checkout = (actor: Actor, body: Record<string, unknown>) => h.call(checkoutRoute.POST, { path: "/api/business/subscription/checkout", actor, body });
  const status = (actor: Actor, attemptId: string) => h.call(paymentStatusRoute.GET, { path: `/api/business/subscription/payments/${attemptId}`, actor, params: { attemptId } });
  const webhook = (signed: { body: string; headers: Record<string, string> }) => h.call(webhookRoute.POST, { path: "/api/webhooks/geniuspay", body: signed.body, headers: signed.headers });

  async function referenceOf(attemptId: string) {
    return (await h.client.query<{ provider_reference: string }>("select provider_reference from subscription_payment where id=$1", [attemptId])).rows[0]!.provider_reference;
  }
  async function subscriptions(businessId: string) {
    return (await h.client.query<{ id: string; status: string; plan_id: string; starts_at: Date; ends_at: Date; origin: string }>(
      "select id,status,plan_id,starts_at,ends_at,origin from business_subscription where business_id=$1 order by created_at", [businessId])).rows;
  }
  async function attempt(attemptId: string) {
    return (await h.client.query<{ status: string; method: string; subscription_id: string | null; invoice_id: string }>("select status,method,subscription_id,invoice_id from subscription_payment where id=$1", [attemptId])).rows[0]!;
  }
  async function invoices(businessId: string) {
    return (await h.client.query<{ id: string; status: string; amount_xof: string; plan_code: string; period_starts_at: Date | null; period_ends_at: Date | null }>(
      "select id,status,amount_xof::text,plan_code,period_starts_at,period_ends_at from subscription_invoice where business_id=$1 order by created_at", [businessId])).rows;
  }
  async function openPayment(owner: Actor, planCode = "MENSUEL") {
    const response = await checkout(owner, { planCode, idempotencyKey: newKey("abo") });
    expect(response.status, response.text).toBe(201);
    return { attemptId: response.body.attemptId as string, reference: await referenceOf(response.body.attemptId), body: response.body };
  }
  async function pay(owner: Actor, planCode = "MENSUEL") {
    const opened = await openPayment(owner, planCode);
    fake.set(opened.reference, { status: "completed", payment_method: "wave" });
    expect((await webhook(signedWebhook("payment.success", opened.reference))).status).toBe(200);
    return opened;
  }

  it("sans configuration GeniusPay : paiement indisponible annoncé, aucun faux succès, webhook fermé", async () => {
    const { owner, businessId } = await merchant();
    unconfigureGeniusPay();
    try {
      const overview = await h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor: owner });
      expect(overview.body).toMatchObject({ onlinePayment: false, canPay: true });
      const refused = await checkout(owner, { planCode: "MENSUEL", idempotencyKey: newKey("abo") });
      expect(refused.status).toBe(503);
      expect(refused.body.code).toBe("billing_unavailable");
      expect((await webhook(signedWebhook("payment.success", "MTX-TEST999999"))).status).toBe(503);
      expect(await h.count("select count(*)::text n from subscription_invoice where business_id=$1", [businessId])).toBe(0);
    } finally { configureFakeGeniusPay(); }
    const overview = await h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor: owner });
    expect(overview.body.onlinePayment).toBe(true);
    // Seules les formules actives et payables (≥ 200 XOF) sont proposées, au prix de la base.
    expect(overview.body.plans.map((plan: { code: string; priceXof: string }) => `${plan.code}:${plan.priceXof}`)).toEqual(["MENSUEL:15000", "ANNUEL:150000"]);
  });

  it("caissier et administrateur (gérant) sont refusés ; rien n'est créé ni envoyé à GeniusPay", async () => {
    const { owner, businessId } = await merchant();
    const cashier = await h.addMember(owner, "Caissier", `caissier${counter}@abonnement.test`, "cashier");
    const admin = await h.addMember(owner, "Gérant", `gerant${counter}@abonnement.test`, "admin");
    const before = fake.countCreates();
    for (const actor of [cashier, admin]) {
      const refused = await checkout(actor, { planCode: "MENSUEL", idempotencyKey: newKey("abo") });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("forbidden");
    }
    expect(fake.countCreates()).toBe(before);
    expect(await h.count("select count(*)::text n from subscription_invoice where business_id=$1", [businessId])).toBe(0);
    // Le caissier ne lit pas non plus l'état d'un paiement du propriétaire.
    const opened = await openPayment(owner);
    expect((await status(cashier, opened.attemptId)).status).toBe(403);
  });

  it("succès : le prix vient de la base, la redirection seule n'active rien, seul le paiement relu chez GeniusPay active", async () => {
    const { owner, businessId } = await merchant();
    // Un montant ou un commerce glissés dans le corps sont ignorés.
    const response = await checkout(owner, { planCode: "MENSUEL", idempotencyKey: newKey("abo"), amountXof: "200", businessId: "autre", currency: "EUR" });
    expect(response.status, response.text).toBe(201);
    expect(response.body).toMatchObject({ status: "pending", amountXof: "15000", currency: "XOF", checkoutUrl: expect.stringMatching(/^https:\/\//) });
    const sent = fake.calls.filter((call) => call.method === "POST").at(-1)!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ amount: 15000, currency: "XOF", success_url: expect.stringContaining("/business/subscription/return?attempt="), metadata: { qadr_attempt: response.body.attemptId, qadr_invoice: response.body.invoiceId } });
    expect(JSON.stringify(sent.metadata)).not.toMatch(/@|Propriétaire|Commerce/);
    const reference = await referenceOf(response.body.attemptId);

    // Retour sur success_url alors que GeniusPay n'a rien confirmé : toujours « en vérification ».
    const pending = await status(owner, response.body.attemptId);
    expect(pending.body).toMatchObject({ status: "pending", verification: "fresh", subscription: null });
    expect(await subscriptions(businessId)).toEqual([]);

    fake.set(reference, { status: "completed", payment_method: "orange_money" });
    const hook = await webhook(signedWebhook("payment.success", reference));
    expect(hook.status).toBe(200);
    const [subscription] = await subscriptions(businessId);
    expect(subscription).toMatchObject({ status: "active", plan_id: "plan-mensuel", origin: "payment" });
    expect(Math.abs(subscription!.ends_at.getTime() - subscription!.starts_at.getTime() - 30 * dayMs)).toBeLessThan(1000);
    expect(await attempt(response.body.attemptId)).toMatchObject({ status: "confirmed", method: "orange_money", subscription_id: subscription!.id });
    expect((await invoices(businessId))[0]).toMatchObject({ status: "paid", amount_xof: "15000" });
    const confirmed = await status(owner, response.body.attemptId);
    expect(confirmed.body).toMatchObject({ status: "confirmed", verification: "final", checkoutUrl: null, subscription: { status: "active" } });
    expect(await h.count("select count(*)::text n from audit_event where business_id=$1 and event_type='subscription.payment_activated'", [businessId])).toBe(1);
  });

  it("webhook dupliqué, second événement et événement tardif : jamais deux prolongations, jamais de régression", async () => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    fake.set(opened.reference, { status: "completed" });
    const success = signedWebhook("payment.success", opened.reference);
    expect((await webhook(success)).status).toBe(200);
    const endsAt = (await subscriptions(businessId))[0]!.ends_at.getTime();

    const duplicate = await webhook(success);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ duplicate: true });
    expect((await webhook(signedWebhook("payment.success", opened.reference))).status).toBe(200);
    // Événement tardif et désordonné : GeniusPay annonce ensuite « expired » ou « failed ».
    fake.set(opened.reference, { status: "expired" });
    expect((await webhook(signedWebhook("payment.expired", opened.reference))).status).toBe(200);
    fake.set(opened.reference, { status: "failed" });
    expect((await webhook(signedWebhook("payment.failed", opened.reference))).status).toBe(200);
    expect((await webhook(signedWebhook("payment.initiated", opened.reference))).status).toBe(200);

    const rows = await subscriptions(businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ends_at.getTime()).toBe(endsAt);
    expect((await attempt(opened.attemptId)).status).toBe("confirmed");
    expect(await h.count("select count(*)::text n from audit_event where business_id=$1 and event_type='subscription.payment_activated'", [businessId])).toBe(1);
    expect(await h.count("select count(*)::text n from payment_provider_event where provider_reference=$1", [opened.reference])).toBe(5);
  });

  it("événements dans le désordre : un « failed » reçu alors que GeniusPay dit « completed » active (l'API fait foi), le « success » suivant ne prolonge pas", async () => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    fake.set(opened.reference, { status: "completed" });
    expect((await webhook(signedWebhook("payment.failed", opened.reference))).status).toBe(200);
    const first = await subscriptions(businessId);
    expect(first).toHaveLength(1);
    expect((await webhook(signedWebhook("payment.success", opened.reference))).status).toBe(200);
    expect((await subscriptions(businessId))[0]!.ends_at.getTime()).toBe(first[0]!.ends_at.getTime());
  });

  it.each([
    ["échec", "failed", "payment.failed", "failed"],
    ["annulation", "cancelled", "payment.cancelled", "canceled"],
    ["expiration", "expired", "payment.expired", "expired"],
  ])("%s : la tentative est close, rien n'est activé, un nouvel essai reste possible", async (_label, providerStatus, event, expected) => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    fake.set(opened.reference, { status: providerStatus });
    expect((await webhook(signedWebhook(event, opened.reference))).status).toBe(200);
    expect((await attempt(opened.attemptId)).status).toBe(expected);
    expect(await subscriptions(businessId)).toEqual([]);
    expect((await invoices(businessId))[0]!.status).toBe("open");
    const view = await status(owner, opened.attemptId);
    expect(view.body).toMatchObject({ status: expected, verification: "final", checkoutUrl: null });
    // Nouvel essai : nouvelle tentative sur la même facture, nouveau paiement GeniusPay.
    const retry = await openPayment(owner);
    expect(retry.attemptId).not.toBe(opened.attemptId);
    expect(retry.body.invoiceId).toBe(opened.body.invoiceId);
  });

  it("signature falsifiée, mauvais secret, horodatage périmé ou en-têtes absents : 401 et rien ne change", async () => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    fake.set(opened.reference, { status: "completed" });
    const genuine = signedWebhook("payment.success", opened.reference);
    const attacks = [
      { body: genuine.body.replace('"amount":15000', '"amount":150'), headers: genuine.headers },
      signedWebhook("payment.success", opened.reference, { secret: "whsec_secret_de_l_attaquant" }),
      signedWebhook("payment.success", opened.reference, { timestamp: Math.floor(Date.now() / 1000) - 600 }),
      signedWebhook("payment.success", opened.reference, { timestamp: Math.floor(Date.now() / 1000) + 600 }),
      { body: genuine.body, headers: { "content-type": "application/json" } },
    ];
    for (const attack of attacks) {
      const result = await webhook(attack);
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: "invalid_signature" });
    }
    expect(await subscriptions(businessId)).toEqual([]);
    expect((await attempt(opened.attemptId)).status).toBe("pending");
    expect(await h.count("select count(*)::text n from payment_provider_event where provider_reference=$1", [opened.reference])).toBe(0);
  });

  it.each([
    ["montant incorrect", { amount: 1500 }, "amount_mismatch"],
    ["montant non entier", { amount: "15000.50" }, "amount_mismatch"],
    ["devise incorrecte", { currency: "EUR" }, "currency_mismatch"],
    ["environnement différent", { environment: "live" }, "environment_mismatch"],
    ["métadonnées d'une autre facture", { metadata: { qadr_attempt: "00000000-0000-4000-8000-000000000000", qadr_invoice: "x" } }, "metadata_mismatch"],
  ])("%s chez GeniusPay : rien n'est activé, l'anomalie est journalisée sans contenu sensible", async (_label, change, outcome) => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    fake.set(opened.reference, { status: "completed", ...change });
    expect((await webhook(signedWebhook("payment.success", opened.reference))).status).toBe(200);
    expect(await subscriptions(businessId)).toEqual([]);
    expect((await attempt(opened.attemptId)).status).toBe("pending");
    expect((await invoices(businessId))[0]!.status).toBe("open");
    const [event] = (await h.client.query<{ outcome: string; business_id: string }>("select outcome,business_id from payment_provider_event where provider_reference=$1", [opened.reference])).rows;
    expect(event).toMatchObject({ outcome, business_id: businessId });
    const [anomaly] = (await h.client.query<{ metadata: Record<string, unknown> }>("select metadata from audit_event where business_id=$1 and event_type='subscription.payment_anomaly'", [businessId])).rows;
    expect(anomaly!.metadata).toMatchObject({ reason: outcome });
    expect(JSON.stringify(anomaly!.metadata)).not.toMatch(/1500|EUR|MTX-/);
  });

  it("référence inconnue : journalisée sans commerce, rien n'est modifié nulle part", async () => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    const before = await h.count("select count(*)::text n from business_subscription");
    const unknown = await webhook(signedWebhook("payment.success", "MTX-INCONNU0001"));
    expect(unknown.status).toBe(200);
    // Paiement réel chez GeniusPay mais sans lien avec Qadr Ops (métadonnées étrangères) : même traitement.
    fake.payments.set("MTX-ETRANGER01", { reference: "MTX-ETRANGER01", amount: 15000, currency: "XOF", status: "completed", environment: "sandbox", metadata: { order_id: "12345" }, payment_method: "wave" });
    expect((await webhook(signedWebhook("payment.success", "MTX-ETRANGER01"))).status).toBe(200);
    const rows = (await h.client.query<{ outcome: string; business_id: string | null; subscription_payment_id: string | null }>(
      "select outcome,business_id,subscription_payment_id from payment_provider_event where provider_reference in ('MTX-INCONNU0001','MTX-ETRANGER01')")).rows;
    expect(rows).toEqual([{ outcome: "unmatched", business_id: null, subscription_payment_id: null }, { outcome: "unmatched", business_id: null, subscription_payment_id: null }]);
    expect(await h.count("select count(*)::text n from business_subscription")).toBe(before);
    expect((await attempt(opened.attemptId)).status).toBe("pending");
    expect(await subscriptions(businessId)).toEqual([]);
  });

  it("idempotence : même clé = même paiement ; nouvelle clé pendant un paiement ouvert = même lien, un seul paiement GeniusPay", async () => {
    const { owner } = await merchant();
    const key = newKey("abo");
    const first = await checkout(owner, { planCode: "MENSUEL", idempotencyKey: key });
    const creates = fake.countCreates();
    const replay = await checkout(owner, { planCode: "MENSUEL", idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ attemptId: first.body.attemptId, replayed: true, checkoutUrl: first.body.checkoutUrl });
    const conflict = await checkout(owner, { planCode: "ANNUEL", idempotencyKey: key });
    expect(conflict.status).toBe(409);
    const reused = await checkout(owner, { planCode: "MENSUEL", idempotencyKey: newKey("abo") });
    expect(reused.status).toBe(200);
    expect(reused.body).toMatchObject({ attemptId: first.body.attemptId, reused: true });
    expect(fake.countCreates()).toBe(creates);
    // Autre formule tant qu'un paiement est ouvert : refus explicite plutôt que deux paiements possibles.
    const other = await checkout(owner, { planCode: "ANNUEL", idempotencyKey: newKey("abo") });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("payment_in_progress");
  });

  it("formule inconnue, retirée ou sous le minimum GeniusPay : refus sans appel au prestataire", async () => {
    const { owner } = await merchant();
    const creates = fake.countCreates();
    for (const [planCode, code] of [["INEXISTANT", "plan_not_found"], ["RETIRE", "plan_not_found"], ["MINI", "amount_too_low"]] as const) {
      const refused = await checkout(owner, { planCode, idempotencyKey: newKey("abo") });
      expect(refused.body.code).toBe(code);
    }
    expect((await checkout(owner, { planCode: "MENSUEL", idempotencyKey: "court" })).status).toBe(400);
    expect(fake.countCreates()).toBe(creates);
  });

  it("GeniusPay refuse ou ne répond pas à la création : 502 honnête, tentative close, un nouvel essai fonctionne", async () => {
    const { owner } = await merchant();
    for (const failure of ["refuse", "network"] as const) {
      fake.failNextCreate = failure;
      const key = newKey("abo");
      const refused = await checkout(owner, { planCode: "MENSUEL", idempotencyKey: key });
      expect(refused.status).toBe(502);
      expect(refused.body.code).toBe("provider_unavailable");
      expect((await checkout(owner, { planCode: "MENSUEL", idempotencyKey: key })).status).toBe(502);
    }
    expect((await checkout(owner, { planCode: "MENSUEL", idempotencyKey: newKey("abo") })).status).toBe(201);
  });

  it("renouvellement : la nouvelle période commence à la fin de la période en cours, sans jour perdu", async () => {
    const { owner, businessId } = await merchant();
    await pay(owner);
    const firstEnd = (await subscriptions(businessId))[0]!.ends_at.getTime();
    await pay(owner);
    const rows = await subscriptions(businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ends_at.getTime()).toBe(firstEnd + 30 * dayMs);
    const paid = await invoices(businessId);
    expect(paid.map((row) => row.status)).toEqual(["paid", "paid"]);
    expect(paid[1]!.period_starts_at!.getTime()).toBe(firstEnd);
    // Autre formule pendant une période en cours : elle commence à la fin de celle-ci.
    await pay(owner, "ANNUEL");
    const after = await subscriptions(businessId);
    expect(after).toHaveLength(2);
    expect(after[1]!.starts_at.getTime()).toBe(firstEnd + 30 * dayMs);
    expect(after[1]!.ends_at.getTime()).toBe(firstEnd + 30 * dayMs + 365 * dayMs);
  });

  it("commerce expiré : il peut payer et reprend ; commerce suspendu : paiement refusé", async () => {
    const expired = await merchant();
    await h.client.query("insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,origin) values ($1,$2,'plan-mensuel','expired',now()-interval '40 days',now()-interval '10 days','promotion')", [`old-${expired.businessId}`, expired.businessId]);
    await h.client.query("update business_profile set status='expired' where business_id=$1", [expired.businessId]);
    await pay(expired.owner);
    expect((await subscriptions(expired.businessId)).map((row) => row.status)).toEqual(["expired", "active"]);
    expect(await h.count("select count(*)::text n from business_profile where business_id=$1 and status='active'", [expired.businessId])).toBe(1);

    const suspended = await merchant();
    await h.client.query("update business_profile set status='suspended' where business_id=$1", [suspended.businessId]);
    const refused = await checkout(suspended.owner, { planCode: "MENSUEL", idempotencyKey: newKey("abo") });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("business_suspended");
  });

  it("rapprochement planifié : un paiement abouti dont le webhook s'est perdu est appliqué une seule fois", async () => {
    const { owner, businessId } = await merchant();
    const opened = await openPayment(owner);
    fake.set(opened.reference, { status: "completed" });
    const later = new Date(Date.now() + 11 * 60_000);
    const first = await reconcilePendingSubscriptionPayments(h.db, getBillingProvider(), { now: later });
    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect((await attempt(opened.attemptId)).status).toBe("confirmed");
    await reconcilePendingSubscriptionPayments(h.db, getBillingProvider(), { now: later });
    expect(await subscriptions(businessId)).toHaveLength(1);
    // GeniusPay injoignable : rien ne change, l'erreur est comptée, la tâche ne casse pas.
    const other = await merchant();
    const second = await openPayment(other.owner);
    fake.set(second.reference, { status: "completed" });
    fake.getUnavailable = true;
    try {
      // Page de retour pendant la panne : « vérification impossible », jamais un succès.
      expect((await status(other.owner, second.attemptId)).body).toMatchObject({ status: "pending", verification: "unavailable", subscription: null });
      const result = await reconcilePendingSubscriptionPayments(h.db, getBillingProvider(), { now: later });
      expect(result.errors).toBeGreaterThanOrEqual(1);
      expect((await attempt(second.attemptId)).status).toBe("pending");
      expect(await subscriptions(other.businessId)).toEqual([]);
    } finally { fake.getUnavailable = false; }
  });

  it("la tâche planifiée des abonnements fait aussi le rapprochement", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.CRON_SECRET = "secret-cron-de-test-du-harnais-0123456789";
    try {
      const ok = await h.call(cronSubscriptionsRoute.GET, { path: "/api/cron/subscriptions", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
      expect(ok.status).toBe(200);
      expect(ok.body.billing).toMatchObject({ available: true });
    } finally { delete env.CRON_SECRET; }
  });

  it("isolation : le propriétaire de A ne lit pas un paiement de B, réponse identique à un paiement inconnu", async () => {
    const a = await merchant();
    const b = await merchant();
    const opened = await openPayment(b.owner);
    const forB = await status(a.owner, opened.attemptId);
    const unknown = await status(a.owner, "00000000-0000-4000-8000-000000000000");
    expect(forB.status).toBe(404);
    expect(forB.text).toBe(unknown.text);
    expect(await h.count("select count(*)::text n from subscription_invoice where business_id=$1", [a.businessId])).toBe(0);
  });
});
