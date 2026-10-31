import { randomInt, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvent, businessProfile, businessSubscription, member, organization,
  platformAdmin, promotionCode, promotionEligibleBusiness, promotionRedemption,
  subscriptionPayment, subscriptionPlan, user,
} from "../db/schema";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";
import { readPlanFeatures } from "./plan-limits";
import {
  assertTransition, businessLifecycle, expireDueSubscriptions, isInForce, remainingDays, type BusinessLifecycle,
} from "./subscription-lifecycle";

type PlatformDb = CommercialDatabase;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

async function requirePlatformAdmin(db: PlatformDb, actorUserId: string) {
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(and(
    eq(platformAdmin.userId, actorUserId), isNull(platformAdmin.revokedAt),
  )).limit(1);
  if (!grant) throw new CommercialError("Accès réservé à l’administration de la plateforme.", 403);
}

/**
 * Trace administrative : qui, quoi, quel commerce, avant/après, motif, résultat. Le journal est en ajout
 * seul (déclencheur `audit_event_no_update_delete`, migration 0010).
 */
async function writePlatformAudit(db: PlatformDb, input: {
  actorUserId: string | null; eventType: string; entityType: string; entityId: string;
  businessId?: string | null; before?: Record<string, Json> | null; after?: Record<string, Json> | null;
  reason?: string | null; metadata?: Record<string, Json>;
}) {
  await db.insert(auditEvent).values({
    id: randomUUID(), businessId: null, actorUserId: input.actorUserId,
    eventType: input.eventType, entityType: input.entityType, entityId: input.entityId,
    metadata: {
      ...input.metadata, businessId: input.businessId ?? null, before: input.before ?? null, after: input.after ?? null,
      reason: input.reason ?? null, result: "success",
    },
  });
}

const reasonSchema = z.string().trim().min(5, "Indiquez un motif d’au moins 5 caractères.").max(500);
const dayMs = 86_400_000;

/* ------------------------------------------------------------------ Tableau de bord */

/** Ancienne synthèse (compatibilité API) ; l'écran utilise getPlatformOverview. */
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
    subscriptions: { pending: bySubscription.pending ?? 0, trialing: bySubscription.trialing ?? 0, active: bySubscription.active ?? 0, suspended: bySubscription.suspended ?? 0, expired: bySubscription.expired ?? 0, canceled: bySubscription.canceled ?? 0 },
    trials: { current: Number(trials?.current ?? 0), expired: Number(trials?.expired ?? 0) },
    confirmedSaasPayments: { count: Number(confirmedPayments?.count ?? 0), amountXof: confirmedPayments?.amountXof ?? "0" },
    recentEvents,
    incidents: { available: false, message: "Aucun module d’incidents opérationnels n’est configuré." },
  };
}

export const overviewPeriods = [7, 30, 90] as const;
export type OverviewPeriod = (typeof overviewPeriods)[number];

/** Seaux de dates (jour ou semaine) en UTC, du plus ancien au plus récent, zéros compris. */
export function signupBuckets(createdAt: Date[], periodDays: OverviewPeriod, now = new Date()) {
  const step = periodDays === 90 ? 7 : 1;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + dayMs;
  const buckets = Math.ceil(periodDays / step);
  const series = Array.from({ length: buckets }, (_, index) => ({ start: new Date(end - (buckets - index) * step * dayMs).toISOString(), count: 0 }));
  for (const date of createdAt) {
    const offset = Math.floor((end - date.getTime()) / (step * dayMs));
    const index = buckets - 1 - offset;
    if (index >= 0 && index < buckets) series[index]!.count += 1;
  }
  return { step, series };
}

