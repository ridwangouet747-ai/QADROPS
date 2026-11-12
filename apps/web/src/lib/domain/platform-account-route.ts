import { getAuth, type QadrAuth } from "../auth/server";
import { platformRequestSecret } from "../auth/platform-request";
import { errorResponse } from "./business-context";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { getPlatformContext } from "./platform-context";

type OwnerSelf = { userId: string; sessionId: string; secret: string };

/**
 * Enveloppe commune aux routes `/api/platform/account/*` (nom d'utilisateur, mot de passe du propriétaire).
 * `getPlatformContext` contrôle l'origine, le droit actif et la session plateforme. En aperçu local, il n'y
 * a pas de vrai compte : la route le dit au lieu de faire semblant.
 */
export async function ownerAccountRoute(request: Request, change: (auth: QadrAuth, db: CommercialDatabase, self: OwnerSelf, body: unknown) => Promise<unknown>) {
  try {
    const context = await getPlatformContext(request.headers);
    if (context.preview || !context.sessionId) {
      throw new CommercialError("Indisponible en aperçu local : ce compte de démonstration n’a ni nom d’utilisateur ni mot de passe.", 409, "preview_unavailable");
    }
    const body = await request.json().catch(() => null);
    const result = await change(await getAuth(), context.db, { userId: context.actorUserId, sessionId: context.sessionId, secret: platformRequestSecret() }, body);
    return Response.json({ ok: true, ...(result as object) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
