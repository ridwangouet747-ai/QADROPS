import { setPublicCampaignStatus } from "@/lib/domain/public-campaigns";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

/** Pause, reprise ou révocation motivée d'une campagne publique, Super Admin uniquement. */
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try { const context = await getPlatformContext(request.headers); const { campaignId } = await params; return new Response(jsonSafe(await setPublicCampaignStatus(context.db, context.actorUserId, campaignId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
