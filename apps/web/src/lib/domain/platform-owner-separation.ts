import { and, eq, isNull } from "drizzle-orm";
import { platformAdmin } from "@/lib/db/schema";
import type { CommercialDatabase } from "./commercial";

/**
 * Séparation stricte du compte de la plateforme et de l'espace commerçant (2026-11-18).
 *
 * Le propriétaire de la plateforme se connecte par `/platform/login`, qui ouvre une session Better Auth
 * ordinaire. Sans ce contrôle, cette session était acceptée par les routes du commerçant : l'assistant
 * d'inscription croyait le compte déjà créé (étape « Compte » sautée) et `POST /api/account/businesses`
 * ouvrait un commerce rattaché au compte Super Admin en consommant le code `QADR-`.
 *
 * Désormais, toute route ou page de l'espace commerçant traite un compte qui détient un droit plateforme actif
 * comme **non connecté** (même 401 qu'une absence de session, rien n'est révélé). Seules les notifications
 * push, partagées avec la console, restent ouvertes à ce compte.
 */
export async function isPlatformOwnerAccount(db: CommercialDatabase, userId: string) {
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin)
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt))).limit(1);
  return !!grant;
}
