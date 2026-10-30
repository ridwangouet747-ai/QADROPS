import { getPlatformBusiness, setPlatformBusinessStatus } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ businessId: string }> };
export async function GET(request: Request, { params }: RouteContext) {
  try { const context = await getPlatformContext(request.headers); const { businessId } = await params; return new Response(jsonSafe(await getPlatformBusiness(context.db, context.actorUserId, businessId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: RouteContext) {
  try { const context = await getPlatformContext(request.headers); const { businessId } = await params; return new Response(jsonSafe(await setPlatformBusinessStatus(context.db, context.actorUserId, businessId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