/** Vue d'ensemble de la console : uniquement des données lues en base, jamais de chiffre estimé. */
export async function getPlatformOverview(db: PlatformDb, actorUserId: string, raw: { periodDays?: unknown } = {}, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const periodDays = (overviewPeriods as readonly number[]).includes(Number(raw.periodDays)) ? Number(raw.periodDays) as OverviewPeriod : 30;
  await expireDueSubscriptions(db, now);
  const since = new Date(now.getTime() - periodDays * dayMs);

  const businesses = await db.select({ businessId: businessProfile.businessId, name: organization.name, activity: businessProfile.activity, status: businessProfile.status, createdAt: organization.createdAt })
    .from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId));
  const subscriptions = await db.select({
    id: businessSubscription.id, businessId: businessSubscription.businessId, status: businessSubscription.status, endsAt: businessSubscription.endsAt,
    planId: businessSubscription.planId, planName: subscriptionPlan.name, origin: businessSubscription.origin,
  }).from(businessSubscription).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId));
  const plans = await db.select({ id: subscriptionPlan.id, name: subscriptionPlan.name, code: subscriptionPlan.code, priceXof: subscriptionPlan.priceXof, durationDays: subscriptionPlan.durationDays, active: subscriptionPlan.active })
    .from(subscriptionPlan).orderBy(asc(subscriptionPlan.priceXof));

  const byBusiness = new Map<string, typeof subscriptions>();
  for (const subscription of subscriptions) byBusiness.set(subscription.businessId, [...(byBusiness.get(subscription.businessId) ?? []), subscription]);
  const states: Record<BusinessLifecycle, number> = { active: 0, trial: 0, suspended: 0, expired: 0, pending: 0 };
  for (const business of businesses) states[businessLifecycle(business.status, byBusiness.get(business.businessId) ?? [], now)] += 1;

  const names = new Map(businesses.map((business) => [business.businessId, business.name]));
  const inForce = subscriptions.filter((item) => isInForce(item, now));
  const soon = new Date(now.getTime() + 7 * dayMs);
  const expiring = inForce.filter((item) => item.endsAt <= soon).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());

  const [payments] = await db.select({
    billed: sql<string>`coalesce(sum(${subscriptionPayment.amountXof}) filter (where ${subscriptionPayment.status} <> 'failed'), 0)::text`,
    collected: sql<string>`coalesce(sum(${subscriptionPayment.amountXof}) filter (where ${subscriptionPayment.status} = 'confirmed'), 0)::text`,
    pending: sql<string>`coalesce(sum(${subscriptionPayment.amountXof}) filter (where ${subscriptionPayment.status} = 'pending'), 0)::text`,
    refunded: sql<string>`coalesce(sum(${subscriptionPayment.amountXof}) filter (where ${subscriptionPayment.status} = 'refunded'), 0)::text`,
    confirmedCount: sql<number>`count(*) filter (where ${subscriptionPayment.status} = 'confirmed')`,
    pendingCount: sql<number>`count(*) filter (where ${subscriptionPayment.status} = 'pending')`,
  }).from(subscriptionPayment).where(gte(subscriptionPayment.occurredAt, since));
  const [benefits] = await db.select({
    discountXof: sql<string>`coalesce(sum(${promotionRedemption.discountAmountXof}), 0)::text`,
    offeredDays: sql<number>`coalesce(sum(${promotionCode.grantDays}) filter (where ${promotionCode.kind} = 'access'), 0)`,
    redemptions: sql<number>`count(*)`,
  }).from(promotionRedemption).innerJoin(promotionCode, eq(promotionCode.id, promotionRedemption.promotionId)).where(gte(promotionRedemption.redeemedAt, since));

  const owners = await ownersOf(db, businesses.map((business) => business.businessId));
  const recentSignups = [...businesses].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 6)
    .map((business) => ({ businessId: business.businessId, name: business.name, activity: business.activity, createdAt: business.createdAt, ownerName: owners.get(business.businessId)?.name ?? null }));
  const audit = await listPlatformAudit(db, actorUserId, { limit: 8 });

  const pendingSubscriptions = subscriptions.filter((item) => item.status === "pending").length;
  const alerts = [
    { kind: "expiring", count: expiring.filter((item) => item.endsAt <= new Date(now.getTime() + 3 * dayMs)).length },
    { kind: "suspended", count: states.suspended },
    { kind: "pendingSubscriptions", count: pendingSubscriptions },
    { kind: "pendingPayments", count: Number(payments?.pendingCount ?? 0) },
  ].filter((alert) => alert.count > 0);

  return {
    periodDays, generatedAt: now.toISOString(),
    businesses: { total: businesses.length, ...states },
    subscriptions: { pending: pendingSubscriptions, expiringSoon: expiring.length, inForce: inForce.length },
    signups: { ...signupBuckets(businesses.map((business) => business.createdAt), periodDays, now), inPeriod: businesses.filter((business) => business.createdAt >= since).length },
    planDistribution: plans.map((plan) => ({ planId: plan.id, name: plan.name, count: inForce.filter((item) => item.planId === plan.id).length })),
    planSummary: plans.map((plan) => ({ ...plan, subscribers: inForce.filter((item) => item.planId === plan.id).length })),
    watchlist: expiring.slice(0, 6).map((item) => ({ subscriptionId: item.id, businessId: item.businessId, businessName: names.get(item.businessId) ?? "—", planName: item.planName, status: item.status, endsAt: item.endsAt, daysLeft: remainingDays(item.endsAt, now) })),
    alerts,
    revenue: {
      billedXof: payments?.billed ?? "0", collectedXof: payments?.collected ?? "0", pendingXof: payments?.pending ?? "0", refundedXof: payments?.refunded ?? "0",
      confirmedPayments: Number(payments?.confirmedCount ?? 0),
      promotionalDiscountXof: benefits?.discountXof ?? "0", offeredDays: Number(benefits?.offeredDays ?? 0), redemptions: Number(benefits?.redemptions ?? 0),
    },
    recentSignups,
    recentOperations: audit.items,
  };
}

/** Premier propriétaire de chaque commerce (nom et e-mail, rien d'autre). */
async function ownersOf(db: PlatformDb, businessIds: string[]) {
  if (!businessIds.length) return new Map<string, { name: string; email: string }>();
  const rows = await db.select({ businessId: member.organizationId, name: user.name, email: user.email, createdAt: member.createdAt })
    .from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(inArray(member.organizationId, businessIds), eq(member.role, "owner"))).orderBy(asc(member.createdAt));
  const owners = new Map<string, { name: string; email: string }>();
  for (const row of rows) if (!owners.has(row.businessId)) owners.set(row.businessId, { name: row.name, email: row.email });
  return owners;
}

/* ------------------------------------------------------------------ Commerces */

const lifecycleFilter = z.enum(["active", "trial", "suspended", "expired", "pending"]);
type BusinessSearch = { search?: string; status?: string; planId?: string };

export async function listPlatformBusinesses(db: PlatformDb, actorUserId: string, filters: BusinessSearch = {}, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const clauses = [];
  if (filters.search?.trim()) {
    const pattern = `%${filters.search.trim().slice(0, 100)}%`;
    const ownerMatch = sql`exists (select 1 from ${member} join ${user} on ${user.id} = ${member.userId} where ${member.organizationId} = ${businessProfile.businessId} and ${member.role} = 'owner' and (${user.email} ilike ${pattern} or ${user.name} ilike ${pattern}))`;
    clauses.push(or(ilike(organization.name, pattern), ilike(businessProfile.businessEmail, pattern), ilike(businessProfile.phone, pattern), ownerMatch)!);
  }
  const rows = await db.select({
    businessId: businessProfile.businessId, name: organization.name, activity: businessProfile.activity,
    status: businessProfile.status, createdAt: organization.createdAt,
  }).from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .where(clauses.length ? and(...clauses) : undefined).orderBy(desc(organization.createdAt)).limit(500);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.businessId);
  const subscriptions = await db.select({
    businessId: businessSubscription.businessId, id: businessSubscription.id,
    status: businessSubscription.status, startsAt: businessSubscription.startsAt,
    endsAt: businessSubscription.endsAt, trialEndsAt: businessSubscription.trialEndsAt,
    planId: subscriptionPlan.id, planName: subscriptionPlan.name, planCode: subscriptionPlan.code,
    createdAt: businessSubscription.createdAt,
  }).from(businessSubscription).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(inArray(businessSubscription.businessId, ids)).orderBy(desc(businessSubscription.createdAt));
  const memberCounts = await db.select({ businessId: member.organizationId, total: count() }).from(member).where(inArray(member.organizationId, ids)).groupBy(member.organizationId);
  const counts = new Map(memberCounts.map((row) => [row.businessId, Number(row.total)]));
  const owners = await ownersOf(db, ids);
  const latest = new Map<string, (typeof subscriptions)[number]>();
  const all = new Map<string, (typeof subscriptions)>();
  for (const subscription of subscriptions) {
    if (!latest.has(subscription.businessId)) latest.set(subscription.businessId, subscription);
    all.set(subscription.businessId, [...(all.get(subscription.businessId) ?? []), subscription]);
  }
  const lifecycle = lifecycleFilter.safeParse(filters.status);
  return rows.map((row) => ({
    ...row, owner: owners.get(row.businessId) ?? null, memberCount: counts.get(row.businessId) ?? 0,
    lifecycle: businessLifecycle(row.status, all.get(row.businessId) ?? [], now), subscription: latest.get(row.businessId) ?? null,
  })).filter((row) => (!lifecycle.success || row.lifecycle === lifecycle.data) && (!filters.planId || row.subscription?.planId === filters.planId));
}

