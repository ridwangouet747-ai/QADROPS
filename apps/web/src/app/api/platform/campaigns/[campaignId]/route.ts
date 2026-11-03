import { getPublicCampaign, updatePublicCampaign } from "@/lib/domain/public-campaigns";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

/** Fiche d'une campagne publique (compteur et réclamations) et modification, Super Admin uniquement. */
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try { const context = await getPlatformContext(request.headers); const { campaignId } = await params; return new Response(jsonSafe(await getPublicCampaign(context.db, context.actorUserId, campaignId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try { const context = await getPlatformContext(request.headers); const { campaignId } = await params; return new Response(jsonSafe(await updatePublicCampaign(context.db, context.actorUserId, campaignId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
