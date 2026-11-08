import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "../auth/server";
import { getDatabase } from "../db/client";
import { platformAdmin } from "../db/schema";
import type { CommercialDatabase } from "./commercial";
import { BusinessContextError } from "./business-context";
import { hasActivePlatformSession } from "./platform-auth";

/** Le compte a le droit, mais sa session plateforme manque ou a expiré : se reconnecter (/platform/login). */
export class PlatformReauthRequired extends BusinessContextError {
  readonly code = "platform_reauth_required";
  constructor() { super("Reconnectez-vous à l’espace d’administration.", 401); }
}

export async function getPlatformContext(headers: Headers): Promise<{ db: CommercialDatabase; actorUserId: string; preview: boolean; sessionId: string | null }> {
  if (process.env.QADR_PREVIEW_MODE === "true") {
    if (process.env.NODE_ENV !== "development") throw new BusinessContextError("La prévisualisation plateforme est réservée au développement local.", 403);
    const { getPreviewDatabase, previewIdentity } = await import("../preview/database");
    return { db: await getPreviewDatabase() as unknown as CommercialDatabase, actorUserId: previewIdentity.platformUserId, preview: true, sessionId: null };
  }

  const session = await (await getAuth()).api.getSession({ headers });
  if (!session) throw new BusinessContextError("Authentification requise.", 401);
  const db = getDatabase();
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(and(
    eq(platformAdmin.userId, session.user.id), isNull(platformAdmin.revokedAt),
  )).limit(1);
  if (!grant) throw new BusinessContextError("Accès réservé à l’administration de la plateforme.", 404);
  // Mission 13 : seule une session ouverte par la connexion dédiée du propriétaire, et récente, ouvre la console.
  if (!(await hasActivePlatformSession(db as unknown as CommercialDatabase, session.session.id, session.user.id))) throw new PlatformReauthRequired();
  return { db: db as unknown as CommercialDatabase, actorUserId: session.user.id, preview: false, sessionId: session.session.id };
}
