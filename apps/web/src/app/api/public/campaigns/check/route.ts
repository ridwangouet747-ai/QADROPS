import { clientIpFrom } from "@/lib/auth/client-ip-headers";
import { turnstileHeader, verifyTurnstile } from "@/lib/auth/turnstile";
import { getDatabase } from "@/lib/db/client";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { checkPublicCampaign } from "@/lib/domain/public-campaigns";
import { readEnvironment } from "@/lib/env";
import { publicCampaignCheckLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Vérification PUBLIQUE d'un code de campagne (sans session), pour l'inscription et la future page Pricing.
 * Contrat : docs/promotions.md. Ne consomme rien, n'écrit rien en base.
 *
 * - 200 `{ valid: true, … }` : offre à afficher ; 200 `{ valid: false }` : réponse unique pour tout refus.
 * - 400 `validation` (corps illisible), 400 `turnstile_failed`, 429 `rate_limited` (en-tête Retry-After).
 *
 * Limite par adresse IP : publicCampaignCheckLimiter (src/lib/rate-limit.ts), en mémoire locale de l'instance.
 * Turnstile (action « promotion-check ») est exigé dès que les clés sont configurées, toujours en production.
 */
const noStore = { "cache-control": "no-store" };

function publicDatabase(): Promise<CommercialDatabase> | CommercialDatabase {
  if (process.env.QADR_PREVIEW_MODE === "true" && process.env.NODE_ENV === "development") {
    return import("@/lib/preview/database").then(async ({ getPreviewDatabase }) => await getPreviewDatabase() as unknown as CommercialDatabase);
  }
  return getDatabase() as unknown as CommercialDatabase;
}

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
    const body = await parseJsonRequest(request);
    return Response.json(await checkPublicCampaign(await publicDatabase(), body), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
