import { setCampaignStatus } from "@/lib/domain/notifications";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const context = await getPlatformContext(request.headers);
    return Response.json(await setCampaignStatus(context.db, context.actorUserId, (await params).campaignId, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
