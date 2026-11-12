import { clientIpFrom } from "@/lib/auth/client-ip-headers";
import { platformRequestSecret } from "@/lib/auth/platform-request";
import { turnstileHeader, verifyTurnstile } from "@/lib/auth/turnstile";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { checkPublicCampaign } from "@/lib/domain/public-campaigns";
import { readEnvironment } from "@/lib/env";
import { publicCampaignCheckLimiter } from "@/lib/rate-limit";
import { consumeRateLimits, rateRules } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * Vérification PUBLIQUE d'un code de campagne (sans session), pour l'inscription et la future page Pricing.
 * Contrat : docs/promotions.md. Ne consomme aucun code ; la seule écriture est le compteur de tentatives.
 *
 * - 200 `{ valid: true, … }` : offre à afficher ; 200 `{ valid: false }` : réponse unique pour tout refus.
 * - 400 `validation` (corps illisible), 400 `turnstile_failed`, 429 `rate_limited` (en-tête Retry-After).
 *
 * Limites par adresse IP, en deux temps (mission 18) :
 * 1. publicCampaignCheckLimiter (src/lib/rate-limit.ts), en mémoire de l'instance : coupe tôt une rafale arrivée
 *    sur une même instance, sans écrire en base ni appeler Siteverify ;
 * 2. rateRules.publicCampaignCheckIp (src/lib/security/rate-limit.ts), compteur PARTAGÉ en base, compté seulement
 *    après un Turnstile réussi : la limite tient sur toutes les instances Vercel, et une requête sans jeton
 *    valide n'écrit jamais en base.
 * Turnstile (action « promotion-check ») est exigé dès que les clés sont configurées, toujours en production.
 */
const noStore = { "cache-control": "no-store" };

export async function POST(request: Request) {
  try {
    const decision = publicCampaignCheckLimiter.consume(clientIpFrom(request.headers));
    if (!decision.allowed) {
      return Response.json({ error: "Trop d’essais. Patientez quelques minutes avant de réessayer.", code: "rate_limited" },
        { status: 429, headers: { ...noStore, "retry-after": String(decision.retryAfterSeconds) } });
    }
    const env = readEnvironment();
    const baseUrl = process.env.BETTER_AUTH_URL;
    const turnstile = await verifyTurnstile(request.headers.get(turnstileHeader), {
      secret: env.TURNSTILE_SECRET_KEY, siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, isProduction: env.NODE_ENV === "production",
      expectedHostname: baseUrl ? new URL(baseUrl).hostname : undefined, expectedAction: "promotion-check",
      remoteIp: clientIpFrom(request.headers),
    });
    if (!turnstile.ok) {
      console.warn(JSON.stringify({ event: "turnstile.rejected", action: "promotion-check", reason: turnstile.reason }));
      return Response.json({ error: "La vérification de sécurité a échoué. Réessayez.", code: "turnstile_failed" }, { status: 400, headers: noStore });
    }
    const db = await getRuntimeDatabase();
    const shared = await consumeRateLimits(db, [{ rule: rateRules.publicCampaignCheckIp, subject: clientIpFrom(request.headers) }], platformRequestSecret());
    if (!shared.allowed) {
      return Response.json({ error: "Trop d’essais. Patientez quelques minutes avant de réessayer.", code: "rate_limited" },
        { status: 429, headers: { ...noStore, "retry-after": String(shared.retryAfterSeconds) } });
    }
    const body = await parseJsonRequest(request);
    return Response.json(await checkPublicCampaign(db, body), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
