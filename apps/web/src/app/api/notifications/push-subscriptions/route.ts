import { forgetPushEndpoint, registerPushSubscription } from "@/lib/domain/notifications";
import { getAccountContext } from "@/lib/domain/account-context";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { notificationUser } from "../user-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { db, userId, sessionId } = await notificationUser(request);
    return Response.json(await registerPushSubscription(db, { userId, sessionId }, await parseJsonRequest(request)), { status: 201 });
  } catch (error) { return errorResponse(error); }
}

/** Déconnexion : oublie l'adresse push de ce navigateur. Seule la session compte (avec ou sans commerce actif). */
export async function DELETE(request: Request) {
  try {
    const { db, userId } = await getAccountContext(request.headers, { allowPlatformOwner: true });
    return Response.json(await forgetPushEndpoint(db, userId, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
