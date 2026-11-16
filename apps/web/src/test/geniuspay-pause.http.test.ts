import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as checkoutRoute from "@/app/api/business/subscription/checkout/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as webhookRoute from "@/app/api/webhooks/geniuspay/route";
import { getBillingProvider } from "@/lib/billing";
import { reconcilePendingSubscriptionPayments } from "@/lib/domain/subscription-billing";
import { configureFakeGeniusPay, FakeGeniusPay, signedWebhook, unconfigureGeniusPay } from "./fake-geniuspay";
import { newKey, startHttpHarness, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Pause de GeniusPay (2026-11-16, docs/billing-geniuspay.md § 12) : mode `manual_code`, valeur par défaut.
 * Les clés GeniusPay restent posées (comme sur Vercel) ; seul le mode change. Aucun paiement en ligne n'est
 * proposé ni appelé, le webhook garde sa signature, enregistre l'événement sans rien accorder, et le même
 * événement est retraité normalement après la réactivation. Toute requête sortante est comptée.
 */
describe("GeniusPay en pause (mode code manuel)", () => {
  let h: HttpHarness;
  const fake = new FakeGeniusPay();
  const outgoing = vi.fn(fake.fetch);
  const env = process.env as Record<string, string | undefined>;

  beforeAll(async () => {
    h = await startHttpHarness();
    configureFakeGeniusPay();
    delete env.QADR_COMMERCIAL_MODE; // défaut : manual_code
    vi.stubGlobal("fetch", outgoing);
    await h.client.query(`insert into subscription_plan (id,code,name,price_xof,duration_days,active) values ('plan-pause','PAUSE','Standard',5000,30,true)`);
  });
  afterEach(() => { delete env.QADR_COMMERCIAL_MODE; delete env.QADR_WHATSAPP_NUMBER; });
  afterAll(async () => {
    vi.unstubAllGlobals();
    unconfigureGeniusPay();
    await h?.close();
  });

  let counter = 0;
  async function merchant() {
    counter += 1;
    const owner = await h.signUp(`Pause ${counter}`, `pause${counter}@pause.test`);
    const businessId = await h.createBusiness(owner, `Boutique pause ${counter}`, "general", { access: "none" });
    return { owner, businessId };
  }
  const webhook = (signed: { body: string; headers: Record<string, string> }) => h.call(webhookRoute.POST, { path: "/api/webhooks/geniuspay", body: signed.body, headers: signed.headers });
  const events = async (eventId: string) => (await h.client.query<{ outcome: string; processed_at: Date | null; business_id: string | null }>(
    "select outcome, processed_at, business_id from payment_provider_event where provider='geniuspay' and event_id=$1", [eventId])).rows;

  it("le prestataire est déclaré en pause malgré des clés valides", () => {
    expect(getBillingProvider()).toEqual({ available: false, reason: "paused" });
  });

  it("aucun paiement en ligne : l’abonnement annonce le mode manuel, le paiement est refusé sans appel sortant", async () => {
    const { owner, businessId } = await merchant();
    outgoing.mockClear();
    const overview = await h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor: owner });
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ onlinePayment: false, commercialMode: "manual_code", contact: { whatsapp: null } });

    const refused = await h.call(checkoutRoute.POST, { path: "/api/business/subscription/checkout", actor: owner, body: { planCode: "PAUSE", idempotencyKey: newKey() } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("billing_paused");
    expect(outgoing).not.toHaveBeenCalled();
    const writes = await h.client.query("select 1 from subscription_payment where business_id=$1 union all select 1 from subscription_invoice where business_id=$1", [businessId]);
    expect(writes.rows).toHaveLength(0);
  });

  it("le numéro WhatsApp n’apparaît que s’il est configuré et valide", async () => {
    const { owner } = await merchant();
    env.QADR_WHATSAPP_NUMBER = "pas un numéro";
    expect((await h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor: owner })).body.contact).toEqual({ whatsapp: null });
    env.QADR_WHATSAPP_NUMBER = "+225 01 02 03 04 05";
    expect((await h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor: owner })).body.contact).toEqual({ whatsapp: "2250102030405" });
  });

  it("webhook signé : enregistré en pause, aucun droit, aucun appel sortant ; signature fausse : 401 sans trace", async () => {
    const { businessId } = await merchant();
    outgoing.mockClear();
    const eventId = `evt-pause-${counter}`;
    const signed = signedWebhook("payment.success", "MTX-PAUSE0001", { eventId });
    const first = await webhook(signed);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true, paused: true });
    // Même événement renvoyé : pas de doublon, pas de boucle.
    expect((await webhook(signed)).status).toBe(200);
    expect(await events(eventId)).toEqual([{ outcome: "paused", processed_at: null, business_id: null }]);
    expect(outgoing).not.toHaveBeenCalled();
    expect((await h.client.query("select 1 from business_subscription where business_id=$1 and status in ('active','trialing')", [businessId])).rows).toHaveLength(0);

    const forged = signedWebhook("payment.success", "MTX-PAUSE0002", { eventId: `evt-forge-${counter}`, secret: "whsec_secret_inconnu" });
    expect((await webhook(forged)).status).toBe(401);
    expect(await events(`evt-forge-${counter}`)).toEqual([]);
  });

  it("le rapprochement planifié ne contacte pas GeniusPay pendant la pause", async () => {
    outgoing.mockClear();
    const result = await reconcilePendingSubscriptionPayments(h.db, getBillingProvider());
    expect(result).toMatchObject({ available: false, checked: 0 });
    expect(outgoing).not.toHaveBeenCalled();
  });

  it("après réactivation (mode geniuspay), l’événement mis en pause est retraité normalement", async () => {
    const eventId = `evt-reprise-${counter}`;
    const signed = signedWebhook("payment.success", "MTX-PAUSE0003", { eventId });
    expect((await webhook(signed)).status).toBe(200);
    expect((await events(eventId))[0]).toMatchObject({ outcome: "paused", processed_at: null });

    env.QADR_COMMERCIAL_MODE = "geniuspay";
    expect((await webhook(signed)).status).toBe(200);
    const [row] = await events(eventId);
    // Référence inconnue de Qadr Ops : relue chez GeniusPay (simulé), rien n'est modifié, l'événement est clos.
    expect(row!.outcome).toBe("unmatched");
    expect(row!.processed_at).not.toBeNull();
  });
});