export async function getPlatformBusiness(db: PlatformDb, actorUserId: string, businessId: string, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const [business] = await db.select({
    businessId: businessProfile.businessId, name: organization.name, activity: businessProfile.activity,
    status: businessProfile.status, createdAt: organization.createdAt, phone: businessProfile.phone,
    businessEmail: businessProfile.businessEmail, address: businessProfile.address,
    currency: businessProfile.currency, timezone: businessProfile.timezone, storeFormat: businessProfile.storeFormat,
  }).from(businessProfile).innerJoin(organization, eq(organization.id, businessProfile.businessId))
    .where(eq(businessProfile.businessId, businessId)).limit(1);
  if (!business) throw new CommercialError("Commerce introuvable.", 404);
  const subscriptions = await db.select({
    id: businessSubscription.id, status: businessSubscription.status, startsAt: businessSubscription.startsAt,
    endsAt: businessSubscription.endsAt, trialEndsAt: businessSubscription.trialEndsAt, origin: businessSubscription.origin,
    planName: subscriptionPlan.name, planCode: subscriptionPlan.code,
  }).from(businessSubscription).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(eq(businessSubscription.businessId, businessId)).orderBy(desc(businessSubscription.createdAt));
  const [memberCount] = await db.select({ total: count() }).from(member).where(eq(member.organizationId, businessId));
  const owner = (await ownersOf(db, [businessId])).get(businessId) ?? null;
  const history = await listPlatformAudit(db, actorUserId, { businessId, limit: 50 });
  return {
    ...business, owner, memberCount: Number(memberCount?.total ?? 0), subscriptions,
    lifecycle: businessLifecycle(business.status, subscriptions, now), history: history.items,
  };
}

const businessStatusSchema = z.object({ status: z.enum(["active", "suspended"]), reason: reasonSchema });
/**
 * Suspension ou réactivation d'un commerce, avec motif obligatoire. Les opérations commerciales sont
 * ensuite refusées par assertBusinessOperational ; les abonnements en cours sont suspendus puis
 * rétablis dans leur état antérieur (ou expirés si leur échéance est passée entre-temps).
 */
export async function setPlatformBusinessStatus(db: PlatformDb, actorUserId: string, businessId: string, raw: unknown, now = new Date()) {
  const { status, reason } = businessStatusSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [business] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).for("update").limit(1);
    if (!business) throw new CommercialError("Commerce introuvable.", 404);
    if (status === "suspended" && business.status === "suspended") throw new CommercialError("Ce commerce est déjà suspendu.", 409);
    if (status === "active" && business.status !== "suspended") throw new CommercialError("Seul un commerce suspendu peut être réactivé.", 409);
    await tx.update(businessProfile).set({ status, updatedAt: now }).where(eq(businessProfile.businessId, businessId));
    const affected: string[] = [];
    if (status === "suspended") {
      const running = await tx.select({ id: businessSubscription.id, status: businessSubscription.status }).from(businessSubscription)
        .where(and(eq(businessSubscription.businessId, businessId), inArray(businessSubscription.status, ["trialing", "active"])));
      for (const item of running) {
        await tx.update(businessSubscription).set({ status: "suspended", statusBeforeSuspension: item.status, updatedAt: now }).where(eq(businessSubscription.id, item.id));
        affected.push(item.id);
      }
    } else {
      const suspended = await tx.select({ id: businessSubscription.id, endsAt: businessSubscription.endsAt, before: businessSubscription.statusBeforeSuspension }).from(businessSubscription)
        .where(and(eq(businessSubscription.businessId, businessId), eq(businessSubscription.status, "suspended")));
      for (const item of suspended) {
        const next = item.endsAt > now ? (item.before === "trialing" ? "trialing" : "active") : "expired";
        await tx.update(businessSubscription).set({ status: next, statusBeforeSuspension: null, updatedAt: now }).where(eq(businessSubscription.id, item.id));
        affected.push(item.id);
      }
    }
    await writePlatformAudit(tx as unknown as PlatformDb, {
      actorUserId, eventType: `platform.business_${status}`, entityType: "business", entityId: businessId, businessId,
      before: { status: business.status }, after: { status }, reason, metadata: { subscriptions: affected.length },
    });
    return { businessId, status };
  });
}

/* ------------------------------------------------------------------ Forfaits */

const featureSchema = z.object({
  pos: z.boolean(), reports: z.boolean(), inventory: z.boolean(), procurement: z.boolean(),
  productLimit: z.number().int().positive().max(1_000_000).nullable(),
  userLimit: z.number().int().positive().max(100_000).nullable(),
}).strict();
const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/),
  name: z.string().trim().min(2).max(80), priceXof: z.string().regex(/^(0|[1-9]\d{0,17})$/),
  durationDays: z.number().int().min(1).max(3650), active: z.boolean().default(true), features: featureSchema,
  description: z.string().trim().max(500).nullable().optional(), currency: z.literal("XOF").default("XOF"),
  storageMb: z.number().int().positive().max(10_000_000).nullable().optional(),
}).strict();

export async function listPlatformPlans(db: PlatformDb, actorUserId: string, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const plans = await db.select().from(subscriptionPlan).orderBy(asc(subscriptionPlan.priceXof), asc(subscriptionPlan.name));
  const subscriptions = await db.select({ planId: businessSubscription.planId, status: businessSubscription.status, endsAt: businessSubscription.endsAt }).from(businessSubscription);
  return plans.map((plan) => ({
    ...plan, features: readPlanFeatures(plan.features),
    subscribers: subscriptions.filter((item) => item.planId === plan.id && isInForce(item, now)).length,
    totalSubscriptions: subscriptions.filter((item) => item.planId === plan.id).length,
  }));
}

function planSnapshot(plan: Partial<typeof subscriptionPlan.$inferSelect>) {
  const snapshot: Record<string, Json> = {};
  for (const [key, value] of Object.entries(plan)) {
    if (key === "id" || key === "updatedAt") continue;
    snapshot[key] = typeof value === "bigint" ? value.toString() : (value as Json) ?? null;
  }
  return snapshot;
}

