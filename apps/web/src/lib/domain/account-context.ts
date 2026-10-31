import { getAuth, type QadrAuth } from "@/lib/auth/server";
import { createDatabase } from "@/lib/db/client";
import { BusinessContextError } from "./business-context";
import type { CommercialDatabase } from "./commercial";

/** Contexte d'un utilisateur connecté, avec ou sans commerce actif (onboarding, invitations, sélection). */
export async function getAccountContext(headers: Headers): Promise<{ auth: QadrAuth; db: CommercialDatabase; userId: string; email: string; emailVerified: boolean; activeBusinessId: string | null }> {
  const preview = process.env.QADR_PREVIEW_MODE === "true";
  if (preview && process.env.NODE_ENV !== "development") throw new BusinessContextError("La prévisualisation locale est désactivée hors développement.", 403);
  const auth = await getAuth();
  const current = await auth.api.getSession({ headers });
  if (!current) throw new BusinessContextError("Authentification requise.", 401);
  const db = preview ? await (await import("@/lib/preview/database")).getPreviewDatabase() as unknown as CommercialDatabase : createDatabase();
  return { auth, db, userId: current.user.id, email: current.user.email, emailVerified: current.user.emailVerified, activeBusinessId: current.session.activeOrganizationId ?? null };
}
