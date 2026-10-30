import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvent, businessProfile, businessSubscription, member, organization,
  platformAdmin, promotionCode, promotionEligibleBusiness, promotionRedemption,
  subscriptionPayment, subscriptionPlan,
} from "../db/schema";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";

type PlatformDb = CommercialDatabase;

async function requirePlatformAdmin(db: PlatformDb, actorUserId: string) {
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(and(
    eq(platformAdmin.userId, actorUserId), isNull(platformAdmin.revokedAt),
  )).limit(1);
  if (!grant) throw new CommercialError("Accès réservé à l’administration de la plateforme.", 403);
}

async function writePlatformAudit(db: PlatformDb, input: { actorUserId: string; eventType: string; entityType: string; entityId: string; metadata?: Record<string, string | number | boolean | null> }) {
  await db.insert(auditEvent).values({
    id: randomUUID(), businessId: null, actorUserId: input.actorUserId,
    eventType: input.eventType, entityType: input.entityType, entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}

export async function getPlatformDashboard(db: PlatformDb, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  const businessCounts = await db.select({ status: businessProfile.status, total: count() }).from(businessProfile).groupBy(businessProfile.status);
  const subscriptionCounts = await db.select({ status: businessSubscription.status, total: count() }).from(businessSubscription).groupBy(businessSubscription.status);
  const now = new Date();
  const [trials] = await db.select({
    current: sql<number>`count(*) filter (where ${businessSubscription.trialEndsAt} > ${now})`,
    expired: sql<number>`count(*) filter (where ${businessSubscription.trialEndsAt} <= ${now})`,
  }).from(businessSubscription).where(sql`${businessSubscription.trialEndsAt} is not null`);
  const [confirmedPayments] = await db.select({
    count: sql<number>`count(*)`,
    amountXof: sql<string>`coalesce(sum(${subscriptionPayment.amountXof}), 0)::text`,
  }).from(subscriptionPayment).where(eq(subscriptionPayment.status, "confirmed"));
  const recentEvents = await db.select({
    id: auditEvent.id, eventType: auditEvent.eventType, entityType: auditEvent.entityType,
    entityId: auditEvent.entityId, occurredAt: auditEvent.occurredAt,
  }).from(auditEvent).where(and(isNull(auditEvent.businessId), ilike(auditEvent.eventType, "platform.%")))
    .orderBy(desc(auditEvent.occurredAt)).limit(8);

  const byBusiness = Object.fromEntries(businessCounts.map((item) => [item.status, Number(item.total)]));
  const bySubscription = Object.fromEntries(subscriptionCounts.map((item) => [item.status, Number(item.total)]));
  return {
    businesses: { total: Object.values(byBusiness).reduce((sum, value) => sum + value, 0), active: byBusiness.active ?? 0, suspended: byBusiness.suspended ?? 0, pending: byBusiness.pending ?? 0, expired: byBusiness.expired ?? 0 },
    subscriptions: { pending: bySubscription.pending ?? 0, active: bySubscription.active ?? 0, suspended: bySubscription.suspended ?? 0, expired: bySubscription.expired ?? 0, canceled: bySubscription.canceled ?? 0 },
    trials: { current: Number(trials?.current ?? 0), expired: Number(trials?.expired ?? 0) },
    confirmedSaasPayments: { count: Number(confirmedPayments?.count ?? 0), amountXof: confirmedPayments?.amountXof ?? "0" },
    recentEvents,
    incidents: { available: false, message: "Aucun module d’incidents opérationnels n’est configuré." },
  };
}

type BusinessSearch = { search?: string; status?: string };
export async function listPlatformBusinesses(db: PlatformDb, actorUserId: string, filters: BusinessSearch = {}) {
  await requirePlatformAdmin(db, actorUserId);
  const clauses = [];
  if (filters.status && ["active", "suspended", "pending", "expired"].includes(filters.status)) clauses.push(eq(businessProfile.status, filters.status));
  if (filters.search?.trim()) {
    const pattern = `%${filters.search.trim().slice(0, 100)}%`;
    clauses.push(or(ilike(organization.name, pattern), ilike(businessProfile.businessEmail, pattern), ilike(businessProfile.phone, pattern))!);
  }
  const rows = await db.select({
    businessId: businessProfile.businessId, name: organization.name, activity: businessProfile.activity,
    status: businessProfile.status, createdAt: organization.createdAt,
  }).from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .where(clauses.length ? and(...clauses) : undefined).orderBy(asc(organization.name)).limit(300);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.businessId);
  const subscriptions = await db.select({
    businessId: businessSubscription.businessId, id: businessSubscription.id,
    status: businessSubscription.status, startsAt: businessSubscription.startsAt,
    endsAt: businessSubscription.endsAt, trialEndsAt: businessSubscription.trialEndsAt,
    planName: subscriptionPlan.name, planCode: subscriptionPlan.code,
    createdAt: businessSubscription.createdAt,
  }).from(businessSubscription).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(inArray(businessSubscription.businessId, ids)).orderBy(desc(businessSubscription.createdAt));
  const latest = new Map<string, (typeof subscriptions)[number]>();
  for (const subscription of subscriptions) if (!latest.has(subscription.businessId)) latest.set(subscription.businessId, subscription);
  return rows.map((row) => ({ ...row, subscription: latest.get(row.businessId) ?? null }));
}

export async function getPlatformBusiness(db: PlatformDb, actorUserId: string, businessId: string) {
  await requirePlatformAdmin(db, actorUserId);
  const [business] = await db.select({
    businessId: businessProfile.businessId, name: organization.name, activity: businessProfile.activity,
    status: businessProfile.status, createdAt: organization.createdAt, phone: businessProfile.phone,
    businessEmail: businessProfile.businessEmail, address: businessProfile.address,
    currency: businessProfile.currency, timezone: businessProfile.timezone,
  }).from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .where(eq(businessProfile.businessId, businessId)).limit(1);
  if (!business) throw new CommercialError("Commerce introuvable.", 404);
  const subscriptions = await db.select({
    id: businessSubscription.id, status: businessSubscription.status, startsAt: businessSubscription.startsAt,
    endsAt: businessSubscription.endsAt, trialEndsAt: businessSubscription.trialEndsAt,
    planName: subscriptionPlan.name, planCode: subscriptionPlan.code,
  }).from(businessSubscription).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(eq(businessSubscription.businessId, businessId)).orderBy(desc(businessSubscription.createdAt));
  const [memberCount] = await db.select({ total: count() }).from(member).where(eq(member.organizationId, businessId));
  return { ...business, memberCount: Number(memberCount?.total ?? 0), subscriptions };
}

const businessStatusSchema = z.object({ status: z.enum(["active", "suspended"]) });
export async function setPlatformBusinessStatus(db: PlatformDb, actorUserId: string, businessId: string, raw: unknown) {
  const { status } = businessStatusSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [business] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).limit(1);
    if (!business) throw new CommercialError("Commerce introuvable.", 404);
    await tx.update(businessProfile).set({ status, updatedAt: new Date() }).where(eq(businessProfile.businessId, businessId));
    if (status === "suspended") {
      await tx.update(businessSubscription).set({ status: "suspended" }).where(and(eq(businessSubscription.businessId, businessId), eq(businessSubscription.status, "active")));
    } else {
      const now = new Date();
      await tx.update(businessSubscription).set({ status: "active" }).where(and(eq(businessSubscription.businessId, businessId), eq(businessSubscription.status, "suspended"), gte(businessSubscription.endsAt, now)));
      await tx.update(businessSubscription).set({ status: "expired" }).where(and(eq(businessSubscription.businessId, businessId), eq(businessSubscription.status, "suspended"), lte(businessSubscription.endsAt, now)));
    }
    await writePlatformAudit(tx as unknown as PlatformDb, {
      actorUserId, eventType: `platform.business_${status}`, entityType: "business", entityId: businessId,
      metadata: { previousStatus: business.status, newStatus: status },
    });
    return { businessId, status };
  });
}

