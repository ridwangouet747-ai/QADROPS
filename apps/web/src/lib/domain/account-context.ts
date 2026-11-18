import { getAuth, type QadrAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/db/client";
import { assertTrustedOrigin, BusinessContextError } from "./business-context";
import type { CommercialDatabase } from "./commercial";
import { isPlatformOwnerAccount } from "./platform-owner-separation";

/**
 * Contexte d'un utilisateur connecté, avec ou sans commerce actif (onboarding, invitations, sélection).
 *
 * Un compte qui détient le droit plateforme est traité comme non connecté (401, comme sans session) : il n'a
 * pas d'espace commerçant (platform-owner-separation.ts). `allowPlatformOwner` n'est passé que par les routes
 * partagées avec la console (notifications push).
 */
export async function getAccountContext(headers: Headers, options: { allowPlatformOwner?: boolean } = {}): Promise<{ auth: QadrAuth; db: CommercialDatabase; userId: string; email: string | null; username: string | null; emailVerified: boolean; activeBusinessId: string | null; sessionId: string }> {
  assertTrustedOrigin(headers);
  const preview = process.env.QADR_PREVIEW_MODE === "true";
  if (preview && process.env.NODE_ENV !== "development") throw new BusinessContextError("La prévisualisation locale est désactivée hors développement.", 403);
  const auth = await getAuth();
  const current = await auth.api.getSession({ headers });
  if (!current) throw new BusinessContextError("Authentification requise.", 401);
  const db = preview ? await (await import("@/lib/preview/database")).getPreviewDatabase() as unknown as CommercialDatabase : getDatabase();
  if (!options.allowPlatformOwner && await isPlatformOwnerAccount(db, current.user.id)) throw new BusinessContextError("Authentification requise.", 401);
  return { auth, db, userId: current.user.id, email: current.user.email ?? null, username: (current.user as { username?: string | null }).username ?? null, emailVerified: current.user.emailVerified, activeBusinessId: current.session.activeOrganizationId ?? null, sessionId: current.session.id };
}
