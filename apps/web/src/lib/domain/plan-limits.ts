import { and, count, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { businessMemberAccess, invitation, member, product, subscriptionPlan } from "../db/schema";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";
import { currentSubscription } from "./subscription-lifecycle";

type Reader = Pick<CommercialDatabase, "select">;

/** Fonctionnalités et limites d'un forfait (colonne `features`). `null` = illimité. */
export type PlanFeatures = { pos: boolean; reports: boolean; inventory: boolean; procurement: boolean; productLimit: number | null; userLimit: number | null };

export function readPlanFeatures(raw: unknown): PlanFeatures {
  const value = (raw ?? {}) as Partial<PlanFeatures>;
  const limit = (input: unknown) => (typeof input === "number" && Number.isInteger(input) && input > 0 ? input : null);
  return {
    pos: value.pos !== false, reports: value.reports !== false, inventory: value.inventory !== false, procurement: value.procurement !== false,
    productLimit: limit(value.productLimit), userLimit: limit(value.userLimit),
  };
}

/**
 * Limites du forfait en vigueur. Sans abonnement en cours, aucune limite de forfait ne s'applique :
 * la politique des commerces sans abonnement n'est pas encore tranchée (voir CLAUDE.md).
 */
export async function activePlanLimits(db: Reader, businessId: string, now = new Date()) {
  const current = await currentSubscription(db, businessId, now);
  if (!current) return null;
  const [plan] = await db.select({ name: subscriptionPlan.name, features: subscriptionPlan.features }).from(subscriptionPlan).where(eq(subscriptionPlan.id, current.planId)).limit(1);
  return plan ? { planName: plan.name, ...readPlanFeatures(plan.features) } : null;
}

/** Utilisateurs comptés : membres non désactivés + invitations encore valables (places réservées). */
export async function countSeats(db: Reader, businessId: string, now = new Date()) {
  const [members] = await db.select({ total: count() }).from(member)
    .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId), isNotNull(businessMemberAccess.disabledAt)))
    .where(and(eq(member.organizationId, businessId), isNull(businessMemberAccess.userId)));
  const [pending] = await db.select({ total: count() }).from(invitation)
    .where(and(eq(invitation.organizationId, businessId), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)));
  return Number(members?.total ?? 0) + Number(pending?.total ?? 0);
}

/** Refuse côté serveur une invitation ou un produit au-delà de la limite du forfait en vigueur. */
export async function assertPlanQuota(db: Reader, businessId: string, kind: "users" | "products", now = new Date()) {
  const limits = await activePlanLimits(db, businessId, now);
  if (!limits) return;
  if (kind === "users" && limits.userLimit !== null && await countSeats(db, businessId, now) >= limits.userLimit) {
    throw new CommercialError(`Le forfait ${limits.planName} autorise ${limits.userLimit} utilisateurs (invitations en attente comprises).`, 403);
  }
  if (kind === "products" && limits.productLimit !== null) {
    const [products] = await db.select({ total: count() }).from(product).where(and(eq(product.businessId, businessId), isNull(product.archivedAt)));
    if (Number(products?.total ?? 0) >= limits.productLimit) {
      throw new CommercialError(`Le forfait ${limits.planName} autorise ${limits.productLimit} produits actifs.`, 403);
    }
  }
}
