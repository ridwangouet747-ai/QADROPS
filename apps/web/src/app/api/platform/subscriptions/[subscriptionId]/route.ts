import { updatePlatformSubscription } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ subscriptionId: string }> }) {
  try {
    const context = await getPlatformContext(request.headers);
    const { subscriptionId } = await params;
    return new Response(jsonSafe(await updatePlatformSubscription(context.db, context.actorUserId, subscriptionId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
