import { getBillingProvider } from "@/lib/billing";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";
import { getSubscriptionPaymentStatus } from "@/lib/domain/subscription-billing";

export const runtime = "nodejs";

/** État d'un paiement d'abonnement du commerce actif ; un paiement encore ouvert est revérifié chez GeniusPay. */
export async function GET(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { attemptId } = await params;
    const result = await getSubscriptionPaymentStatus(context.db, getBillingProvider(), { actorUserId: context.actorUserId, businessId: context.businessId, attemptId });
    return new Response(jsonSafe(result), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