const featureSchema = z.object({
  pos: z.boolean(), reports: z.boolean(), inventory: z.boolean(), procurement: z.boolean(),
  productLimit: z.number().int().positive().max(1_000_000).nullable(),
  userLimit: z.number().int().positive().max(100_000).nullable(),
}).strict();
const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/),
  name: z.string().trim().min(2).max(80), priceXof: z.string().regex(/^(0|[1-9]\d{0,17})$/),
  durationDays: z.number().int().min(1).max(3650), active: z.boolean().default(true), features: featureSchema,
}).strict();

export async function listPlatformPlans(db: PlatformDb, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  return db.select().from(subscriptionPlan).orderBy(asc(subscriptionPlan.priceXof), asc(subscriptionPlan.name));
}
export async function createPlatformPlan(db: PlatformDb, actorUserId: string, raw: unknown) {
  const input = planSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(subscriptionPlan).values({ ...input, id, priceXof: BigInt(input.priceXof) });
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId, eventType: "platform.plan_created", entityType: "subscription_plan", entityId: id, metadata: { code: input.code } });
  });
  return { id, ...input };
}
export async function updatePlatformPlan(db: PlatformDb, actorUserId: string, id: string, raw: unknown) {
  const input = planSchema.partial().parse(raw);
  if (!Object.keys(input).length) throw new CommercialError("Aucune modification fournie.");
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: subscriptionPlan.id }).from(subscriptionPlan).where(eq(subscriptionPlan.id, id)).limit(1);
    if (!current) throw new CommercialError("Forfait introuvable.", 404);
    const values: Partial<typeof subscriptionPlan.$inferInsert> = {};
    if (input.code !== undefined) values.code = input.code;
    if (input.name !== undefined) values.name = input.name;
    if (input.priceXof !== undefined) values.priceXof = BigInt(input.priceXof);
    if (input.durationDays !== undefined) values.durationDays = input.durationDays;
    if (input.active !== undefined) values.active = input.active;
    if (input.features !== undefined) values.features = input.features;
    await tx.update(subscriptionPlan).set(values).where(eq(subscriptionPlan.id, id));
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId, eventType: "platform.plan_updated", entityType: "subscription_plan", entityId: id, metadata: { changedFields: Object.keys(input).join(",") } });
    return { id, ...input };
  });
}

const promotionSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
  discountPercent: z.number().int().min(1).max(100).nullable(),
  discountXof: z.string().regex(/^[1-9]\d{0,17}$/).nullable(),
  startsAt: z.string().datetime(), endsAt: z.string().datetime().nullable(),
  maxRedemptions: z.number().int().positive().max(1_000_000).nullable(), active: z.boolean(),
  eligibleBusinessIds: z.array(z.string().min(1)).max(500),
}).strict().superRefine((data, ctx) => {
  if ((data.discountPercent === null) === (data.discountXof === null)) ctx.addIssue({ code: "custom", message: "Choisissez un pourcentage ou une réduction fixe." });
  if (data.endsAt && Date.parse(data.endsAt) <= Date.parse(data.startsAt)) ctx.addIssue({ code: "custom", message: "La fin doit être postérieure au début." });
});

export async function listPlatformPromotions(db: PlatformDb, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  const promotions = await db.select().from(promotionCode).orderBy(desc(promotionCode.startsAt));
  const redemptions = await db.select({
    id: promotionRedemption.id, promotionId: promotionRedemption.promotionId,
    businessId: promotionRedemption.businessId, businessName: organization.name,
    codeSnapshot: promotionRedemption.codeSnapshot, discountAmountXof: promotionRedemption.discountAmountXof,
    redeemedAt: promotionRedemption.redeemedAt,
  }).from(promotionRedemption).innerJoin(organization, eq(organization.id, promotionRedemption.businessId)).orderBy(desc(promotionRedemption.redeemedAt));
  const eligible = await db.select({ promotionId: promotionEligibleBusiness.promotionId, businessId: promotionEligibleBusiness.businessId, businessName: organization.name })
    .from(promotionEligibleBusiness).innerJoin(organization, eq(organization.id, promotionEligibleBusiness.businessId));
  const useCounts = new Map<string, number>();
  for (const redemption of redemptions) useCounts.set(redemption.promotionId, (useCounts.get(redemption.promotionId) ?? 0) + 1);
  const now = new Date();
  return promotions.map((promo) => ({
    ...promo, useCount: useCounts.get(promo.id) ?? 0,
    eligibleBusinesses: eligible.filter((item) => item.promotionId === promo.id),
    redemptions: redemptions.filter((item) => item.promotionId === promo.id),
    state: !promo.active ? "disabled" : promo.endsAt && promo.endsAt <= now ? "expired" : promo.startsAt > now ? "scheduled" : "active",
    stacking: false as const,
  }));
}

