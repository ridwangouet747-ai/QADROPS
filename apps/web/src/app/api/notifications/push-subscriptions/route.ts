import { registerPushSubscription } from "@/lib/domain/notifications";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { notificationUser } from "../user-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { db, userId } = await notificationUser(request);
    return Response.json(await registerPushSubscription(db, userId, await parseJsonRequest(request)), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