export async function createPlatformPlan(db: PlatformDb, actorUserId: string, raw: unknown) {
  const input = planSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [duplicate] = await tx.select({ id: subscriptionPlan.id }).from(subscriptionPlan).where(eq(subscriptionPlan.code, input.code)).limit(1);
    if (duplicate) throw new CommercialError("Ce code de forfait existe déjà.", 409);
    await tx.insert(subscriptionPlan).values({ ...input, id, priceXof: BigInt(input.priceXof), description: input.description ?? null, storageMb: input.storageMb ?? null });
    await writePlatformAudit(tx as unknown as PlatformDb, {
      actorUserId, eventType: "platform.plan_created", entityType: "subscription_plan", entityId: id,
      after: planSnapshot({ ...input, priceXof: BigInt(input.priceXof) }), metadata: { code: input.code },
    });
  });
  return { id, ...input };
}

export async function updatePlatformPlan(db: PlatformDb, actorUserId: string, id: string, raw: unknown) {
  const input = planSchema.partial().parse(raw);
  if (!Object.keys(input).length) throw new CommercialError("Aucune modification fournie.");
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(subscriptionPlan).where(eq(subscriptionPlan.id, id)).for("update").limit(1);
    if (!current) throw new CommercialError("Forfait introuvable.", 404);
    const values: Partial<typeof subscriptionPlan.$inferInsert> = { updatedAt: new Date() };
    if (input.code !== undefined) values.code = input.code;
    if (input.name !== undefined) values.name = input.name;
    if (input.priceXof !== undefined) values.priceXof = BigInt(input.priceXof);
    if (input.durationDays !== undefined) values.durationDays = input.durationDays;
    if (input.active !== undefined) values.active = input.active;
    if (input.features !== undefined) values.features = input.features;
    if (input.description !== undefined) values.description = input.description;
    if (input.storageMb !== undefined) values.storageMb = input.storageMb;
    await tx.update(subscriptionPlan).set(values).where(eq(subscriptionPlan.id, id));
    const changed = Object.keys(input) as (keyof typeof current)[];
    const before = planSnapshot(Object.fromEntries(changed.map((key) => [key, current[key]])));
    const after = planSnapshot(Object.fromEntries(changed.map((key) => [key, values[key as keyof typeof values]])) as Partial<typeof subscriptionPlan.$inferSelect>);
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId, eventType: "platform.plan_updated", entityType: "subscription_plan", entityId: id, before, after, metadata: { code: current.code } });
    return { id, ...input };
  });
}

/* ------------------------------------------------------------------ Codes promotionnels */

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

export type PromotionState = "revoked" | "paused" | "scheduled" | "expired" | "exhausted" | "active";
export function promotionState(promo: { active: boolean; revokedAt: Date | null; startsAt: Date; endsAt: Date | null; maxRedemptions: number | null }, uses: number, now = new Date()): PromotionState {
  if (promo.revokedAt) return "revoked";
  if (!promo.active) return "paused";
  if (promo.endsAt && promo.endsAt <= now) return "expired";
  if (promo.maxRedemptions !== null && uses >= promo.maxRedemptions) return "exhausted";
  if (promo.startsAt > now) return "scheduled";
  return "active";
}

export async function listPlatformPromotions(db: PlatformDb, actorUserId: string, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const promotions = await db.select({ promo: promotionCode, planName: subscriptionPlan.name }).from(promotionCode)
    .leftJoin(subscriptionPlan, eq(subscriptionPlan.id, promotionCode.planId)).orderBy(desc(promotionCode.createdAt), desc(promotionCode.startsAt));
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
  return promotions.map(({ promo, planName }) => ({
    ...promo, planName, useCount: useCounts.get(promo.id) ?? 0,
    eligibleBusinesses: eligible.filter((item) => item.promotionId === promo.id),
    redemptions: redemptions.filter((item) => item.promotionId === promo.id),
    state: promotionState(promo, useCounts.get(promo.id) ?? 0, now),
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
      maxRedemptions: input.maxRedemptions, active: input.active, kind: "discount", createdByUserId: actorUserId,
    });
    if (eligibleIds.length) await tx.insert(promotionEligibleBusiness).values(eligibleIds.map((businessId) => ({ promotionId: id, businessId })));
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId, eventType: "platform.promotion_created", entityType: "promotion", entityId: id, after: { code: input.code, kind: "discount" }, metadata: { code: input.code, eligibleCount: eligibleIds.length } });
  });
  return { id, code: input.code };
}

export async function updatePlatformPromotion(db: PlatformDb, actorUserId: string, id: string, raw: unknown) {
  const input = promotionSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: promotionCode.id, kind: promotionCode.kind, revokedAt: promotionCode.revokedAt }).from(promotionCode).where(eq(promotionCode.id, id)).limit(1);
    if (!current) throw new CommercialError("Code promotionnel introuvable.", 404);
    if (current.kind !== "discount") throw new CommercialError("Un code d’accès se met en pause ou se révoque ; il ne se modifie pas.", 409);
    if (current.revokedAt) throw new CommercialError("Un code révoqué ne peut plus être modifié.", 409);
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

/** Alphabet sans caractères ambigus (0/O, 1/I/L) : 31 symboles, 12 tirés au hasard ≈ 59 bits d'entropie. */
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generatePromotionCode(prefix = "") {
  const body = Array.from({ length: 12 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join("");
  const grouped = body.match(/.{4}/g)!.join("-");
  return prefix ? `${prefix}-${grouped}` : grouped;
}

export const accessDurations = [7, 21, 30, 90] as const;
const batchSchema = z.object({
  planId: z.string().min(1), grantDays: z.number().int().min(1).max(365),
  quantity: z.number().int().min(1).max(200), prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,8}$/).default(""),
  maxRedemptions: z.number().int().min(1).max(100_000), startsAt: z.string().datetime(), endsAt: z.string().datetime().nullable(),
  eligibleBusinessIds: z.array(z.string().min(1)).max(500).default([]),
  campaign: z.string().trim().min(3, "Indiquez la campagne ou le motif.").max(80), active: z.boolean().default(true),
}).strict().superRefine((data, ctx) => {
  if (data.endsAt && Date.parse(data.endsAt) <= Date.parse(data.startsAt)) ctx.addIssue({ code: "custom", message: "L’expiration doit suivre le début." });
});

