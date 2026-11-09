import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getBillingProvider } from ".";
import {
  GeniusPayProvider, parseProviderAmount, readGeniusPayConfig, subscriptionMethodFromGeniusPay, verifyGeniusPayWebhookSignature, type FetchLike,
} from "./geniuspay";
import { BillingProviderError } from "./provider";

// Valeurs de test évidentes : préfixes documentés suivis d'un suffixe factice, jamais une vraie clé.
const SECRET = "whsec_test_unitaire_qadr";
const config = { apiKey: "pk_sandbox_test_unitaire", apiSecret: "sk_sandbox_test_unitaire", webhookSecret: SECRET, baseUrl: "https://geniuspay.test.invalid/api/v1/merchant", environment: "sandbox" as const };
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

function sign(body: string, timestamp: number, secret = SECRET) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
function headers(values: Record<string, string>) { return new Headers(values); }

describe("signature des webhooks GeniusPay", () => {
  const now = new Date("2026-11-03T10:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = '{"id":"evt-1","event":"payment.success","data":{"reference":"MTX-A1B2C3D4E5","amount":15000}}';

  it("accepte une signature valide calculée sur le corps brut", () => {
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, ts), "x-webhook-timestamp": String(ts) }), now)).toEqual({ ok: true, timestamp: ts });
    // Hexadécimal en majuscules : même octets, accepté.
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, ts).toUpperCase(), "x-webhook-timestamp": String(ts) }), now).ok).toBe(true);
  });

  it("refuse un corps falsifié, même d'un seul caractère, ou ré-encodé", () => {
    const signature = sign(body, ts);
    const tampered = body.replace("15000", "15001");
    expect(verifyGeniusPayWebhookSignature(SECRET, tampered, headers({ "x-webhook-signature": signature, "x-webhook-timestamp": String(ts) }), now)).toEqual({ ok: false, reason: "bad_signature" });
    const reencoded = JSON.stringify(JSON.parse(body), null, 1);
    expect(verifyGeniusPayWebhookSignature(SECRET, reencoded, headers({ "x-webhook-signature": signature, "x-webhook-timestamp": String(ts) }), now).ok).toBe(false);
  });

  it("refuse une signature faite avec un autre secret, ou un horodatage substitué", () => {
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, ts, "whsec_autre_secret_x"), "x-webhook-timestamp": String(ts) }), now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, ts), "x-webhook-timestamp": String(ts + 1) }), now)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuse un horodatage trop ancien ou trop loin dans le futur (tolérance 300 s)", () => {
    for (const offset of [-301, 301, -3600]) {
      const at = ts + offset;
      expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, at), "x-webhook-timestamp": String(at) }), now)).toEqual({ ok: false, reason: "stale" });
    }
    for (const offset of [-300, 300]) {
      const at = ts + offset;
      expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, at), "x-webhook-timestamp": String(at) }), now).ok).toBe(true);
    }
  });

  it("refuse les en-têtes absents ou mal formés, et tout sans secret configuré", () => {
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-timestamp": String(ts) }), now)).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, ts) }), now)).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": sign(body, ts), "x-webhook-timestamp": "2026-11-03T10:00:00Z" }), now)).toEqual({ ok: false, reason: "bad_timestamp" });
    // Préfixe ou base64 : refusés, mais le format est reconnu pour le journal de l'essai sandbox.
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": `sha256=${sign(body, ts)}`, "x-webhook-timestamp": String(ts) }), now))
      .toEqual({ ok: false, reason: "bad_signature", variant: "hex+horodatage_point_corps+corps_brut+prefixe_sha256" });
    expect(verifyGeniusPayWebhookSignature(SECRET, body, headers({ "x-webhook-signature": Buffer.from(sign(body, ts), "hex").toString("base64"), "x-webhook-timestamp": String(ts) }), now))
      .toEqual({ ok: false, reason: "bad_signature", variant: "base64+horodatage_point_corps+corps_brut" });
    expect(verifyGeniusPayWebhookSignature(undefined, body, headers({ "x-webhook-signature": sign(body, ts), "x-webhook-timestamp": String(ts) }), now)).toEqual({ ok: false, reason: "not_configured" });
    expect(verifyGeniusPayWebhookSignature("", body, headers({ "x-webhook-signature": sign(body, ts, ""), "x-webhook-timestamp": String(ts) }), now)).toEqual({ ok: false, reason: "not_configured" });
  });

  it("diagnostic des formats ambigus de la documentation : toujours refusés, seulement nommés", () => {
    const hmac = (message: string) => createHmac("sha256", SECRET).update(message).digest("hex");
    const check = (rawBody: string, signature: string, timestamp: string) => verifyGeniusPayWebhookSignature(SECRET, rawBody, headers({ "x-webhook-signature": signature, "x-webhook-timestamp": timestamp }), now);
    // Horodatage en millisecondes.
    const ms = String(now.getTime());
    expect(check(body, hmac(`${ms}.${body}`), ms)).toEqual({ ok: false, reason: "bad_timestamp", variant: "hex+horodatage_point_corps+corps_brut+horodatage_ms" });
    // Corps seul, sans horodatage.
    expect(check(body, hmac(body), String(ts))).toEqual({ ok: false, reason: "bad_signature", variant: "hex+corps_seul+corps_brut" });
    // Signature calculée sur un JSON compact alors que le corps reçu est indenté.
    expect(check(JSON.stringify(JSON.parse(body), null, 2), sign(body, ts), String(ts))).toEqual({ ok: false, reason: "bad_signature", variant: "hex+horodatage_point_corps+json_reencode" });
    // `json_encode` de PHP : barres obliques et caractères non ASCII échappés.
    const accented = '{"id":"evt-2","event":"payment.success","data":{"reference":"MTX-A1B2C3D4E5","description":"Abonnement Équipe","url":"https://x.test/a"}}';
    const php = accented.replace(/\//g, "\\/").replace("É", "\\u00c9");
    expect(check(accented, hmac(`${ts}.${php}`), String(ts))).toEqual({ ok: false, reason: "bad_signature", variant: "hex+horodatage_point_corps+json_php" });
    // Mauvais secret : aucun format ne correspond, rien n'est nommé.
    expect(check(body, sign(body, ts, "whsec_autre_secret_x"), String(ts))).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("configuration GeniusPay", () => {
  const base = { GENIUSPAY_API_KEY: "pk_sandbox_test_unitaire", GENIUSPAY_API_SECRET: "sk_sandbox_test_unitaire", GENIUSPAY_WEBHOOK_SECRET: SECRET };

  it("sans variables : indisponible ; variables partielles : invalide", () => {
    expect(readGeniusPayConfig(env({ NODE_ENV: "test" }))).toEqual({ status: "unconfigured" });
    expect(getBillingProvider(env({ NODE_ENV: "test" }))).toEqual({ available: false, reason: "unconfigured" });
    expect(readGeniusPayConfig(env({ NODE_ENV: "test", GENIUSPAY_API_KEY: base.GENIUSPAY_API_KEY })).status).toBe("invalid");
  });

  it("lit l'environnement sur le préfixe des clés et l'URL par défaut de la documentation", () => {
    const result = readGeniusPayConfig(env({ NODE_ENV: "test", ...base }));
    expect(result).toMatchObject({ status: "ready", config: { environment: "sandbox", baseUrl: "https://geniuspay.ci/api/v1/merchant" } });
  });

  it("refuse une clé sandbox en production, une clé live hors production et des clés d'environnements différents", () => {
    expect(readGeniusPayConfig(env({ NODE_ENV: "production", ...base }))).toMatchObject({ status: "invalid" });
    expect(readGeniusPayConfig(env({ NODE_ENV: "production", VERCEL_ENV: "preview", ...base })).status).toBe("ready");
    const live = { GENIUSPAY_API_KEY: "pk_live_test_unitaire", GENIUSPAY_API_SECRET: "sk_live_test_unitaire", GENIUSPAY_WEBHOOK_SECRET: SECRET };
    expect(readGeniusPayConfig(env({ NODE_ENV: "development", ...live })).status).toBe("invalid");
    expect(readGeniusPayConfig(env({ NODE_ENV: "production", ...live }))).toMatchObject({ status: "ready", config: { environment: "live" } });
    // Vercel Preview fixe NODE_ENV=production : une clé live n'y est jamais acceptée (mission 15).
    expect(readGeniusPayConfig(env({ NODE_ENV: "production", VERCEL_ENV: "preview", ...live })).status).toBe("invalid");
    expect(readGeniusPayConfig(env({ NODE_ENV: "production", VERCEL_ENV: "development", ...live })).status).toBe("invalid");
    expect(readGeniusPayConfig(env({ NODE_ENV: "production", VERCEL_ENV: "production", ...live })).status).toBe("ready");
    expect(readGeniusPayConfig(env({ NODE_ENV: "test", ...base, GENIUSPAY_API_SECRET: "sk_live_test_unitaire" })).status).toBe("invalid");
    expect(readGeniusPayConfig(env({ NODE_ENV: "test", ...base, GENIUSPAY_API_KEY: "cle_inconnue" })).status).toBe("invalid");
    expect(readGeniusPayConfig(env({ NODE_ENV: "test", ...base, GENIUSPAY_WEBHOOK_SECRET: "secret-sans-prefixe" })).status).toBe("invalid");
    expect(readGeniusPayConfig(env({ NODE_ENV: "test", ...base, GENIUSPAY_BASE_URL: "http://geniuspay.ci/api/v1/merchant" })).status).toBe("invalid");
  });

  it("refuse une adresse de retour non HTTPS en production", () => {
    const live = { GENIUSPAY_API_KEY: "pk_live_test_unitaire", GENIUSPAY_API_SECRET: "sk_live_test_unitaire", GENIUSPAY_WEBHOOK_SECRET: SECRET };
    expect(getBillingProvider(env({ NODE_ENV: "production", BETTER_AUTH_URL: "http://qadr.example.ci", ...live }))).toEqual({ available: false, reason: "invalid" });
    expect(getBillingProvider(env({ NODE_ENV: "production", BETTER_AUTH_URL: "https://qadr.example.ci", ...live }))).toMatchObject({ available: true, appUrl: "https://qadr.example.ci" });
  });
});

describe("adaptateur GeniusPay (fetch simulé, aucun appel réseau)", () => {
  type Call = { url: string; init: RequestInit };
  function fakeFetch(status: number, body: unknown, calls: Call[] = []): FetchLike {
    return async (url, init) => { calls.push({ url, init }); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); };
  }
  const request = { amountXof: 15000n, currency: "XOF" as const, description: "Qadr Ops - abonnement Mensuel", successUrl: "https://app.test/ok", errorUrl: "https://app.test/ko", metadata: { qadr_invoice: "i", qadr_attempt: "a" } };

  it("crée un paiement hébergé : en-têtes d'authentification, montant entier, sans moyen imposé", async () => {
    const calls: Call[] = [];
    const provider = new GeniusPayProvider(config, fakeFetch(201, { success: true, data: { reference: "MTX-A1B2C3D4E5", checkout_url: "https://geniuspay.ci/checkout/MTX-A1B2C3D4E5", status: "pending", environment: "sandbox", expires_at: "2026-11-04T10:00:00Z" } }, calls));
    const session = await provider.createCheckout(request);
    expect(session).toMatchObject({ reference: "MTX-A1B2C3D4E5", checkoutUrl: "https://geniuspay.ci/checkout/MTX-A1B2C3D4E5", status: "pending", environment: "sandbox" });
    expect(calls[0]!.url).toBe("https://geniuspay.test.invalid/api/v1/merchant/payments");
    const sent = new Headers(calls[0]!.init.headers);
    expect(sent.get("x-api-key")).toBe(config.apiKey);
    expect(sent.get("x-api-secret")).toBe(config.apiSecret);
    const payload = JSON.parse(String(calls[0]!.init.body));
    expect(payload).toEqual({ amount: 15000, currency: "XOF", description: request.description, success_url: request.successUrl, error_url: request.errorUrl, metadata: request.metadata });
    expect(payload).not.toHaveProperty("payment_method");
  });

  it("transforme les erreurs { success: false, error: { code, message } } en BillingProviderError sans le message distant", async () => {
    const provider = new GeniusPayProvider(config, fakeFetch(400, { success: false, error: { code: "PAYMENT_INIT_FAILED", message: "détail interne" } }));
    const error = await provider.createCheckout(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BillingProviderError);
    expect(error).toMatchObject({ code: "PAYMENT_INIT_FAILED", httpStatus: 400 });
    expect((error as Error).message).not.toContain("détail interne");
    await expect(new GeniusPayProvider(config, fakeFetch(401, { success: false, error: { code: "INVALID_API_KEY", message: "x" } })).getPayment("MTX-1")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    await expect(new GeniusPayProvider(config, fakeFetch(500, "<html>panne</html>")).getPayment("MTX-1")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(new GeniusPayProvider(config, async () => { throw new TypeError("fetch failed"); }).getPayment("MTX-1")).rejects.toMatchObject({ code: "network" });
  });

  it("refuse un lien de paiement non HTTPS et un montant sous le minimum avant tout appel", async () => {
    await expect(new GeniusPayProvider(config, fakeFetch(201, { success: true, data: { reference: "MTX-1", checkout_url: "javascript:alert(1)" } })).createCheckout(request)).rejects.toMatchObject({ code: "invalid_response" });
    const calls: Call[] = [];
    await expect(new GeniusPayProvider(config, fakeFetch(201, {}, calls)).createCheckout({ ...request, amountXof: 199n })).rejects.toMatchObject({ code: "invalid_amount" });
    expect(calls).toHaveLength(0);
  });

  it("relit un paiement : statut normalisé, montant exact, 404 = inconnu", async () => {
    const provider = new GeniusPayProvider(config, fakeFetch(200, { success: true, data: { reference: "MTX-1", amount: 15000, currency: "xof", status: "completed", environment: "sandbox", payment_method: "mtn_money", metadata: { qadr_attempt: "a", n: 3 } } }));
    expect(await provider.getPayment("MTX-1")).toEqual({ reference: "MTX-1", status: "completed", rawStatus: "completed", amountXof: 15000n, currency: "XOF", environment: "sandbox", metadata: { qadr_attempt: "a", n: "3" }, paymentMethod: "mtn_money" });
    expect(await new GeniusPayProvider(config, fakeFetch(404, { success: false, error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } })).getPayment("MTX-1")).toBeNull();
    expect(await provider.getPayment("../payments")).toBeNull();
    const odd = new GeniusPayProvider(config, fakeFetch(200, { success: true, data: { reference: "MTX-1", amount: 15000, status: "en_cours" } }));
    expect((await odd.getPayment("MTX-1"))?.status).toBe("unknown");
  });

  it("n'accepte que des montants entiers exacts et associe les moyens à la liste blanche", () => {
    expect(parseProviderAmount(10000)).toBe(10000n);
    expect(parseProviderAmount("10000.00")).toBe(10000n);
    expect(parseProviderAmount(10000.5)).toBeNull();
    expect(parseProviderAmount("1e4")).toBeNull();
    expect(parseProviderAmount(null)).toBeNull();
    expect(subscriptionMethodFromGeniusPay("mtn_money")).toBe("mtn_momo");
    expect(subscriptionMethodFromGeniusPay("pawapay")).toBe("other");
    expect(subscriptionMethodFromGeniusPay(null)).toBe("unknown");
  });
});
