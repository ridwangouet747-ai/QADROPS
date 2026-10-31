import { listPlatformBusinesses } from "@/lib/domain/platform";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const params = new URL(request.url).searchParams;
    const filters = { search: params.get("q") ?? undefined, status: params.get("status") ?? undefined, planId: params.get("plan") ?? undefined };
    return new Response(jsonSafe(await listPlatformBusinesses(context.db, context.actorUserId, filters)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
