import { createPublicCampaign, listPublicCampaigns } from "@/lib/domain/public-campaigns";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

/** Campagnes promotionnelles publiques (mission 12) : liste et création, Super Admin uniquement. */
export async function GET(request: Request) {
  try { const context = await getPlatformContext(request.headers); return new Response(jsonSafe(await listPublicCampaigns(context.db, context.actorUserId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { const context = await getPlatformContext(request.headers); return new Response(jsonSafe(await createPublicCampaign(context.db, context.actorUserId, await parseJsonRequest(request))), { status: 201, headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
