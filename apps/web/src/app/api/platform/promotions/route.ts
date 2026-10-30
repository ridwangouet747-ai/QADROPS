import { createPlatformPromotion, listPlatformPromotions } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const context = await getPlatformContext(request.headers); return new Response(jsonSafe(await listPlatformPromotions(context.db, context.actorUserId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { const context = await getPlatformContext(request.headers); return new Response(jsonSafe(await createPlatformPromotion(context.db, context.actorUserId, await parseJsonRequest(request))), { status: 201, headers: { "content-type": "application/json" } }); }
  catch (error) { return errorResponse(error); }
}
