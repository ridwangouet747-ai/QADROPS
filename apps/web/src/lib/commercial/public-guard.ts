import { clientIpFrom } from "@/lib/auth/client-ip-headers";
import { platformRequestSecret } from "@/lib/auth/platform-request";
import { turnstileHeader, verifyTurnstile, type TurnstileAction } from "@/lib/auth/turnstile";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { readEnvironment } from "@/lib/env";
import { isTrustedRequest } from "@/lib/security/request-origin";
import { consumeRateLimits, type RateDecision, type RateRule } from "@/lib/security/rate-limit";

export const noStore = { "cache-control": "no-store" } as const;

export type PublicGuard = { db: CommercialDatabase; ip: string; secret: string; decisions: RateDecision[] };

/**
 * Barrière commune des routes publiques qui reçoivent un code ou un mot de passe sans session (2026-11-16) :
 * origine de l'application, Turnstile (exigé dès que les clés existent, toujours en production), puis compteurs
 * PARTAGÉS en base (seulement après un Turnstile réussi : une requête sans jeton n'écrit rien).
 * Rend une réponse de refus, ou le contexte pour continuer.
 */
export async function guardPublicRequest(request: Request, action: TurnstileAction, checks: (ip: string) => { rule: RateRule; subject: string }[]): Promise<Response | PublicGuard> {
  if (!isTrustedRequest(request.headers, request.method)) {
    return Response.json({ error: "Requête refusée.", code: "invalid_origin" }, { status: 403, headers: noStore });
  }
  const env = readEnvironment();
  const baseUrl = process.env.BETTER_AUTH_URL;
  const ip = clientIpFrom(request.headers);
  const turnstile = await verifyTurnstile(request.headers.get(turnstileHeader), {
    secret: env.TURNSTILE_SECRET_KEY, siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, isProduction: env.NODE_ENV === "production",
    expectedHostname: baseUrl ? new URL(baseUrl).hostname : undefined, expectedAction: action, remoteIp: ip,
  });
  if (!turnstile.ok) {
    console.warn(JSON.stringify({ event: "turnstile.rejected", action, reason: turnstile.reason }));
    return Response.json({ error: "La vérification de sécurité a échoué. Réessayez.", code: "turnstile_failed" }, { status: 400, headers: noStore });
  }
  const db = await getRuntimeDatabase();
  const secret = platformRequestSecret();
  const limits = await consumeRateLimits(db, checks(ip), secret);
  if (!limits.allowed) {
    return Response.json({ error: "Trop d’essais. Patientez quelques minutes avant de réessayer.", code: "rate_limited" },
      { status: 429, headers: { ...noStore, "retry-after": String(limits.retryAfterSeconds) } });
  }
  return { db, ip, secret, decisions: limits.decisions };
}
