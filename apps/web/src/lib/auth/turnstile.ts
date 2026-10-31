/**
 * Validation serveur Cloudflare Turnstile (Siteverify). Le widget ne protège rien à lui seul :
 * chaque jeton est vérifié ici, une seule fois, avec le secret qui ne quitte jamais le serveur.
 */
export const turnstileActions = ["login", "register", "password-reset"] as const;
export type TurnstileAction = (typeof turnstileActions)[number];

/** En-tête qui transporte le jeton du widget vers les routes Better Auth protégées. */
export const turnstileHeader = "x-turnstile-token";

export type TurnstileFailure = "missing" | "invalid" | "expired_or_used" | "mismatch" | "unavailable" | "not_configured" | "test_key_in_production";
export type TurnstileResult = { ok: true } | { ok: false; reason: TurnstileFailure };

type VerifyResponse = { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };

/** Clés de test officielles de Cloudflare : utiles en local et en test, refusées en production. */
const testSiteKeys = new Set(["1x00000000000000000000AA", "2x00000000000000000000AB", "1x00000000000000000000BB", "2x00000000000000000000BB", "3x00000000000000000000FF"]);
const testSecrets = new Set(["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]);

export async function verifyTurnstile(
  token: unknown,
  options: {
    secret: string | undefined;
    siteKey: string | undefined;
    isProduction: boolean;
    /** Nom d'hôte attendu (celui de BETTER_AUTH_URL) : un jeton obtenu sur un autre site est refusé. */
    expectedHostname?: string;
    expectedAction?: TurnstileAction;
    remoteIp?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<TurnstileResult> {
  const { secret, siteKey, isProduction, expectedHostname, expectedAction, remoteIp, fetcher = fetch, timeoutMs = 8000 } = options;
  // Seul le développement local sans aucune clé peut s'en passer ; la production refuse toujours.
  if (!secret && !siteKey && !isProduction) return { ok: true };
  if (!secret || !siteKey) return { ok: false, reason: "not_configured" };
  const usingTestKeys = testSecrets.has(secret) || testSiteKeys.has(siteKey);
  if (isProduction && usingTestKeys) return { ok: false, reason: "test_key_in_production" };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return { ok: false, reason: "missing" };

  // Même clé d'idempotence pour le réessai : Cloudflare ne compte pas deux fois le même jeton.
  const idempotencyKey = crypto.randomUUID();
  let result: VerifyResponse | undefined;
  for (let attempt = 1; attempt <= 2 && !result; attempt++) {
    try {
      const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, response: token, idempotency_key: idempotencyKey, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) result = (await response.json()) as VerifyResponse;
      else if (response.status < 500) return { ok: false, reason: "unavailable" };
    } catch {
      // Panne réseau ou délai dépassé : un second essai, puis refus.
    }
  }
  if (!result) return { ok: false, reason: "unavailable" };
  if (result.success !== true) {
    return { ok: false, reason: result["error-codes"]?.includes("timeout-or-duplicate") ? "expired_or_used" : "invalid" };
  }
  // Les clés de test répondent « localhost » / « test » quelle que soit la page : contrôles réservés aux vraies clés.
  if (!usingTestKeys) {
    if (expectedHostname && result.hostname !== expectedHostname) return { ok: false, reason: "mismatch" };
    if (expectedAction && result.action !== expectedAction) return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