/**
 * Génère en série des codes d'accès (forfait + durée offerte), côté serveur uniquement. Les codes sont
 * renvoyés une fois pour être distribués ; le journal ne garde que la campagne et le nombre.
 */
export async function generateAccessCodes(db: PlatformDb, actorUserId: string, raw: unknown) {
  const input = batchSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  const batchId = randomUUID();
  return db.transaction(async (tx) => {
    const [plan] = await tx.select({ id: subscriptionPlan.id, name: subscriptionPlan.name, active: subscriptionPlan.active }).from(subscriptionPlan).where(eq(subscriptionPlan.id, input.planId)).limit(1);
    if (!plan) throw new CommercialError("Forfait introuvable.", 404);
    if (!plan.active) throw new CommercialError("Ce forfait est inactif : aucun code ne peut y donner accès.", 409);
    const eligibleIds = [...new Set(input.eligibleBusinessIds)];
    if (eligibleIds.length) {
      const existing = await tx.select({ businessId: businessProfile.businessId }).from(businessProfile).where(inArray(businessProfile.businessId, eligibleIds));
      if (existing.length !== eligibleIds.length) throw new CommercialError("Un ou plusieurs commerces éligibles sont introuvables.");
    }
    const codes = new Set<string>();
    while (codes.size < input.quantity) codes.add(generatePromotionCode(input.prefix));
    const taken = await tx.select({ code: promotionCode.code }).from(promotionCode).where(inArray(promotionCode.code, [...codes]));
    if (taken.length) throw new CommercialError("Collision de code improbable : relancez la génération.", 409);
    const rows = [...codes].map((code) => ({
      id: randomUUID(), code, kind: "access", planId: plan.id, grantDays: input.grantDays, discountPercent: null, discountXof: null,
      startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null, maxRedemptions: input.maxRedemptions,
      active: input.active, campaign: input.campaign, batchId, createdByUserId: actorUserId,
    }));
    await tx.insert(promotionCode).values(rows);
    if (eligibleIds.length) await tx.insert(promotionEligibleBusiness).values(rows.flatMap((row) => eligibleIds.map((businessId) => ({ promotionId: row.id, businessId }))));
    await writePlatformAudit(tx as unknown as PlatformDb, {
      actorUserId, eventType: "platform.promotion_batch_generated", entityType: "promotion_batch", entityId: batchId,
      after: { planId: plan.id, grantDays: input.grantDays, quantity: input.quantity, maxRedemptions: input.maxRedemptions, eligible: eligibleIds.length },
      reason: input.campaign, metadata: { campaign: input.campaign },
    });
    return { batchId, planName: plan.name, codes: rows.map((row) => ({ id: row.id, code: row.code })) };
  });
}

const promotionStatusSchema = z.object({ action: z.enum(["pause", "resume", "revoke"]), reason: reasonSchema });
export async function setPromotionStatus(db: PlatformDb, actorUserId: string, id: string, raw: unknown) {
  const { action, reason } = promotionStatusSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [promo] = await tx.select({ id: promotionCode.id, code: promotionCode.code, active: promotionCode.active, revokedAt: promotionCode.revokedAt }).from(promotionCode).where(eq(promotionCode.id, id)).for("update").limit(1);
    if (!promo) throw new CommercialError("Code promotionnel introuvable.", 404);
    if (promo.revokedAt) throw new CommercialError("Ce code est déjà révoqué, définitivement.", 409);
    const now = new Date();
    const values = action === "revoke" ? { active: false, revokedAt: now, revokedByUserId: actorUserId, revokeReason: reason } : { active: action === "resume" };
    await tx.update(promotionCode).set(values).where(eq(promotionCode.id, id));
    await writePlatformAudit(tx as unknown as PlatformDb, {
      actorUserId, eventType: { pause: "platform.promotion_paused", resume: "platform.promotion_resumed", revoke: "platform.promotion_revoked" }[action], entityType: "promotion", entityId: id,
      before: { active: promo.active, revoked: false }, after: { active: values.active, revoked: action === "revoke" }, reason, metadata: { code: promo.code },
    });
    return { id, action };
  });
}

/* ------------------------------------------------------------------ Abonnements */

type SubscriptionFilters = { status?: string; search?: string };
export async function listPlatformSubscriptions(db: PlatformDb, actorUserId: string, filters: SubscriptionFilters = {}, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  await expireDueSubscriptions(db, now);
  const clauses = [];
  if (filters.status && ["pending", "trialing", "active", "suspended", "expired", "canceled"].includes(filters.status)) clauses.push(eq(businessSubscription.status, filters.status));
  if (filters.search?.trim()) clauses.push(ilike(organization.name, `%${filters.search.trim().slice(0, 100)}%`));
  const subscriptions = await db.select({
    id: businessSubscription.id, businessId: businessSubscription.businessId, businessName: organization.name,
    businessStatus: businessProfile.status, status: businessSubscription.status, origin: businessSubscription.origin,
    startsAt: businessSubscription.startsAt, endsAt: businessSubscription.endsAt, createdAt: businessSubscription.createdAt,
    trialEndsAt: businessSubscription.trialEndsAt, planId: subscriptionPlan.id, statusBeforeSuspension: businessSubscription.statusBeforeSuspension,
    planName: subscriptionPlan.name, planPriceXof: subscriptionPlan.priceXof, canceledAt: businessSubscription.canceledAt,
  }).from(businessSubscription).innerJoin(organization, eq(organization.id, businessSubscription.businessId))
    .innerJoin(businessProfile, eq(businessProfile.businessId, businessSubscription.businessId))
    .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(clauses.length ? and(...clauses) : undefined).orderBy(desc(businessSubscription.createdAt)).limit(500);
  const payments = await db.select({
    id: subscriptionPayment.id, businessId: subscriptionPayment.businessId, subscriptionId: subscriptionPayment.subscriptionId,
    amountXof: subscriptionPayment.amountXof, method: subscriptionPayment.method, status: subscriptionPayment.status,
    occurredAt: subscriptionPayment.occurredAt, confirmedAt: subscriptionPayment.confirmedAt,
  }).from(subscriptionPayment).orderBy(desc(subscriptionPayment.occurredAt)).limit(500);
  const ids = subscriptions.map((item) => item.id);
  const events = ids.length ? await db.select({ entityId: auditEvent.entityId, eventType: auditEvent.eventType, occurredAt: auditEvent.occurredAt, metadata: auditEvent.metadata })
    .from(auditEvent).where(and(eq(auditEvent.entityType, "subscription"), inArray(auditEvent.entityId, ids))).orderBy(desc(auditEvent.occurredAt)) : [];
  return {
    subscriptions: subscriptions.map((item) => ({
      ...item, remainingDays: isInForce(item, now) ? remainingDays(item.endsAt, now) : 0,
      payments: payments.filter((payment) => payment.subscriptionId === item.id),
      history: events.filter((event) => event.entityId === item.id),
    })),
    payments,
  };
}

const subscriptionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: reasonSchema }),
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(365), reason: reasonSchema }),
]);

/** Actions manuelles : annulation (terminal) ou prolongation d'une période en cours, toujours motivées. */
export async function updatePlatformSubscription(db: PlatformDb, actorUserId: string, subscriptionId: string, raw: unknown, now = new Date()) {
  const input = subscriptionActionSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: businessSubscription.id, businessId: businessSubscription.businessId, status: businessSubscription.status, endsAt: businessSubscription.endsAt, trialEndsAt: businessSubscription.trialEndsAt })
      .from(businessSubscription).where(eq(businessSubscription.id, subscriptionId)).for("update").limit(1);
    if (!current) throw new CommercialError("Abonnement introuvable.", 404);
    if (input.action === "cancel") {
      assertTransition(current.status, "canceled");
      await tx.update(businessSubscription).set({ status: "canceled", canceledAt: now, statusBeforeSuspension: null, updatedAt: now }).where(eq(businessSubscription.id, subscriptionId));
      await writeSubscriptionAudit(tx, actorUserId, current, "platform.subscription_canceled", { status: current.status }, { status: "canceled" }, input.reason);
      return { id: subscriptionId, status: "canceled" };
    }
    if (!isInForce(current, now) && current.status !== "suspended") throw new CommercialError("Seule une période en cours ou suspendue peut être prolongée.", 409);
    const endsAt = new Date(current.endsAt.getTime() + input.days * dayMs);
    const trialEndsAt = current.status === "trialing" && current.trialEndsAt ? new Date(current.trialEndsAt.getTime() + input.days * dayMs) : current.trialEndsAt;
    await tx.update(businessSubscription).set({ endsAt, trialEndsAt, updatedAt: now }).where(eq(businessSubscription.id, subscriptionId));
    await writeSubscriptionAudit(tx, actorUserId, current, "platform.subscription_extended", { endsAt: current.endsAt.toISOString() }, { endsAt: endsAt.toISOString(), days: input.days }, input.reason);
    return { id: subscriptionId, status: current.status, endsAt };
  });
}

async function writeSubscriptionAudit(tx: unknown, actorUserId: string | null, subscription: { id: string; businessId: string }, eventType: string, before: Record<string, Json>, after: Record<string, Json>, reason: string) {
  await (tx as PlatformDb).insert(auditEvent).values({
    id: randomUUID(), businessId: subscription.businessId, actorUserId, eventType, entityType: "subscription", entityId: subscription.id,
    metadata: { businessId: subscription.businessId, before, after, reason, result: "success" },
  });
}

/* ------------------------------------------------------------------ Journal d'audit */

const auditFilterSchema = z.object({
  search: z.string().trim().max(100).optional(), action: z.string().trim().regex(/^[a-z_.]{2,60}$/).optional(),
  businessId: z.string().min(1).max(100).optional(), actorUserId: z.string().min(1).max(100).optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  before: z.string().datetime().optional(), limit: z.number().int().min(1).max(200).default(50),
});

/**
 * Activité de la plateforme : actions des administrateurs (`platform.*`) et événements d'abonnement
 * (`subscription.*`, y compris les expirations automatiques). Paginé par date décroissante.
 */
export async function listPlatformAudit(db: PlatformDb, actorUserId: string, raw: unknown = {}) {
  const filters = auditFilterSchema.parse(raw ?? {});
  await requirePlatformAdmin(db, actorUserId);
  const clauses = [or(and(isNull(auditEvent.businessId), ilike(auditEvent.eventType, "platform.%")), ilike(auditEvent.eventType, "subscription.%"))!];
  if (filters.action) clauses.push(ilike(auditEvent.eventType, `${filters.action}%`));
  if (filters.actorUserId) clauses.push(eq(auditEvent.actorUserId, filters.actorUserId));
  if (filters.businessId) clauses.push(or(eq(auditEvent.businessId, filters.businessId), sql`${auditEvent.metadata}->>'businessId' = ${filters.businessId}`, and(eq(auditEvent.entityType, "business"), eq(auditEvent.entityId, filters.businessId)))!);
  if (filters.from) clauses.push(gte(auditEvent.occurredAt, new Date(filters.from)));
  if (filters.to) clauses.push(lte(auditEvent.occurredAt, new Date(filters.to)));
  if (filters.before) clauses.push(lt(auditEvent.occurredAt, new Date(filters.before)));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    clauses.push(or(ilike(auditEvent.eventType, pattern), ilike(auditEvent.entityId, pattern), ilike(user.name, pattern), ilike(user.email, pattern), sql`${auditEvent.metadata}::text ilike ${pattern}`)!);
  }
  const rows = await db.select({
    id: auditEvent.id, actorUserId: auditEvent.actorUserId, actorName: user.name, actorEmail: user.email, eventType: auditEvent.eventType,
    entityType: auditEvent.entityType, entityId: auditEvent.entityId, metadata: auditEvent.metadata, occurredAt: auditEvent.occurredAt,
    businessId: auditEvent.businessId,
  }).from(auditEvent).leftJoin(user, eq(user.id, auditEvent.actorUserId)).where(and(...clauses))
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id)).limit(filters.limit + 1);
  const page = rows.slice(0, filters.limit);
  const businessIds = [...new Set(page.map((row) => {
    const meta = row.metadata as { businessId?: string | null };
    return row.businessId ?? meta.businessId ?? (row.entityType === "business" ? row.entityId : null);
  }).filter((value): value is string => Boolean(value)))];
  const names = businessIds.length ? new Map((await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, businessIds))).map((row) => [row.id, row.name])) : new Map<string, string>();
  return {
    items: page.map((row) => {
      const meta = row.metadata as { businessId?: string | null; before?: Json; after?: Json; reason?: string | null; result?: string };
      const businessId = row.businessId ?? meta.businessId ?? (row.entityType === "business" ? row.entityId : null);
      return {
        id: row.id, eventType: row.eventType, entityType: row.entityType, entityId: row.entityId, occurredAt: row.occurredAt,
        actor: row.actorUserId ? { id: row.actorUserId, name: row.actorName, email: row.actorEmail } : null,
        businessId, businessName: businessId ? names.get(businessId) ?? null : null,
        before: meta.before ?? null, after: meta.after ?? null, reason: meta.reason ?? null, result: meta.result ?? "success",
      };
    }),
    nextBefore: rows.length > filters.limit ? page.at(-1)!.occurredAt.toISOString() : null,
  };
}

