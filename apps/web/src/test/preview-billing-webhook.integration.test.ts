import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as checkoutRoute from "@/app/api/business/subscription/checkout/route";
import * as paymentStatusRoute from "@/app/api/business/subscription/payments/[attemptId]/route";
import * as webhookRoute from "@/app/api/webhooks/geniuspay/route";
import { getPreviewDatabase } from "@/lib/preview/database";
import { FAKE_GENIUSPAY_ENV, FakeGeniusPay, signedWebhook } from "./fake-geniuspay";

/**
 * Parcours de l'essai sandbox par tunnel, en aperçu local (`npm run preview`) : la caisse d'abonnement
 * (identité de démonstration) et le webhook doivent partager la base de démonstration en mémoire, et Neon
 * ne doit jamais être joint même si `next dev` a rechargé une DATABASE_URL depuis `.env.local`.
 * Aucun module n'est remplacé : seul GeniusPay est simulé (fetch).
 */
describe("aperçu local : webhook GeniusPay sur la base de démonstration", () => {
  const fake = new FakeGeniusPay();
  const base = "http://localhost:3001";

  beforeAll(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("QADR_PREVIEW_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://qadr:faux@neon.invalid/qadr");
    vi.stubEnv("BETTER_AUTH_URL", base);
    for (const [name, value] of Object.entries(FAKE_GENIUSPAY_ENV)) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", fake.fetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const webhook = (signed: { body: string; headers: Record<string, string> }) =>
    webhookRoute.POST(new Request(`${base}/api/webhooks/geniuspay`, { method: "POST", headers: signed.headers, body: signed.body }));
  // Le client PGlite sous-jacent de drizzle (`$client`) n'est pas exposé par le type de la base de démonstration.
  const query = async <T,>(text: string, params: unknown[] = []) =>
    (await (await getPreviewDatabase() as unknown as { $client: PGlite }).$client.query<T>(text, params)).rows;

  it("enregistre l'événement de test dans la base de démonstration (ignoré, 200)", async () => {
    const signed = signedWebhook("webhook.test", "TEST-REF-1", { eventId: "evt_apercu_test" });
    const response = await webhook(signed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(await query<{ outcome: string }>("select outcome from payment_provider_event where event_id=$1", ["evt_apercu_test"])).toEqual([{ outcome: "ignored" }]);
  }, 60_000);

  it("paiement réussi : activation unique après relecture, rejeu sans effet, signature toujours exigée", async () => {
    const opened = await checkoutRoute.POST(new Request(`${base}/api/business/subscription/checkout`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planCode: "PRO", idempotencyKey: "apercu-tunnel-0001" }),
    }));
    const body = await opened.json() as { attemptId: string };
    expect(opened.status, JSON.stringify(body)).toBe(201);
    const [attempt] = await query<{ provider_reference: string; business_id: string }>("select provider_reference,business_id from subscription_payment where id=$1", [body.attemptId]);
    expect(fake.calls.at(-1)?.body).toMatchObject({ success_url: expect.stringContaining(`${base}/business/subscription/return`) });

    const forged = signedWebhook("payment.success", attempt!.provider_reference, { secret: "whsec_mauvais_secret_qadr" });
    expect((await webhook(forged)).status).toBe(401);

    fake.set(attempt!.provider_reference, { status: "completed", payment_method: "wave" });
    const success = signedWebhook("payment.success", attempt!.provider_reference, { eventId: "evt_apercu_succes" });
    expect((await webhook(success)).status).toBe(200);
    const afterFirst = await query<{ status: string; subscription_id: string | null }>("select status,subscription_id from subscription_payment where id=$1", [body.attemptId]);
    expect(afterFirst).toEqual([{ status: "confirmed", subscription_id: expect.any(String) }]);
    const periods = () => query<{ id: string; ends_at: Date }>("select id,ends_at from business_subscription where business_id=$1 order by created_at", [attempt!.business_id]);
    const before = await periods();

    const replay = await webhook(success);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect((await webhook(signedWebhook("payment.success", attempt!.provider_reference, { eventId: "evt_apercu_succes_bis" }))).status).toBe(200);
    const status = await paymentStatusRoute.GET(new Request(`${base}/api/business/subscription/payments/${body.attemptId}`), { params: Promise.resolve({ attemptId: body.attemptId }) });
    expect(await status.json()).toMatchObject({ status: "confirmed" });
    expect(await periods()).toEqual(before);
    expect(await query<{ status: string }>("select i.status from subscription_invoice i join subscription_payment p on p.invoice_id=i.id where p.id=$1", [body.attemptId])).toEqual([{ status: "paid" }]);
  }, 60_000);
});
