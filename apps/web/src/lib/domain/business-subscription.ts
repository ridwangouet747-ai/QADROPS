import { and, desc, eq } from "drizzle-orm";
import { businessProfile, businessSubscription, member, subscriptionPlan } from "../db/schema";
import { hasBusinessPermission } from "../auth/permissions";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { listPayablePlans, openInvoiceSummary, subscriptionPaymentRoles } from "./subscription-billing";
import { businessLifecycle, isInForce, remainingDays } from "./subscription-lifecycle";

/** Rôles autorisés à appliquer un code Qadr Agency (même règle que redeemSubscriptionPromotion). */
export const promotionRedeemRoles = ["owner", "admin"] as const;

/**
 * Espace abonnement du commerçant : état commercial, abonnement en vigueur (ou le dernier connu) et
 * abonnement en attente, toujours lus pour le commerce de la session. Aucun prix interne d'un autre
 * commerce ni aucune information sur les codes n'est renvoyé.
 */
export async function getBusinessSubscriptionOverview(db: Pick<CommercialDatabase, "select">, actorUserId: string, businessId: string, now = new Date(), options: { onlinePayment?: boolean } = {}) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, businessId), eq(member.userId, actorUserId))).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, "business", "read")) throw new CommercialError("Votre rôle ne permet pas de consulter l’abonnement.", 403, "forbidden");
  const [profile] = await db.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).limit(1);
  if (!profile) throw new CommercialError("Commerce introuvable.", 404, "not_found");
  const rows = await db.select({
    id: businessSubscription.id, status: businessSubscription.status, startsAt: businessSubscription.startsAt, endsAt: businessSubscription.endsAt, origin: businessSubscription.origin,
    planCode: subscriptionPlan.code, planName: subscriptionPlan.name, priceXof: subscriptionPlan.priceXof, durationDays: subscriptionPlan.durationDays,
  }).from(businessSubscription).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(eq(businessSubscription.businessId, businessId)).orderBy(desc(businessSubscription.endsAt));
  const inForce = rows.find((row) => isInForce(row, now));
  const shown = inForce ?? rows.find((row) => row.status !== "pending" && row.status !== "canceled");
  const pending = rows.find((row) => row.status === "pending");
  const roles = membership.role.split(",").map((role) => role.trim());
  const canPay = profile.status !== "suspended" && roles.some((role) => (subscriptionPaymentRoles as readonly string[]).includes(role));
  return {
    lifecycle: businessLifecycle(profile.status, rows, now),
    canRedeem: profile.status !== "suspended" && roles.some((role) => (promotionRedeemRoles as readonly string[]).includes(role)),
    // Paiement en ligne GeniusPay (mission 12) : réservé au propriétaire, seulement si le serveur est configuré.
    canPay,
    onlinePayment: options.onlinePayment ?? false,
    plans: await listPayablePlans(db),
    openInvoice: canPay ? await openInvoiceSummary(db, businessId, now) : null,
    subscription: shown ? {
      status: shown.status, inForce: Boolean(inForce), planCode: shown.planCode, planName: shown.planName, origin: shown.origin,
      startsAt: shown.startsAt, endsAt: shown.endsAt, remainingDays: inForce ? remainingDays(shown.endsAt, now) : 0,
    } : null,
    pending: pending ? { id: pending.id, planName: pending.planName, priceXof: pending.priceXof.toString(), durationDays: pending.durationDays } : null,
  };
}
