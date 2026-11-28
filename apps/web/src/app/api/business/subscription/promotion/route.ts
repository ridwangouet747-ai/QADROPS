import { clientIpFrom } from "@/lib/auth/client-ip-headers";
import { platformRequestSecret } from "@/lib/auth/platform-request";
import { redeemCommercialCodeForBusiness, recordCommercialCodeRejection } from "@/lib/domain/commercial-codes";
import { CommercialError } from "@/lib/domain/commercial";
import { redeemSubscriptionPromotion } from "@/lib/domain/platform";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { accessCodeFamilyOf } from "@/lib/security/access-codes";
import { consumeRateLimits, rateRules, refundRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const headers = { "content-type": "application/json", "cache-control": "private, no-store" };

/**
 * Code saisi par le commerçant connecté sur la page Abonnement.
 * - Code d'accès commercial (`QADR-…`, 2026-11-16) : active ou prolonge l'abonnement du commerce DE LA SESSION.
 * - Code d'invitation d'employé (`EQP-…`) : refusé (422 `invite_code`), il ne sert qu'à rejoindre une équipe.
 * - Autre texte : ancien parcours des codes promotionnels privés (mission 08), inchangé.
 */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers, { allowWithoutSubscription: true });
    const body = await parseJsonRequest(request) as { code?: unknown };
    const family = accessCodeFamilyOf(body?.code);
    if (family === "invite") throw new CommercialError("Ce code sert à rejoindre l’équipe d’un commerce, pas à activer un abonnement.", 422, "invite_code");
    if (family !== "commercial") {
      return new Response(jsonSafe(await redeemSubscriptionPromotion(context.db, context.actorUserId, context.businessId, body)), { headers });
    }
    const secret = platformRequestSecret();
    const client = clientIpFrom(request.headers);
    const limits = await consumeRateLimits(context.db, [
      { rule: rateRules.accessCodeAccount, subject: context.actorUserId },
      { rule: rateRules.accessCodeIp, subject: client },
      { rule: rateRules.accessCodeGlobal, subject: "all" },
    ], secret);
    if (!limits.allowed) {
      return Response.json({ error: "Trop d’essais. Patientez quelques minutes avant de réessayer.", code: "rate_limited" },
        { status: 429, headers: { ...headers, "retry-after": String(limits.retryAfterSeconds) } });
    }
    try {
      const activation = await redeemCommercialCodeForBusiness(context.db, context.actorUserId, context.businessId, body.code);
      await refundRateLimit(context.db, limits.decisions);
      // Même contrat que les codes d’accès historiques (`kind: "access"`) : la carte « J’ai un code » l’affiche telle quelle.
      return new Response(jsonSafe({ kind: "access", source: "commercial_code", replayed: activation.replayed, plan: activation.plan, status: activation.status,
        startsAt: activation.startsAt, endsAt: activation.endsAt, lifetime: activation.lifetime, duration: activation.duration }), { headers });
    } catch (error) {
      if (error instanceof CommercialError && error.code) {
        await recordCommercialCodeRejection(context.db, { reason: error.code, actorUserId: context.actorUserId, businessId: context.businessId, client: "session" });
      }
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
