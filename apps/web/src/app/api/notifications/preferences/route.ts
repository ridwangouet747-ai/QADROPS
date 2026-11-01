import { getNotificationPreferences, updateNotificationPreferences } from "@/lib/domain/notifications";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { notificationUser } from "../user-context";

export const runtime = "nodejs";

const headers = { "content-type": "application/json", "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try { const { db, userId } = await notificationUser(request); return new Response(jsonSafe(await getNotificationPreferences(db, userId)), { headers }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try { const { db, userId } = await notificationUser(request); return new Response(jsonSafe(await updateNotificationPreferences(db, userId, await parseJsonRequest(request))), { headers }); }
  catch (error) { return errorResponse(error); }
}