export async function createPlatformPromotion(db: PlatformDb, actorUserId: string, raw: unknown) {
  const input = promotionSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const eligibleIds = [...new Set(input.eligibleBusinessIds)];
    if (eligibleIds.length) {
      const existing = await tx.select({ businessId: businessProfile.businessId }).from(businessProfile).where(inArray(businessProfile.businessId, eligibleIds));
      if (existing.length !== eligibleIds.length) throw new CommercialError("Un ou plusieurs commerces éligibles sont introuvables.");
    }
    await tx.insert(promotionCode).values({
      id, code: input.code, discountPercent: input.discountPercent,
      discountXof: input.discountXof === null ? null : BigInt(input.discountXof),
      startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null,
      maxRedemptions: input.maxRedemptions, active: input.active,
    });
    if (eligibleIds.length) await tx.insert(promotionEligibleBusiness).values(eligibleIds.map((businessId) => ({ promotionId: id, businessId })));
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId, eventType: "platform.promotion_created", entityType: "promotion", entityId: id, metadata: { code: input.code, eligibleCount: eligibleIds.length } });
  });
  return { id, code: input.code };
}

export async function updatePlatformPromotion(db: PlatformDb, actorUserId: string, id: string, raw: unknown) {
  const input = promotionSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: promotionCode.id }).from(promotionCode).where(eq(promotionCode.id, id)).limit(1);
    if (!current) throw new CommercialError("Code promotionnel introuvable.", 404);
    const { eligibleBusinessIds, ...fields } = input;
    const uniqueIds = [...new Set(eligibleBusinessIds)];
    if (uniqueIds.length) {
      const existing = await tx.select({ businessId: businessProfile.businessId }).from(businessProfile).where(inArray(businessProfile.businessId, uniqueIds));
      if (existing.length !== uniqueIds.length) throw new CommercialError("Un ou plusieurs commerces éligibles sont introuvables.");
    }
    await tx.delete(promotionEligibleBusiness).where(eq(promotionEligibleBusiness.promotionId, id));
    if (uniqueIds.length) await tx.insert(promotionEligibleBusiness).values(uniqueIds.map((businessId) => ({ promotionId: id, businessId })));
    const values: Partial<typeof promotionCode.$inferInsert> = {};
    values.code = fields.code;
    values.discountPercent = fields.discountPercent;
    values.discountXof = fields.discountXof === null ? null : BigInt(fields.discountXof);
    values.startsAt = new Date(fields.startsAt);
    values.endsAt = fields.endsAt ? new Date(fields.endsAt) : null;
    values.maxRedemptions = fields.maxRedemptions;
    values.active = fields.active;
    await tx.update(promotionCode).set(values).where(eq(promotionCode.id, id));
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId, eventType: "platform.promotion_updated", entityType: "promotion", entityId: id, metadata: { changedFields: Object.keys(input).join(",") } });
    return { id };
  });
}

export async function listPlatformSubscriptions(db: PlatformDb, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  const subscriptions = await db.select({
    id: businessSubscription.id, businessId: businessSubscription.businessId, businessName: organization.name,
    businessStatus: businessProfile.status, status: businessSubscription.status,
    startsAt: businessSubscription.startsAt, endsAt: businessSubscription.endsAt,
    trialEndsAt: businessSubscription.trialEndsAt, planId: subscriptionPlan.id,
    planName: subscriptionPlan.name, planPriceXof: subscriptionPlan.priceXof,
  }).from(businessSubscription).innerJoin(organization, eq(organization.id, businessSubscription.businessId))
    .innerJoin(businessProfile, eq(businessProfile.businessId, businessSubscription.businessId))
    .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId)).orderBy(desc(businessSubscription.createdAt)).limit(500);
  const payments = await db.select({
    id: subscriptionPayment.id, businessId: subscriptionPayment.businessId, subscriptionId: subscriptionPayment.subscriptionId,
    amountXof: subscriptionPayment.amountXof, method: subscriptionPayment.method, status: subscriptionPayment.status,
    occurredAt: subscriptionPayment.occurredAt, confirmedAt: subscriptionPayment.confirmedAt,
  }).from(subscriptionPayment).orderBy(desc(subscriptionPayment.occurredAt)).limit(500);
  return { subscriptions: subscriptions.map((item) => ({ ...item, payments: payments.filter((payment) => payment.subscriptionId === item.id) })), payments };
}

