import { getPlatformSettings } from "@/lib/domain/platform";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    return new Response(jsonSafe(await getPlatformSettings(context.db, context.actorUserId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
