import { processNotificationOutbox, sendTestNotification } from "@/lib/domain/notifications";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
import { pushSenderFromEnvironment } from "@/lib/notifications/server";

export const runtime = "nodejs";

/** Envoie le modèle à l'administrateur lui-même (ses appareils abonnés) et renvoie le résultat réel du traitement. */
export async function POST(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const body = await parseJsonRequest(request);
    await sendTestNotification(context.db, context.actorUserId, String(body.key ?? ""));
    return Response.json(await processNotificationOutbox(context.db, { sender: pushSenderFromEnvironment(), limit: 5 }));
  } catch (error) { return errorResponse(error); }
}
