import { createHmac, randomUUID } from "node:crypto";

/*
 * GeniusPay simulé pour les tests de route (mission 12, lot L1b). Remplace UNIQUEMENT `fetch` (via
 * `vi.stubGlobal`) : la base, les sessions, l'appartenance et les permissions restent réelles. Toute requête
 * vers une autre adresse échoue bruyamment : aucun appel réseau réel n'est possible pendant ces tests.
 * Les valeurs de configuration sont des valeurs de test évidentes, jamais de vraies clés.
 */

export const FAKE_GENIUSPAY_BASE = "https://geniuspay.test.invalid/api/v1/merchant";
export const FAKE_WEBHOOK_SECRET = "whsec_test_harnais_qadr_ops";
export const FAKE_GENIUSPAY_ENV = {
  GENIUSPAY_API_KEY: "pk_sandbox_test_harnais",
  GENIUSPAY_API_SECRET: "sk_sandbox_test_harnais",
  GENIUSPAY_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
  GENIUSPAY_BASE_URL: FAKE_GENIUSPAY_BASE,
  // Depuis le 2026-11-16, le paiement en ligne est en pause par défaut (`manual_code`) : ces tests l'exercent
  // explicitement en mode `geniuspay`. Le mode pause a ses propres tests (geniuspay-pause.http.test.ts).
  QADR_COMMERCIAL_MODE: "geniuspay",
};

export type FakePayment = {
  reference: string; amount: number | string; currency: string; status: string; environment: string;
  metadata: Record<string, string>; payment_method: string | null;
};

export function configureFakeGeniusPay() {
  const env = process.env as Record<string, string | undefined>;
  for (const [name, value] of Object.entries(FAKE_GENIUSPAY_ENV)) env[name] = value;
}

export function unconfigureGeniusPay() {
  const env = process.env as Record<string, string | undefined>;
  for (const name of Object.keys(FAKE_GENIUSPAY_ENV)) delete env[name];
}

export class FakeGeniusPay {
  readonly payments = new Map<string, FakePayment>();
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  /** Prochaine création refusée (`{ success: false }`) ou en panne réseau. */
  failNextCreate: "refuse" | "network" | null = null;
  /** Relectures en panne (GeniusPay injoignable). */
  getUnavailable = false;
  private counter = 0;

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${FAKE_GENIUSPAY_BASE}/`)) throw new Error(`Appel réseau interdit pendant les tests : ${url}`);
    const headers = new Headers(init?.headers);
    if (headers.get("x-api-key") !== FAKE_GENIUSPAY_ENV.GENIUSPAY_API_KEY || headers.get("x-api-secret") !== FAKE_GENIUSPAY_ENV.GENIUSPAY_API_SECRET) {
      return Response.json({ success: false, error: { code: "INVALID_API_KEY", message: "Invalid API key" } }, { status: 401 });
    }
    const path = url.slice(FAKE_GENIUSPAY_BASE.length);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    this.calls.push({ method, path, body });
    if (method === "POST" && path === "/payments") {
      const failure = this.failNextCreate;
      this.failNextCreate = null;
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "refuse") return Response.json({ success: false, error: { code: "PAYMENT_INIT_FAILED", message: "Refus simulé" } }, { status: 400 });
      this.counter += 1;
      const reference = `MTX-TEST${String(this.counter).padStart(6, "0")}`;
      this.payments.set(reference, { reference, amount: body!.amount as number, currency: String(body!.currency ?? "XOF"), status: "pending", environment: "sandbox",
        metadata: body!.metadata as Record<string, string>, payment_method: null });
      return Response.json({ success: true, data: { id: this.counter, reference, amount: body!.amount, currency: body!.currency, status: "pending",
        checkout_url: `https://geniuspay.test.invalid/checkout/${reference}`, environment: "sandbox", metadata: body!.metadata,
        expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString() } }, { status: 201 });
    }
    const match = /^\/payments\/([^/]+)$/.exec(path);
    if (method === "GET" && match) {
      if (this.getUnavailable) throw new TypeError("fetch failed");
      const payment = this.payments.get(decodeURIComponent(match[1]!));
      if (!payment) return Response.json({ success: false, error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } }, { status: 404 });
      return Response.json({ success: true, data: { ...payment, fees: 0, net_amount: payment.amount, completed_at: payment.status === "completed" ? new Date().toISOString() : null } });
    }
    return Response.json({ success: false, error: { code: "NOT_FOUND", message: "Route inconnue" } }, { status: 404 });
  };

  /** Fait évoluer un paiement côté GeniusPay (ce que relira `GET /payments/{reference}`). */
  set(reference: string, change: Partial<FakePayment>) {
    const payment = this.payments.get(reference);
    if (!payment) throw new Error(`Paiement simulé inconnu : ${reference}`);
    Object.assign(payment, change);
  }

  countCreates() { return this.calls.filter((call) => call.method === "POST").length; }
}

/** Webhook signé comme le documente GeniusPay : HMAC-SHA256(`timestamp.corps`) en hexadécimal. */
export function signedWebhook(event: string, reference: string, options: { eventId?: string; secret?: string; timestamp?: number; amount?: number; status?: string; metadata?: Record<string, string> } = {}) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: options.eventId ?? randomUUID(), event, timestamp, created_at: new Date(timestamp * 1000).toISOString(), environment: "sandbox", api_version: "2024-01-01",
    data: { object: "transaction", id: 1, reference, amount: options.amount ?? 15000, currency: "XOF", status: options.status ?? event.replace("payment.", ""), metadata: options.metadata ?? {} },
  });
  const signature = createHmac("sha256", options.secret ?? FAKE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  return { body, headers: { "x-webhook-signature": signature, "x-webhook-timestamp": String(timestamp), "x-webhook-event": event, "content-type": "application/json" } };
}
