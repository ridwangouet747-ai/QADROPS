import { setPromotionStatus } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  try {
    const context = await getPlatformContext(request.headers);
    const { promotionId } = await params;
    return new Response(jsonSafe(await setPromotionStatus(context.db, context.actorUserId, promotionId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
