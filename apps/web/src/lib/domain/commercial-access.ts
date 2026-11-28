import { eq } from "drizzle-orm";
import { businessProfile, businessSubscription } from "@/lib/db/schema";
import type { CommercialDatabase } from "./commercial";
import { businessLifecycle, subscriptionTermsColumns, type BusinessLifecycle } from "./subscription-lifecycle";

/**
 * Accès commercial d'un commerce (mission CTO du 2026-11-14) : un commerce qui n'a encore jamais eu de droit
 * d'usage (aucun abonnement, ou seulement « en attente » ou annulé) n'ouvre pas son espace de gestion.
 * Seuls restent ouverts le suivi de l'abonnement (formules, paiement, code d'accès), les notifications et
 * l'export de ses données.
 *
 * Un droit d'usage naît d'un paiement confirmé par le serveur (GeniusPay relu), d'un code d'accès ou d'essai
 * valide, ou d'un abonnement accordé par la plateforme. Un commerce déjà ouvert puis expiré ou suspendu garde
 * la lecture de son historique ; ses écritures restent refusées par `assertBusinessOperational`.
 */
export type CommercialAccess = { lifecycle: BusinessLifecycle; open: boolean };

export function accessFromLifecycle(lifecycle: BusinessLifecycle): CommercialAccess {
  return { lifecycle, open: lifecycle !== "pending" };
}

export async function commercialAccess(db: Pick<CommercialDatabase, "select">, businessId: string, now = new Date()): Promise<CommercialAccess> {
  const [[profile], subscriptions] = await Promise.all([
    db.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).limit(1),
    db.select(subscriptionTermsColumns).from(businessSubscription)
      .where(eq(businessSubscription.businessId, businessId)),
  ]);
  return accessFromLifecycle(businessLifecycle(profile?.status ?? "active", subscriptions, now));
}

export const subscriptionRequired = {
  error: "Ce commerce n’a pas encore d’abonnement actif. Choisissez une formule ou saisissez un code d’accès.",
  code: "subscription_required",
} as const;
