import { createPlatformPlan, listPlatformPlans } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
import { invalidatePublicPlans } from "@/lib/domain/public-plans";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const context = await getPlatformContext(request.headers); return new Response(jsonSafe(await listPlatformPlans(context.db, context.actorUserId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const created = await createPlatformPlan(context.db, context.actorUserId, await parseJsonRequest(request));
    // Un forfait publié apparaît sur la page publique dès la visite suivante, sans redéploiement.
    invalidatePublicPlans();
    return new Response(jsonSafe(created), { status: 201, headers: { "content-type": "application/json" } });
  }
  catch (error) { return errorResponse(error); }
}
