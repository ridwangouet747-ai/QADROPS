import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "../auth/server";
import { createDatabase } from "../db/client";
import { platformAdmin } from "../db/schema";
import type { CommercialDatabase } from "./commercial";
import { BusinessContextError } from "./business-context";

export async function getPlatformContext(headers: Headers): Promise<{ db: CommercialDatabase; actorUserId: string; preview: boolean }> {
  if (process.env.QADR_PREVIEW_MODE === "true") {
    if (process.env.NODE_ENV !== "development") throw new BusinessContextError("La prévisualisation plateforme est réservée au développement local.", 403);
    const { getPreviewDatabase, previewIdentity } = await import("../preview/database");
    return { db: await getPreviewDatabase() as unknown as CommercialDatabase, actorUserId: previewIdentity.platformUserId, preview: true };
  }

  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new BusinessContextError("Authentification requise.", 401);
  const db = createDatabase();
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(and(
    eq(platformAdmin.userId, session.user.id), isNull(platformAdmin.revokedAt),
  )).limit(1);
  if (!grant) throw new BusinessContextError("Accès réservé à l’administration de la plateforme.", 404);
  return { db: db as unknown as CommercialDatabase, actorUserId: session.user.id, preview: false };
}
