import { getAuth } from "@/lib/auth/server";
import { errorResponse } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
import { recordPlatformSignOut } from "@/lib/domain/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Déconnexion de la console : trace d'audit puis fin de la session Better Auth (la session plateforme
 * liée disparaît avec elle). Sans session plateforme valide, rien à tracer : la déconnexion ordinaire suffit.
 */
export async function POST(request: Request) {
  try {
    try {
      const context = await getPlatformContext(request.headers);
      if (!context.preview) await recordPlatformSignOut(context.db, context.actorUserId);
    } catch { /* session absente ou expirée : déconnexion simple */ }
    const result = await (await getAuth()).api.signOut({ headers: request.headers, returnHeaders: true });
    const headers = new Headers({ "cache-control": "no-store" });
    for (const cookie of result.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
