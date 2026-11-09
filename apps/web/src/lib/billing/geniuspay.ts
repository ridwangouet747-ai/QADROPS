import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BillingProviderError, type BillingEnvironment, type BillingProvider, type CheckoutRequest, type CheckoutSession,
  type ProviderPayment, type ProviderPaymentStatus, type WebhookVerification,
} from "./provider";

/*
 * Adaptateur GeniusPay, API Merchant (documentation officielle lue le 2026-11-03 : geniuspay.ci/docs/api).
 *
 * - Création : `POST {base}/payments`, en-têtes `X-API-Key` (pk_) et `X-API-Secret` (sk_), sans `payment_method`
 *   pour obtenir le parcours hébergé (`checkout_url`, valable 24 h).
 * - Vérification : `GET {base}/payments/{reference}` ; réponses enveloppées `{ success, data }`, erreurs
 *   `{ success: false, error: { code, message } }`.
 * - Webhook : `X-Webhook-Signature` = HMAC-SHA256(`timestamp + "." + corps`, secret `whsec_…`), horodatage
 *   `X-Webhook-Timestamp` en secondes, tolérance 300 s. Encodage non précisé par la page : l'exemple PHP
 *   compare la sortie de `hash_hmac` (hexadécimal) ; on n'accepte donc que l'hexadécimal. La signature est
 *   vérifiée sur le corps BRUT reçu : l'exemple PHP ré-encode le JSON, ce qui peut différer octet pour octet.
 *   Dans tous les cas, la signature ne suffit jamais : le paiement est relu par l'API avant d'agir.
 *
 * Ambiguïtés recensées dans docs/billing-geniuspay.md (URL de base, liste des statuts, chaîne signée).
 */

/** URL de la documentation API (la page SDK et la Subscription API citent d'autres hôtes : à confirmer). */
export const GENIUSPAY_DEFAULT_BASE_URL = "https://geniuspay.ci/api/v1/merchant";
export const GENIUSPAY_WEBHOOK_TOLERANCE_SECONDS = 300;
/** Montant minimal documenté pour un paiement en XOF. */
export const GENIUSPAY_MINIMUM_XOF = 200n;
const REQUEST_TIMEOUT_MS = 15_000;
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type GeniusPayConfig = {
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  baseUrl: string;
  environment: BillingEnvironment;
};

export type GeniusPayConfigResult =
  | { status: "ready"; config: GeniusPayConfig }
  | { status: "unconfigured" }
  | { status: "invalid"; reason: string };

/**
 * Lit la configuration serveur. Rien n'est jamais lu côté navigateur.
 * - Les trois secrets sont requis ensemble ; aucun = paiement en ligne indisponible (jamais de faux succès).
 * - L'environnement se lit sur le préfixe des clés (`pk_sandbox_`/`sk_sandbox_` ou `pk_live_`/`sk_live_`), qui doivent concorder.
 * - Clé sandbox refusée en production (sauf préproduction Vercel, `VERCEL_ENV=preview`) ; clé live refusée hors production,
 *   y compris sur un déploiement Vercel Preview ou Development (`VERCEL_ENV` ≠ `production`).
 */
export function readGeniusPayConfig(source: NodeJS.ProcessEnv = process.env): GeniusPayConfigResult {
  const apiKey = source.GENIUSPAY_API_KEY?.trim() ?? "";
  const apiSecret = source.GENIUSPAY_API_SECRET?.trim() ?? "";
  const webhookSecret = source.GENIUSPAY_WEBHOOK_SECRET?.trim() ?? "";
  if (!apiKey && !apiSecret && !webhookSecret) return { status: "unconfigured" };
  if (!apiKey || !apiSecret || !webhookSecret) return { status: "invalid", reason: "GENIUSPAY_API_KEY, GENIUSPAY_API_SECRET et GENIUSPAY_WEBHOOK_SECRET doivent être configurées ensemble." };
  const keyEnvironment = apiKey.startsWith("pk_sandbox_") ? "sandbox" : apiKey.startsWith("pk_live_") ? "live" : null;
  const secretEnvironment = apiSecret.startsWith("sk_sandbox_") ? "sandbox" : apiSecret.startsWith("sk_live_") ? "live" : null;
  if (!keyEnvironment || !secretEnvironment) return { status: "invalid", reason: "Préfixe de clé GeniusPay inattendu (pk_sandbox_/pk_live_ et sk_sandbox_/sk_live_)." };
  if (keyEnvironment !== secretEnvironment) return { status: "invalid", reason: "La clé publique et la clé secrète GeniusPay ne sont pas du même environnement." };
  if (!webhookSecret.startsWith("whsec_") || webhookSecret.length < 16) return { status: "invalid", reason: "GENIUSPAY_WEBHOOK_SECRET doit avoir le format whsec_…" };
  const production = source.NODE_ENV === "production";
  const preproduction = production && source.VERCEL_ENV === "preview";
  if (keyEnvironment === "sandbox" && production && !preproduction) return { status: "invalid", reason: "Clé GeniusPay sandbox refusée en production." };
  if (keyEnvironment === "live" && !production) return { status: "invalid", reason: "Clé GeniusPay live refusée hors production (aucun paiement réel en développement ou en test)." };
  // Sur Vercel, NODE_ENV vaut « production » aussi en Preview : seul VERCEL_ENV distingue la vraie production.
  if (keyEnvironment === "live" && source.VERCEL_ENV && source.VERCEL_ENV !== "production") return { status: "invalid", reason: "Clé GeniusPay live refusée sur un déploiement Vercel autre que la production." };
  const rawBase = source.GENIUSPAY_BASE_URL?.trim() || GENIUSPAY_DEFAULT_BASE_URL;
  if (!URL.canParse(rawBase) || new URL(rawBase).protocol !== "https:") return { status: "invalid", reason: "GENIUSPAY_BASE_URL doit être une URL HTTPS." };
  return { status: "ready", config: { apiKey, apiSecret, webhookSecret, baseUrl: rawBase.replace(/\/+$/, ""), environment: keyEnvironment } };
}

