import { removePushSubscription } from "@/lib/domain/notifications";
import { errorResponse } from "@/lib/domain/business-context";
import { notificationUser } from "../../user-context";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ subscriptionId: string }> }) {
  try {
    const { db, userId } = await notificationUser(request);
    return Response.json(await removePushSubscription(db, userId, (await params).subscriptionId));
  } catch (error) { return errorResponse(error); }
}
