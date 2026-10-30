import { updatePlatformPromotion } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  try { const context = await getPlatformContext(request.headers); const { promotionId } = await params; return new Response(jsonSafe(await updatePlatformPromotion(context.db, context.actorUserId, promotionId, await parseJsonRequest(request))), { headers: { "content-type": "application/json" } }); }
  catch (error) { return errorResponse(error); }
}
