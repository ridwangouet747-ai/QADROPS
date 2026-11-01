import { unreadNotificationCount } from "@/lib/domain/notifications";
import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const unreadCount = await unreadNotificationCount(context.db, { userId: context.userId, businessId: context.businessId });
    return Response.json({ unreadCount }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
