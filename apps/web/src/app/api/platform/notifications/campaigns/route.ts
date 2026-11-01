import { createAnnouncementCampaign } from "@/lib/domain/notifications";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
import { processNotificationsAfterResponse } from "@/lib/notifications/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const campaign = await createAnnouncementCampaign(context.db, context.actorUserId, await parseJsonRequest(request));
    processNotificationsAfterResponse(context.db);
    return Response.json(campaign, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