/* ------------------------------------------------------------------ Signature du webhook */

/**
 * Vérifie `X-Webhook-Signature` sur le corps brut, en temps constant, avec une fenêtre de ±300 s (un horodatage
 * trop ancien ou trop loin dans le futur est refusé). Sans secret configuré, rien n'est jamais accepté.
 */
export function verifyGeniusPayWebhookSignature(secret: string | undefined, rawBody: string, headers: Headers, now = new Date()): WebhookVerification {
  if (!secret) return { ok: false, reason: "not_configured" };
  const signature = headers.get("x-webhook-signature")?.trim();
  const timestamp = headers.get("x-webhook-timestamp")?.trim();
  if (!signature || !timestamp) return { ok: false, reason: "missing_headers" };
  const refuse = (reason: "bad_timestamp" | "stale" | "bad_signature"): WebhookVerification => {
    const variant = diagnoseGeniusPaySignature(secret, rawBody, timestamp, signature);
    return variant ? { ok: false, reason, variant } : { ok: false, reason };
  };
  if (!/^\d{1,12}$/.test(timestamp)) return refuse("bad_timestamp");
  const seconds = Number(timestamp);
  // Horodatage hors fenêtre : rien à diagnostiquer sur le format (des millisecondes échouent déjà ci-dessus).
  if (Math.abs(Math.floor(now.getTime() / 1000) - seconds) > GENIUSPAY_WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return refuse("bad_signature");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return refuse("bad_signature");
  return { ok: true, timestamp: seconds };
}

/** Ré-encodage à la manière de `json_encode` de PHP (exemple de la documentation) : `/` et non-ASCII échappés. */
function phpJsonEncode(value: unknown) {
  return JSON.stringify(value).replace(/\//g, "\\/").replace(/[\u0080-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Après un refus seulement : cherche quelle lecture de la documentation aurait produit la signature reçue
 * (encodage hex/base64, corps brut ou JSON ré-encodé, horodatage inclus ou non, en secondes ou en millisecondes),
 * pour que le premier essai sandbox réponde lui-même aux questions ouvertes (docs/engineering/geniuspay-questions.md).
 * Le résultat n'est qu'un libellé pour les journaux : il ne rend JAMAIS un événement valide et ne contient ni secret,
 * ni signature, ni contenu du corps. Ni la fenêtre de 300 s ni la comparaison en temps constant ne sont utiles ici.
 */
export function diagnoseGeniusPaySignature(secret: string, rawBody: string, timestamp: string, signature: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { parsed = undefined; }
  const bodies: [string, string][] = [["corps_brut", rawBody]];
  if (parsed !== undefined) bodies.push(["json_reencode", JSON.stringify(parsed)], ["json_php", phpJsonEncode(parsed)]);
  const messages: [string, (body: string) => string][] = [["horodatage_point_corps", (body) => `${timestamp}.${body}`], ["corps_seul", (body) => body]];
  const prefixed = /^sha256=/i.test(signature);
  const given = signature.replace(/^sha256=/i, "");
  const unit = /^\d{13}$/.test(timestamp) ? "+horodatage_ms" : "";
  for (const [bodyLabel, body] of bodies) {
    for (const [messageLabel, message] of messages) {
      const digest = createHmac("sha256", secret).update(message(body), "utf8").digest();
      const encodings: [string, string][] = [["hex", digest.toString("hex")], ["base64", digest.toString("base64")], ["base64url", digest.toString("base64url")]];
      for (const [encoding, text] of encodings) {
        if (given === text || (encoding === "hex" && given.toLowerCase() === text)) return `${encoding}+${messageLabel}+${bodyLabel}${unit}${prefixed ? "+prefixe_sha256" : ""}`;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ Lecture des réponses */

const knownStatuses: ReadonlySet<string> = new Set(["pending", "processing", "completed", "failed", "cancelled", "refunded", "expired"]);

export function normalizeGeniusPayStatus(value: unknown): ProviderPaymentStatus {
  if (typeof value !== "string") return "unknown";
  const status = value.trim().toLowerCase();
  if (status === "canceled") return "cancelled";
  return knownStatuses.has(status) ? status as ProviderPaymentStatus : "unknown";
}

/** Montant entier exact : `15000`, `10000.00` ou `"15000"` ; toute fraction ou valeur douteuse donne `null`. */
export function parseProviderAmount(value: unknown): bigint | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === "string" && /^\d{1,15}(\.0+)?$/.test(value.trim())) return BigInt(value.trim().split(".")[0]!);
  return null;
}

function parseEnvironment(value: unknown): BillingEnvironment | null {
  return value === "sandbox" || value === "live" ? value : null;
}

function parseMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") result[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") result[key] = String(item);
  }
  return result;
}

function parseDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type Envelope = { success?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };

/* ------------------------------------------------------------------ Adaptateur */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class GeniusPayProvider implements BillingProvider {
  readonly name = "geniuspay" as const;
  readonly environment: BillingEnvironment;

  constructor(private readonly config: GeniusPayConfig, private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.environment = config.environment;
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; envelope: Envelope }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: { "x-api-key": this.config.apiKey, "x-api-secret": this.config.apiSecret, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
        redirect: "error",
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new BillingProviderError(timeout ? "timeout" : "network", null, "GeniusPay ne répond pas.");
    }
    let envelope: Envelope;
    try { envelope = await response.json() as Envelope; } catch {
      throw new BillingProviderError("invalid_response", response.status, "Réponse GeniusPay illisible.");
    }
    if (!envelope || typeof envelope !== "object") throw new BillingProviderError("invalid_response", response.status, "Réponse GeniusPay illisible.");
    return { status: response.status, envelope };
  }

  private static failure(status: number, envelope: Envelope) {
    const code = typeof envelope.error?.code === "string" ? envelope.error.code.slice(0, 64) : `http_${status}`;
    return new BillingProviderError(code, status, "GeniusPay a refusé la requête.");
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutSession> {
    if (input.currency !== "XOF" || input.amountXof < GENIUSPAY_MINIMUM_XOF || input.amountXof > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BillingProviderError("invalid_amount", null, "Montant refusé avant l'appel à GeniusPay.");
    }
    const { status, envelope } = await this.request("POST", "/payments", {
      amount: Number(input.amountXof), currency: input.currency, description: input.description.slice(0, 500),
      success_url: input.successUrl, error_url: input.errorUrl, metadata: input.metadata,
    });
    if (status < 200 || status >= 300 || envelope.success !== true) throw GeniusPayProvider.failure(status, envelope);
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    const reference = typeof data.reference === "string" ? data.reference : "";
    const checkoutUrl = typeof data.checkout_url === "string" ? data.checkout_url : "";
    // On redirige le navigateur vers cette adresse : HTTPS obligatoire (jamais `javascript:` ni HTTP).
    if (!REFERENCE_PATTERN.test(reference) || !URL.canParse(checkoutUrl) || new URL(checkoutUrl).protocol !== "https:") {
      throw new BillingProviderError("invalid_response", status, "Réponse GeniusPay incomplète.");
    }
    return { reference, checkoutUrl, status: normalizeGeniusPayStatus(data.status), environment: parseEnvironment(data.environment), expiresAt: parseDate(data.expires_at) };
  }

  async getPayment(reference: string): Promise<ProviderPayment | null> {
    if (!REFERENCE_PATTERN.test(reference)) return null;
    const { status, envelope } = await this.request("GET", `/payments/${encodeURIComponent(reference)}`);
    if (status === 404) return null;
    if (status < 200 || status >= 300 || envelope.success !== true) throw GeniusPayProvider.failure(status, envelope);
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    if (typeof data.reference !== "string") throw new BillingProviderError("invalid_response", status, "Réponse GeniusPay incomplète.");
    return {
      reference: data.reference,
      status: normalizeGeniusPayStatus(data.status),
      rawStatus: typeof data.status === "string" ? data.status.slice(0, 32) : "",
      amountXof: parseProviderAmount(data.amount),
      currency: typeof data.currency === "string" ? data.currency.toUpperCase() : null,
      environment: parseEnvironment(data.environment),
      metadata: parseMetadata(data.metadata),
      paymentMethod: typeof data.payment_method === "string" ? data.payment_method.slice(0, 32) : null,
    };
  }

  verifyWebhook(rawBody: string, headers: Headers, now = new Date()) {
    return verifyGeniusPayWebhookSignature(this.config.webhookSecret, rawBody, headers, now);
  }
}

/** Correspondance des moyens GeniusPay vers la liste blanche de `subscription_payment.method`. */
export function subscriptionMethodFromGeniusPay(method: string | null): "wave" | "orange_money" | "mtn_momo" | "moov_money" | "card" | "other" | "unknown" {
  switch ((method ?? "").toLowerCase()) {
    case "": return "unknown";
    case "wave": return "wave";
    case "orange_money": return "orange_money";
    case "mtn_money": case "mtn_momo": return "mtn_momo";
    case "moov_money": return "moov_money";
    case "card": return "card";
    default: return "other";
  }
}
