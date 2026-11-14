import { getBillingProvider } from "@/lib/billing";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { startSubscriptionCheckout } from "@/lib/domain/subscription-billing";

export const runtime = "nodejs";

/**
 * Ouvre (ou retrouve) le paiement GeniusPay de l'abonnement du commerce actif. Propriétaire seulement ;
 * corps `{ planCode, idempotencyKey }` : le prix vient toujours de la formule en base.
 */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers, { allowWithoutSubscription: true });
    const result = await startSubscriptionCheckout(context.db, getBillingProvider(), { actorUserId: context.actorUserId, businessId: context.businessId, raw: await parseJsonRequest(request) });
    return new Response(jsonSafe(result), { status: result.replayed || result.reused ? 200 : 201, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
