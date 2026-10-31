import { getPlatformOverview } from "@/lib/domain/platform";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const period = new URL(request.url).searchParams.get("period");
    return new Response(jsonSafe(await getPlatformOverview(context.db, context.actorUserId, { periodDays: period })), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
