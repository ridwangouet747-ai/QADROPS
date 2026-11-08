import { claimPushEndpoint } from "@/lib/domain/notifications";
import { getAccountContext } from "@/lib/domain/account-context";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/**
 * Mission 13 : au chargement de l'application, le navigateur présente l'adresse push qu'il détient.
 * Elle est rattachée à la session courante si elle appartient à ce compte ; sinon elle est coupée et le
 * navigateur se désabonne (voir `claimPushEndpoint`). Seule la session compte, avec ou sans commerce actif.
 */
export async function POST(request: Request) {
  try {
    const { db, userId, sessionId } = await getAccountContext(request.headers);
    return Response.json(await claimPushEndpoint(db, { userId, sessionId }, await parseJsonRequest(request)), { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
