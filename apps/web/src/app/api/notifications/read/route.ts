import { markNotificationsRead } from "@/lib/domain/notifications";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return Response.json(await markNotificationsRead(context.db, { userId: context.userId, businessId: context.businessId }, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