/* ------------------------------------------------------------------ Paramètres et habilitations */

/** Administrateurs de la plateforme (lecture seule ici : l'attribution passe par scripts/platform-admin.ts). */
export async function getPlatformSettings(db: PlatformDb, actorUserId: string) {
  await requirePlatformAdmin(db, actorUserId);
  const admins = await db.select({ userId: platformAdmin.userId, name: user.name, email: user.email, grantedAt: platformAdmin.createdAt, revokedAt: platformAdmin.revokedAt, grantedByUserId: platformAdmin.grantedByUserId })
    .from(platformAdmin).innerJoin(user, eq(user.id, platformAdmin.userId)).orderBy(asc(platformAdmin.createdAt));
  const self = admins.find((admin) => admin.userId === actorUserId) ?? null;
  return { self, admins };
}

const grantSchema = z.object({ email: z.email().max(254), reason: reasonSchema, grantedByUserId: z.string().min(1).nullable() });
/**
 * Attribution d'un droit Super Admin : uniquement depuis la procédure en ligne de commande
 * (scripts/platform-admin.ts), jamais par une route HTTP ni par un rôle de commerce.
 */
export async function grantPlatformAdmin(db: PlatformDb, raw: unknown) {
  const input = grantSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id, emailVerified: user.emailVerified }).from(user).where(sql`lower(${user.email}) = ${input.email.toLowerCase()}`).limit(1);
    if (!target) throw new CommercialError("Aucun compte avec cette adresse : il doit d’abord s’inscrire.", 404);
    if (input.grantedByUserId) await requirePlatformAdmin(tx as unknown as PlatformDb, input.grantedByUserId);
    const [existing] = await tx.select({ revokedAt: platformAdmin.revokedAt }).from(platformAdmin).where(eq(platformAdmin.userId, target.id)).limit(1);
    if (existing && !existing.revokedAt) throw new CommercialError("Ce compte est déjà administrateur de la plateforme.", 409);
    if (existing) await tx.update(platformAdmin).set({ revokedAt: null, grantedByUserId: input.grantedByUserId, createdAt: new Date() }).where(eq(platformAdmin.userId, target.id));
    else await tx.insert(platformAdmin).values({ userId: target.id, grantedByUserId: input.grantedByUserId });
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId: input.grantedByUserId, eventType: "platform.admin_granted", entityType: "user", entityId: target.id, before: { admin: false }, after: { admin: true }, reason: input.reason });
    return { userId: target.id };
  });
}

