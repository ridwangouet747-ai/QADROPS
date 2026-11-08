import { createServer, request as httpRequest } from "node:http";

/**
 * Passerelle locale des webhooks GeniusPay (essai sandbox par Cloudflare Quick Tunnel).
 *
 * Le tunnel pointe vers cette passerelle, jamais vers Next.js : seule la requête `POST` sur le chemin exact du
 * webhook est relayée vers l'aperçu local. Tout le reste reçoit 404 (405 pour une autre méthode sur ce chemin),
 * sans que Next.js soit jamais contacté.
 *
 * La passerelle ne vérifie PAS la signature : elle relaie les octets du corps tels quels et les en-têtes signés,
 * et c'est la route Next.js qui vérifie (HMAC sur le corps brut). Elle ne lit, n'analyse ni ne reconstruit le JSON.
 * Les journaux ne contiennent ni chemin demandé, ni en-tête, ni corps : seulement un résultat, un statut, une taille.
 */
export const WEBHOOK_PATH = "/api/webhooks/geniuspay";
/** Même plafond que la route Next.js (`MAX_BODY_BYTES`). */
export const MAX_BODY_BYTES = 65_536;
/** Seuls en-têtes relayés : ceux que la route lit (type, signature, horodatage) et le type d'événement. */
export const FORWARDED_HEADERS = Object.freeze(["content-type", "x-webhook-signature", "x-webhook-timestamp", "x-webhook-event"]);
const MAX_UPSTREAM_RESPONSE_BYTES = 16_384;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** L'amont doit être l'aperçu local en HTTP sur cette machine : la passerelle ne relaie jamais ailleurs. */
export function parseUpstream(raw) {
  if (typeof raw !== "string" || !URL.canParse(raw)) throw new Error("Adresse amont invalide.");
  const url = new URL(raw);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error("L'amont doit être http://127.0.0.1:<port> ou http://localhost:<port> (cet ordinateur uniquement).");
  }
  return new URL(WEBHOOK_PATH, url.origin);
}

/** Fenêtre glissante simple : protège l'aperçu d'un flot de requêtes arrivant par l'URL publique. */
function createLimiter(limit, windowMs, now) {
  let hits = [];
  return () => {
    const current = now();
    hits = hits.filter((at) => current - at < windowMs);
    if (hits.length >= limit) return false;
    hits.push(current);
    return true;
  };
}

/**
 * @param {{ upstream: string; log?: (entry: object) => void; maxBodyBytes?: number; upstreamTimeoutMs?: number;
 *           rateLimit?: { limit: number; windowMs: number }; now?: () => number }} options
 */
export function createGateway(options) {
  const target = parseUpstream(options.upstream);
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 30_000;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const allow = createLimiter(options.rateLimit?.limit ?? 60, options.rateLimit?.windowMs ?? 60_000, now);

  const server = createServer((req, res) => {
    const started = now();
    const reply = (status, outcome, body, extraHeaders = {}) => {
      if (res.headersSent) return;
      const payload = Buffer.from(body ?? JSON.stringify({ error: outcome }));
      res.writeHead(status, { "content-type": "application/json", "content-length": payload.length, "cache-control": "no-store",
        "x-content-type-options": "nosniff", ...extraHeaders });
      res.end(payload);
      log({ event: "passerelle.webhook", outcome, status, bytes: received, ms: now() - started });
    };
    let received = 0;

    // Chemin comparé sur la cible BRUTE de la requête : aucune normalisation (barre finale, `//`, `..`, encodage,
    // casse, requête `?…`) ne peut faire passer une autre adresse pour celle du webhook.
    if (req.url !== WEBHOOK_PATH) { req.resume(); return reply(404, "route_refusee", '{"error":"not_found"}'); }
    if (req.method !== "POST") { req.resume(); return reply(405, "methode_refusee", '{"error":"method_not_allowed"}', { allow: "POST" }); }
    if (!allow()) { req.resume(); return reply(429, "trop_de_requetes", '{"error":"rate_limited"}', { "retry-after": "60" }); }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (!Number.isFinite(declared) || declared > maxBodyBytes) {
      req.resume();
      return reply(413, "trop_volumineux", '{"error":"payload_too_large"}', { connection: "close" });
    }

    const chunks = [];
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBodyBytes) {
        aborted = true;
        chunks.length = 0;
        reply(413, "trop_volumineux", '{"error":"payload_too_large"}', { connection: "close" });
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => { aborted = true; });
    req.on("end", () => {
      if (aborted) return;
      const body = Buffer.concat(chunks);
      const headers = { "content-length": String(body.length) };
      for (const name of FORWARDED_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const forward = httpRequest(target, { method: "POST", headers, timeout: upstreamTimeoutMs }, (upstreamRes) => {
        const parts = [];
        let size = 0;
        upstreamRes.on("data", (part) => { size += part.length; if (size <= MAX_UPSTREAM_RESPONSE_BYTES) parts.push(part); });
        upstreamRes.on("end", () => {
          const status = upstreamRes.statusCode ?? 502;
          const text = size <= MAX_UPSTREAM_RESPONSE_BYTES ? Buffer.concat(parts) : Buffer.from('{"error":"upstream_response_too_large"}');
          reply(status, "transmis", text);
        });
        upstreamRes.on("error", () => reply(502, "amont_indisponible", '{"error":"upstream_unavailable"}'));
      });
      forward.on("timeout", () => { forward.destroy(); reply(504, "amont_trop_lent", '{"error":"upstream_timeout"}'); });
      forward.on("error", () => reply(502, "amont_indisponible", '{"error":"upstream_unavailable"}'));
      forward.end(body);
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.maxHeadersCount = 64;
  return { server, target };
}
