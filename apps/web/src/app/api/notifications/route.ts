import { listNotifications } from "@/lib/domain/notifications";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Notifications de la personne connectée, pour le commerce actif (et ses notifications personnelles). */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return new Response(jsonSafe(await listNotifications(context.db, { userId: context.userId, businessId: context.businessId }, query)),
      { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
