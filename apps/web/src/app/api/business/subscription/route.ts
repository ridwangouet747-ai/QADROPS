import { getBusinessSubscriptionOverview } from "@/lib/domain/business-subscription";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Lecture seule de l'abonnement du commerce actif ; l'application d'un code reste sur POST ./promotion. */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe(await getBusinessSubscriptionOverview(context.db, context.actorUserId, context.businessId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