export async function listPlatformAudit(db: PlatformDb, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  return db.select({ id: auditEvent.id, actorUserId: auditEvent.actorUserId, eventType: auditEvent.eventType,
    entityType: auditEvent.entityType, entityId: auditEvent.entityId, metadata: auditEvent.metadata,
    occurredAt: auditEvent.occurredAt,
  }).from(auditEvent).where(isNull(auditEvent.businessId)).orderBy(desc(auditEvent.occurredAt)).limit(300);
}

const redeemSchema = z.object({ code: z.string().trim().toUpperCase().min(3).max(40), subscriptionId: z.string().min(1) }).strict();
export async function redeemSubscriptionPromotion(db: PlatformDb, actorUserId: string, businessId: string, raw: unknown) {
  const input = redeemSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(eq(member.organizationId, businessId), eq(member.userId, actorUserId))).limit(1);
    if (!membership || !["owner", "admin"].includes(membership.role)) throw new CommercialError("Seul l’administrateur du commerce peut utiliser ce code.", 403);
    const [promo] = await tx.select().from(promotionCode).where(eq(promotionCode.code, input.code)).for("update").limit(1);
    if (!promo) throw new CommercialError("Code promotionnel invalide.", 404);
    const now = new Date();
    if (!promo.active || promo.startsAt > now || (promo.endsAt && promo.endsAt <= now)) throw new CommercialError("Ce code n’est pas actuellement valide.");
    const [eligible] = await tx.select({ businessId: promotionEligibleBusiness.businessId }).from(promotionEligibleBusiness)
      .where(eq(promotionEligibleBusiness.promotionId, promo.id)).limit(1);
    if (eligible) {
      const [match] = await tx.select({ businessId: promotionEligibleBusiness.businessId }).from(promotionEligibleBusiness)
        .where(and(eq(promotionEligibleBusiness.promotionId, promo.id), eq(promotionEligibleBusiness.businessId, businessId))).limit(1);
      if (!match) throw new CommercialError("Ce code n’est pas disponible pour ce commerce.", 403);
    }
    const used = await tx.select({ id: promotionRedemption.id, businessId: promotionRedemption.businessId }).from(promotionRedemption).where(eq(promotionRedemption.promotionId, promo.id));
    if (used.some((item) => item.businessId === businessId)) throw new CommercialError("Ce commerce a déjà utilisé ce code.", 409);
    if (promo.maxRedemptions !== null && used.length >= promo.maxRedemptions) throw new CommercialError("La limite d’utilisation de ce code est atteinte.");
    const [subscription] = await tx.select({ id: businessSubscription.id, planId: businessSubscription.planId, status: businessSubscription.status })
      .from(businessSubscription).where(and(eq(businessSubscription.businessId, businessId), eq(businessSubscription.id, input.subscriptionId))).for("update").limit(1);
    if (!subscription || subscription.status !== "pending") throw new CommercialError("Le code s’applique uniquement à un abonnement en attente.");
    const [plan] = await tx.select({ priceXof: subscriptionPlan.priceXof }).from(subscriptionPlan).where(eq(subscriptionPlan.id, subscription.planId)).limit(1);
    if (!plan) throw new CommercialError("Forfait introuvable.", 404);
    const price = BigInt(plan.priceXof);
    const rawDiscount = promo.discountPercent !== null
      ? (price * BigInt(promo.discountPercent) + 50n) / 100n
      : BigInt(promo.discountXof ?? 0);
    const discount = rawDiscount > price ? price : rawDiscount;
    const redemptionId = randomUUID();
    await tx.insert(promotionRedemption).values({
      id: redemptionId, promotionId: promo.id, businessId, subscriptionId: subscription.id,
      codeSnapshot: promo.code, discountAmountXof: discount,
    });
    const amountDue = price - discount;
    if (amountDue > 0n) await tx.insert(subscriptionPayment).values({
      id: randomUUID(), businessId, subscriptionId: subscription.id, amountXof: amountDue,
      method: "other", status: "pending", idempotencyKey: `promotion:${redemptionId}`,
    });
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId, actorUserId, eventType: "subscription.promotion_redeemed",
      entityType: "promotion_redemption", entityId: redemptionId, metadata: { code: promo.code, discountAmountXof: discount.toString(), amountDueXof: amountDue.toString() } });
    return { redemptionId, discountAmountXof: discount.toString(), amountDueXof: amountDue.toString(), paymentStatus: amountDue > 0n ? "pending" : "no_payment_due" };
  });
}