export async function revokePlatformAdmin(db: PlatformDb, raw: unknown) {
  const input = grantSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${input.email.toLowerCase()}`).limit(1);
    if (!target) throw new CommercialError("Compte introuvable.", 404);
    const [grant] = await tx.select({ revokedAt: platformAdmin.revokedAt }).from(platformAdmin).where(eq(platformAdmin.userId, target.id)).limit(1);
    if (!grant || grant.revokedAt) throw new CommercialError("Ce compte n’est pas administrateur de la plateforme.", 409);
    const [others] = await tx.select({ total: count() }).from(platformAdmin).where(and(isNull(platformAdmin.revokedAt), sql`${platformAdmin.userId} <> ${target.id}`));
    if (!Number(others?.total ?? 0)) throw new CommercialError("Impossible de retirer le dernier administrateur de la plateforme.", 409);
    await tx.update(platformAdmin).set({ revokedAt: new Date() }).where(eq(platformAdmin.userId, target.id));
    await writePlatformAudit(tx as unknown as PlatformDb, { actorUserId: input.grantedByUserId, eventType: "platform.admin_revoked", entityType: "user", entityId: target.id, before: { admin: true }, after: { admin: false }, reason: input.reason });
    return { userId: target.id };
  });
}

/* ------------------------------------------------------------------ Code saisi par un commerce */

const redeemSchema = z.object({ code: z.string().trim().toUpperCase().min(3).max(40), subscriptionId: z.string().min(1).optional() }).strict();

/**
 * Application d'un code par le propriétaire ou l'administrateur d'un commerce. Atomique (verrou sur le
 * code), une seule fois par commerce (contrainte unique), idempotente (un nouvel envoi renvoie le
 * résultat initial), tracée. Un code d'accès ouvre une période d'essai sans paiement : un commerce
 * sans abonnement ou en attente peut donc démarrer sans cercle vicieux.
 */
export async function redeemSubscriptionPromotion(db: PlatformDb, actorUserId: string, businessId: string, raw: unknown, now = new Date()) {
  const input = redeemSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(eq(member.organizationId, businessId), eq(member.userId, actorUserId))).limit(1);
    if (!membership || !["owner", "admin"].includes(membership.role)) throw new CommercialError("Seul l’administrateur du commerce peut utiliser ce code.", 403);
    const [profile] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).for("update").limit(1);
    if (!profile) throw new CommercialError("Commerce introuvable.", 404);
    if (profile.status === "suspended") throw new CommercialError("Ce commerce est suspendu : contactez Qadr Agency.", 403);
    const [promo] = await tx.select().from(promotionCode).where(eq(promotionCode.code, input.code)).for("update").limit(1);
    if (!promo) throw new CommercialError("Code promotionnel invalide.", 404);

    // Rejeu : le même commerce renvoie le même code, on rend le résultat déjà enregistré.
    const [previous] = await tx.select().from(promotionRedemption).where(and(eq(promotionRedemption.promotionId, promo.id), eq(promotionRedemption.businessId, businessId))).limit(1);
    if (previous) return redemptionResult(tx, promo, previous, true);

    if (promo.revokedAt) throw new CommercialError("Ce code a été révoqué.");
    if (!promo.active || promo.startsAt > now || (promo.endsAt && promo.endsAt <= now)) throw new CommercialError("Ce code n’est pas actuellement valide.");
    const [eligible] = await tx.select({ businessId: promotionEligibleBusiness.businessId }).from(promotionEligibleBusiness)
      .where(eq(promotionEligibleBusiness.promotionId, promo.id)).limit(1);
    if (eligible) {
      const [match] = await tx.select({ businessId: promotionEligibleBusiness.businessId }).from(promotionEligibleBusiness)
        .where(and(eq(promotionEligibleBusiness.promotionId, promo.id), eq(promotionEligibleBusiness.businessId, businessId))).limit(1);
      if (!match) throw new CommercialError("Ce code n’est pas disponible pour ce commerce.", 403);
    }
    const [used] = await tx.select({ total: count() }).from(promotionRedemption).where(eq(promotionRedemption.promotionId, promo.id));
    if (promo.maxRedemptions !== null && Number(used?.total ?? 0) >= promo.maxRedemptions) throw new CommercialError("La limite d’utilisation de ce code est atteinte.");

    if (promo.kind === "access") return applyAccessCode(tx as unknown as PlatformDb, promo, businessId, actorUserId, profile.status, now);

    const [subscription] = input.subscriptionId ? await tx.select({ id: businessSubscription.id, planId: businessSubscription.planId, status: businessSubscription.status })
      .from(businessSubscription).where(and(eq(businessSubscription.businessId, businessId), eq(businessSubscription.id, input.subscriptionId))).for("update").limit(1) : [];
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
      entityType: "promotion_redemption", entityId: redemptionId, metadata: { businessId, code: promo.code, discountAmountXof: discount.toString(), amountDueXof: amountDue.toString(), result: "success" } });
    return { kind: "discount" as const, replayed: false, redemptionId, discountAmountXof: discount.toString(), amountDueXof: amountDue.toString(), paymentStatus: amountDue > 0n ? "pending" : "no_payment_due" };
  });
}

type PromotionRow = typeof promotionCode.$inferSelect;

async function redemptionResult(tx: unknown, promo: PromotionRow, redemption: typeof promotionRedemption.$inferSelect, replayed: boolean) {
  if (promo.kind === "access") {
    const [subscription] = await (tx as PlatformDb).select({ id: businessSubscription.id, status: businessSubscription.status, endsAt: businessSubscription.endsAt })
      .from(businessSubscription).where(eq(businessSubscription.id, redemption.subscriptionId)).limit(1);
    return { kind: "access" as const, replayed, redemptionId: redemption.id, subscriptionId: redemption.subscriptionId, status: subscription?.status ?? null, endsAt: subscription?.endsAt ?? null, grantDays: promo.grantDays };
  }
  const [payment] = await (tx as PlatformDb).select({ amountXof: subscriptionPayment.amountXof }).from(subscriptionPayment)
    .where(and(eq(subscriptionPayment.businessId, redemption.businessId), eq(subscriptionPayment.idempotencyKey, `promotion:${redemption.id}`))).limit(1);
  const due = payment ? BigInt(payment.amountXof) : 0n;
  return { kind: "discount" as const, replayed, redemptionId: redemption.id, discountAmountXof: redemption.discountAmountXof.toString(), amountDueXof: due.toString(), paymentStatus: due > 0n ? "pending" : "no_payment_due" };
}

async function applyAccessCode(tx: PlatformDb, promo: PromotionRow, businessId: string, actorUserId: string, profileStatus: string, now: Date) {
  const days = promo.grantDays!;
  const subscriptions = await tx.select({ id: businessSubscription.id, planId: businessSubscription.planId, status: businessSubscription.status, endsAt: businessSubscription.endsAt, trialEndsAt: businessSubscription.trialEndsAt })
    .from(businessSubscription).where(eq(businessSubscription.businessId, businessId)).for("update");
  const running = subscriptions.filter((item) => isInForce(item, now)).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  const pending = subscriptions.find((item) => item.status === "pending");
  let subscriptionId: string;
  let before: Record<string, Json>;
  let after: Record<string, Json>;
  if (running) {
    if (running.planId !== promo.planId) throw new CommercialError("Un abonnement à un autre forfait est en cours : ce code ne peut pas s’y ajouter.", 409);
    const endsAt = new Date(running.endsAt.getTime() + days * dayMs);
    const trialEndsAt = running.status === "trialing" ? endsAt : running.trialEndsAt;
    await tx.update(businessSubscription).set({ endsAt, trialEndsAt, updatedAt: now }).where(eq(businessSubscription.id, running.id));
    subscriptionId = running.id;
    before = { status: running.status, endsAt: running.endsAt.toISOString() };
    after = { status: running.status, endsAt: endsAt.toISOString() };
  } else {
    const endsAt = new Date(now.getTime() + days * dayMs);
    if (pending) {
      assertTransition(pending.status, "trialing");
      await tx.update(businessSubscription).set({ status: "trialing", planId: promo.planId!, startsAt: now, endsAt, trialEndsAt: endsAt, origin: "promotion", updatedAt: now }).where(eq(businessSubscription.id, pending.id));
      subscriptionId = pending.id;
      before = { status: "pending" };
    } else {
      subscriptionId = randomUUID();
      await tx.insert(businessSubscription).values({ id: subscriptionId, businessId, planId: promo.planId!, status: "trialing", startsAt: now, endsAt, trialEndsAt: endsAt, origin: "promotion" });
      before = { status: null };
    }
    after = { status: "trialing", endsAt: endsAt.toISOString() };
    if (profileStatus === "expired") await tx.update(businessProfile).set({ status: "active", updatedAt: now }).where(eq(businessProfile.businessId, businessId));
  }
  const redemptionId = randomUUID();
  await tx.insert(promotionRedemption).values({ id: redemptionId, promotionId: promo.id, businessId, subscriptionId, codeSnapshot: promo.code, discountAmountXof: 0n });
  await tx.insert(auditEvent).values({
    id: randomUUID(), businessId, actorUserId, eventType: "subscription.access_code_redeemed", entityType: "subscription", entityId: subscriptionId,
    metadata: { businessId, code: promo.code, grantDays: days, before, after, result: "success", reason: promo.campaign ?? null },
  });
  const [subscription] = await tx.select({ status: businessSubscription.status, endsAt: businessSubscription.endsAt }).from(businessSubscription).where(eq(businessSubscription.id, subscriptionId)).limit(1);
  return { kind: "access" as const, replayed: false, redemptionId, subscriptionId, status: subscription!.status, endsAt: subscription!.endsAt, grantDays: days };
}
