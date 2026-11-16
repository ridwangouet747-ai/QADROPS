import { and, desc, eq } from "drizzle-orm";
import { businessProfile, businessSubscription, member, subscriptionPlan } from "../db/schema";
import { hasBusinessPermission } from "../auth/permissions";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { availableCampaignDiscount, invoicePricing, listPayablePlans, openInvoiceSummary, subscriptionPaymentRoles } from "./subscription-billing";
import { businessLifecycle, isInForce, remainingDays } from "./subscription-lifecycle";

/** Rôles autorisés à appliquer un code Qadr Agency (même règle que redeemSubscriptionPromotion). */
export const promotionRedeemRoles = ["owner", "admin"] as const;

/**
 * Espace abonnement du commerçant : état commercial, abonnement en vigueur (ou le dernier connu) et
 * abonnement en attente, toujours lus pour le commerce de la session. Aucun prix interne d'un autre
 * commerce ni aucune information sur les codes n'est renvoyé.
 */
export async function getBusinessSubscriptionOverview(db: Pick<CommercialDatabase, "select">, actorUserId: string, businessId: string, now = new Date(), options: { onlinePayment?: boolean; commercialMode?: "manual_code" | "geniuspay"; whatsapp?: string | null } = {}) {
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
  const plans = await listPayablePlans(db);
  // Remise de la campagne choisie à l'inscription, calculée par le serveur comme sur la facture (jamais dans le navigateur).
  const discount = canPay ? await availableCampaignDiscount(db, businessId) : null;
  const discountPlan = discount ? plans.find((plan) => plan.code === discount.planCode) : undefined;
  const discountPricing = discount && discountPlan ? invoicePricing({ id: discount.planId, priceXof: BigInt(discountPlan.priceXof) }, discount) : null;
  return {
    lifecycle: businessLifecycle(profile.status, rows, now),
    canRedeem: profile.status !== "suspended" && roles.some((role) => (promotionRedeemRoles as readonly string[]).includes(role)),
    // Paiement en ligne GeniusPay (mission 12) : réservé au propriétaire, seulement si le serveur est configuré.
    canPay,
    onlinePayment: options.onlinePayment ?? false,
    // Mode de commercialisation (2026-11-16) : en `manual_code`, le renouvellement passe par Qadr Agency puis un code.
    commercialMode: options.commercialMode ?? "manual_code",
    // Numéro WhatsApp PUBLIC de Qadr Agency (configuration serveur), ou null : jamais de numéro inventé.
    contact: { whatsapp: options.whatsapp ?? null },
    plans,
    campaignDiscount: discountPricing && discountPlan ? { planCode: discountPlan.code, discountXof: discountPricing.discountXof.toString(), amountXof: discountPricing.amountXof.toString() } : null,
    openInvoice: canPay ? await openInvoiceSummary(db, businessId, now) : null,
    subscription: shown ? {
      status: shown.status, inForce: Boolean(inForce), planCode: shown.planCode, planName: shown.planName, origin: shown.origin,
      startsAt: shown.startsAt, endsAt: shown.endsAt, remainingDays: inForce ? remainingDays(shown.endsAt, now) : 0,
    } : null,
    pending: pending ? { id: pending.id, planName: pending.planName, priceXof: pending.priceXof.toString(), durationDays: pending.durationDays,
      // Montant réellement dû quand la remise de campagne porte sur cette formule (même calcul que la facture).
      amountDueXof: discountPricing && discountPlan?.code === pending.planCode ? discountPricing.amountXof.toString() : pending.priceXof.toString() } : null,
  };
}
