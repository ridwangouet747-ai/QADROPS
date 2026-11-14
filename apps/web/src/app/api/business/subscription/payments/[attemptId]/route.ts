import { getBillingProvider } from "@/lib/billing";
import { assertTrustedOrigin, errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";
import { getSubscriptionPaymentStatus, refreshSubscriptionPayment } from "@/lib/domain/subscription-billing";

export const runtime = "nodejs";

type Context = { params: Promise<{ attemptId: string }> };
const headers = { "content-type": "application/json", "cache-control": "private, no-store" };

/** État ENREGISTRÉ d'un paiement d'abonnement du commerce actif. Lecture seule : ni appel à GeniusPay, ni écriture. */
export async function GET(request: Request, { params }: Context) {
  try {
    const context = await getBusinessContext(request.headers, { allowWithoutSubscription: true });
    const { attemptId } = await params;
    const result = await getSubscriptionPaymentStatus(context.db, { actorUserId: context.actorUserId, businessId: context.businessId, attemptId });
    return new Response(jsonSafe(result), { headers });
  } catch (error) { return errorResponse(error); }
}

/**
 * Relit chez GeniusPay un paiement encore ouvert et applique le résultat (page de retour). Propriétaire seulement,
 * sans corps ; l'activation ne vient que de la relecture `GET /payments/{reference}`, jamais de la redirection.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    // Contrôle d'origine avec la méthode : la règle `Sec-Fetch-Site` des écritures s'ajoute à celle de `Origin`.
    assertTrustedOrigin(request.headers, request.method);
    const context = await getBusinessContext(request.headers, { allowWithoutSubscription: true });
    const { attemptId } = await params;
    const result = await refreshSubscriptionPayment(context.db, getBillingProvider(), { actorUserId: context.actorUserId, businessId: context.businessId, attemptId });
    return new Response(jsonSafe(result), { headers });
  } catch (error) { return errorResponse(error); }
}
