import { redeemSubscriptionPromotion } from "@/lib/domain/platform";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const context = await getBusinessContext(request.headers); return new Response(jsonSafe(await redeemSubscriptionPromotion(context.db, context.actorUserId, context.businessId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
