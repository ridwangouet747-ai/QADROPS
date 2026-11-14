import { getBillingProvider } from "@/lib/billing";
import { getBusinessSubscriptionOverview } from "@/lib/domain/business-subscription";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Lecture seule de l'abonnement du commerce actif ; codes sur POST ./promotion, paiement en ligne sur POST ./checkout. */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers, { allowWithoutSubscription: true });
    return new Response(jsonSafe(await getBusinessSubscriptionOverview(context.db, context.actorUserId, context.businessId, new Date(), { onlinePayment: getBillingProvider().available })), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
