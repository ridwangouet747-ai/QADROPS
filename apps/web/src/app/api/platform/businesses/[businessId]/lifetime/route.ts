import { grantLifetimeAccess } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ businessId: string }> };

/**
 * Attribution directe d'un accès à vie (docs/lifetime-access.md). Propriétaire de la plateforme seulement
 * (getPlatformContext : session plateforme, origine contrôlée ; tout autre compte reçoit 404). Corps :
 * `{ planId, reason, confirm: true }` ; le type d'accès vient de la formule enregistrée, jamais du corps.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const context = await getPlatformContext(request.headers);
    const { businessId } = await params;
    const result = await grantLifetimeAccess(context.db, context.actorUserId, businessId, await parseJsonRequest(request));
    return new Response(jsonSafe(result), { status: 201, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
