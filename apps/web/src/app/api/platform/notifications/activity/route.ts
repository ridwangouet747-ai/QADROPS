import { getNotificationActivity, processNotificationOutbox } from "@/lib/domain/notifications";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
import { pushSenderFromEnvironment } from "@/lib/notifications/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    return new Response(jsonSafe(await getNotificationActivity(context.db, context.actorUserId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** Traitement immédiat déclenché depuis la console (sans tâche planifiée, par exemple en aperçu). */
export async function POST(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    await getNotificationActivity(context.db, context.actorUserId); // vérifie le droit Super Admin
    return Response.json(await processNotificationOutbox(context.db, { sender: pushSenderFromEnvironment(), limit: 50 }));
  } catch (error) { return errorResponse(error); }
}
