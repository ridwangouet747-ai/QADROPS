import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  auditEvent, businessProfile, businessSubscription, commercialAccessCode, member, organization, subscriptionPlan, user,
} from "../db/schema";
import { accessCodeFamilyOf, accessCodeHint, generateAccessCode, hashAccessCode, normalizeAccessCode } from "../security/access-codes";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";
import { requirePlatformAdmin, writePlatformAudit } from "./platform";
import { assertTransition, isInForce } from "./subscription-lifecycle";

/**
 * Codes d'accès commerciaux (2026-11-16, docs/commercial-access-codes.md).
 *
 * Parcours : le client paie hors ligne → le propriétaire de la plateforme vérifie le paiement et génère un code
 * (formule, durée, date limite d'activation) → le client saisit le code (page /redeem-code), crée son compte puis
 * son commerce → le code est consommé dans la MÊME transaction que la création de l'abonnement.
 *
 * Règles :
 * - deux dates distinctes : la date limite d'activation (au-delà, le code est expiré) et la durée d'accès, qui ne
 *   court qu'à partir de l'activation ;
 * - un mois est un mois du calendrier (31 janvier + 1 mois = 28 ou 29 février), jamais 30 jours ;
 * - renouvellement : un abonnement en cours de la même formule est prolongé à partir de SA fin (jamais raccourci) ;
 *   sans abonnement en cours, la période commence à l'activation ;
 * - le code n'est jamais consommé si l'abonnement n'a pas pu être accordé (même transaction) ;
 * - famille distincte des codes promotionnels et des codes d'invitation d'employés (empreintes séparées).
 */

type Db = CommercialDatabase;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const commercialDurations = {
  d7: { unit: "day", value: 7 },
  d21: { unit: "day", value: 21 },
  m1: { unit: "month", value: 1 },
  m3: { unit: "month", value: 3 },
} as const;
export type CommercialDurationKey = keyof typeof commercialDurations;
export type DurationUnit = "day" | "month";

export const DEFAULT_ACTIVATION_DAYS = 30;
export const MAX_CODES_PER_BATCH = 20;
const dayMs = 86_400_000;

/** Ajoute une durée en UTC ; les mois suivent le calendrier et retombent sur le dernier jour s'il manque. */
export function addAccessDuration(start: Date, unit: DurationUnit, value: number) {
  if (unit === "day") return new Date(start.getTime() + value * dayMs);
  const result = new Date(start.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + value);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export type CommercialCodeState = "unused" | "used" | "expired" | "revoked";

export function commercialCodeState(row: { consumedAt: Date | null; revokedAt: Date | null; activationDeadline: Date }, now = new Date()): CommercialCodeState {
  if (row.consumedAt) return "used";
  if (row.revokedAt) return "revoked";
  if (row.activationDeadline <= now) return "expired";
  return "unused";
}

/* ------------------------------------------------------------------ Console de la plateforme */

const generateSchema = z.object({
  planId: z.string().min(1).max(100),
  duration: z.enum(["d7", "d21", "m1", "m3", "custom"]),
  customDays: z.number().int().min(1).max(365).optional(),
  activationDays: z.number().int().min(1).max(180).default(DEFAULT_ACTIVATION_DAYS),
  /** Confirmation explicite : un code ne se crée qu'après la vérification d'un paiement. */
  paymentVerified: z.literal(true, { error: "Confirmez que le paiement a été vérifié." }),
  note: z.string().trim().max(200).optional().transform((value) => value || null),
  quantity: z.number().int().min(1).max(MAX_CODES_PER_BATCH).default(1),
}).refine((value) => value.duration !== "custom" || value.customDays !== undefined, { message: "Indiquez le nombre de jours.", path: ["customDays"] });

export async function generateCommercialAccessCodes(db: Db, actorUserId: string, raw: unknown, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const input = generateSchema.parse(raw);
  const [plan] = await db.select({ id: subscriptionPlan.id, code: subscriptionPlan.code, name: subscriptionPlan.name }).from(subscriptionPlan).where(eq(subscriptionPlan.id, input.planId)).limit(1);
  if (!plan) throw new CommercialError("Formule introuvable.", 404, "plan_not_found");
  const duration = input.duration === "custom" ? { unit: "day" as const, value: input.customDays! } : commercialDurations[input.duration];
  const activationDeadline = new Date(now.getTime() + input.activationDays * dayMs);
  const codes = Array.from({ length: input.quantity }, () => {
    const code = generateAccessCode("commercial");
    const normalized = normalizeAccessCode("commercial", code)!;
    return { id: randomUUID(), code, hint: accessCodeHint(normalized), hash: hashAccessCode("commercial", normalized) };
  });
  await db.transaction(async (tx) => {
    await tx.insert(commercialAccessCode).values(codes.map((item) => ({
      id: item.id, codeHash: item.hash, codeHint: item.hint, planId: plan.id, durationUnit: duration.unit, durationValue: duration.value,
      activationDeadline, paymentVerifiedAt: now, note: input.note, createdByUserId: actorUserId, createdAt: now,
    })));
    for (const item of codes) {
      await writePlatformAudit(tx as Db, {
        actorUserId, eventType: "platform.commercial_code_created", entityType: "commercial_access_code", entityId: item.id,
        after: { plan: plan.code, durationUnit: duration.unit, durationValue: duration.value, activationDeadline: activationDeadline.toISOString(), hint: item.hint },
        metadata: { paymentVerified: true },
      });
    }
  });
  return {
    // Seule et unique apparition des codes bruts : ils ne sont jamais relus depuis la base.
    codes: codes.map((item) => ({ id: item.id, code: item.code, hint: item.hint })),
    plan: { id: plan.id, code: plan.code, name: plan.name }, duration, activationDeadline: activationDeadline.toISOString(),
  };
}

const listSchema = z.object({
  state: z.enum(["all", "unused", "used", "expired", "revoked"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export async function listCommercialAccessCodes(db: Db, actorUserId: string, raw: unknown, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const input = listSchema.parse(raw ?? {});
  const creator = alias(user, "creator");
  const consumer = alias(user, "consumer");
  const filters = [
    input.before ? lt(commercialAccessCode.createdAt, new Date(input.before)) : undefined,
    input.state === "used" ? isNotNull(commercialAccessCode.consumedAt) : undefined,
    input.state === "revoked" ? and(isNotNull(commercialAccessCode.revokedAt), isNull(commercialAccessCode.consumedAt)) : undefined,
    input.state === "unused" ? and(isNull(commercialAccessCode.consumedAt), isNull(commercialAccessCode.revokedAt), gt(commercialAccessCode.activationDeadline, now)) : undefined,
    input.state === "expired" ? and(isNull(commercialAccessCode.consumedAt), isNull(commercialAccessCode.revokedAt), lte(commercialAccessCode.activationDeadline, now)) : undefined,
  ].filter(Boolean);
  const rows = await db.select({
    id: commercialAccessCode.id, hint: commercialAccessCode.codeHint, planName: subscriptionPlan.name, planCode: subscriptionPlan.code,
    durationUnit: commercialAccessCode.durationUnit, durationValue: commercialAccessCode.durationValue,
    activationDeadline: commercialAccessCode.activationDeadline, createdAt: commercialAccessCode.createdAt, note: commercialAccessCode.note,
    createdBy: sql<string>`coalesce(${creator.displayUsername}, ${creator.username}, ${creator.name})`,
    revokedAt: commercialAccessCode.revokedAt, revokeReason: commercialAccessCode.revokeReason,
    consumedAt: commercialAccessCode.consumedAt, consumedBy: sql<string | null>`coalesce(${consumer.displayUsername}, ${consumer.name})`,
    businessName: organization.name,
  }).from(commercialAccessCode)
    .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, commercialAccessCode.planId))
    .innerJoin(creator, eq(creator.id, commercialAccessCode.createdByUserId))
    .leftJoin(consumer, eq(consumer.id, commercialAccessCode.consumedByUserId))
    .leftJoin(organization, eq(organization.id, commercialAccessCode.consumedBusinessId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(commercialAccessCode.createdAt), desc(commercialAccessCode.id)).limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map((row) => ({
    ...row, state: commercialCodeState(row, now),
    activationDeadline: row.activationDeadline.toISOString(), createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null, consumedAt: row.consumedAt?.toISOString() ?? null,
  }));
  return { items, nextBefore: rows.length > input.limit ? items[items.length - 1]!.createdAt : null };
}

const revokeSchema = z.object({ reason: z.string().trim().min(5, "Indiquez un motif d’au moins 5 caractères.").max(300) });

export async function revokeCommercialAccessCode(db: Db, actorUserId: string, codeId: string, raw: unknown, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const input = revokeSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(commercialAccessCode).where(eq(commercialAccessCode.id, codeId)).for("update").limit(1);
    if (!row) throw new CommercialError("Code introuvable.", 404, "not_found");
    if (row.consumedAt) throw new CommercialError("Ce code a déjà été utilisé : il ne peut plus être révoqué.", 409, "already_used");
    if (row.revokedAt) return { id: row.id, state: "revoked" as const, replayed: true };
    await tx.update(commercialAccessCode).set({ revokedAt: now, revokedByUserId: actorUserId, revokeReason: input.reason }).where(eq(commercialAccessCode.id, row.id));
    await writePlatformAudit(tx as Db, {
      actorUserId, eventType: "platform.commercial_code_revoked", entityType: "commercial_access_code", entityId: row.id,
      before: { state: commercialCodeState(row, now) }, after: { state: "revoked" }, reason: input.reason, metadata: { hint: row.codeHint },
    });
    return { id: row.id, state: "revoked" as const, replayed: false };
  });
}

/* ------------------------------------------------------------------ Vérification d'un code saisi */

type CodeRow = typeof commercialAccessCode.$inferSelect;

/**
 * Lit un code saisi et rend son état. Erreurs à identifiant stable :
 * `invite_code` (code d'employé saisi au mauvais endroit), `invalid`, `already_used`, `expired`, `revoked`.
 * Un code inconnu et un texte mal formé rendent la même réponse `invalid`.
 */
export async function findCommercialCode(db: Pick<Db, "select">, rawCode: unknown, now = new Date(), lock = false) {
  const family = accessCodeFamilyOf(rawCode);
  if (family === "invite") throw new CommercialError("Ce code sert à rejoindre l’équipe d’un commerce : saisissez-le sur la page « Rejoindre un commerce ».", 422, "invite_code");
  const normalized = normalizeAccessCode("commercial", rawCode);
  if (!normalized) throw new CommercialError("Code invalide. Vérifiez chaque caractère.", 404, "invalid");
  const base = db.select().from(commercialAccessCode).where(eq(commercialAccessCode.codeHash, hashAccessCode("commercial", normalized)));
  const [row] = lock ? await base.for("update").limit(1) : await base.limit(1);
  if (!row) throw new CommercialError("Code invalide. Vérifiez chaque caractère.", 404, "invalid");
  return { row, state: commercialCodeState(row, now) };
}

function stateError(state: CommercialCodeState) {
  if (state === "used") return new CommercialError("Ce code a déjà été utilisé.", 409, "already_used");
  if (state === "revoked") return new CommercialError("Ce code a été annulé par Qadr Agency. Contactez-nous.", 410, "revoked");
  return new CommercialError("La date limite d’activation de ce code est dépassée. Contactez Qadr Agency.", 410, "expired");
}

export async function describeCommercialCode(db: Db, row: CodeRow) {
  const [plan] = await db.select({ code: subscriptionPlan.code, name: subscriptionPlan.name }).from(subscriptionPlan).where(eq(subscriptionPlan.id, row.planId)).limit(1);
  return {
    plan: { code: plan?.code ?? null, name: plan?.name ?? null },
    duration: { unit: row.durationUnit as DurationUnit, value: row.durationValue },
    activationDeadline: row.activationDeadline.toISOString(),
  };
}

/** Vérification sans effet : utilisée par la page publique avant toute création de compte. */
export async function checkCommercialCode(db: Db, rawCode: unknown, now = new Date()) {
  const { row, state } = await findCommercialCode(db, rawCode, now);
  if (state !== "unused") throw stateError(state);
  return { id: row.id, ...(await describeCommercialCode(db, row)) };
}

/** Le laissez-passer désigne-t-il encore un code utilisable ? (relu en base, jamais déduit du cookie seul) */
export async function usableCommercialCodeById(db: Pick<Db, "select">, codeId: string, now = new Date()) {
  const [row] = await db.select().from(commercialAccessCode).where(eq(commercialAccessCode.id, codeId)).limit(1);
  return row && commercialCodeState(row, now) === "unused" ? row : null;
}

/* ------------------------------------------------------------------ Activation */

export type CommercialActivation = {
  codeId: string; subscriptionId: string; status: string; startsAt: string; endsAt: string; replayed: boolean;
  duration: { unit: DurationUnit; value: number }; plan: { code: string; name: string } | null;
};

/**
 * Consomme un code pour UN commerce, dans la transaction de l'appelant : verrou du code, du profil et des
 * abonnements ; abonnement créé ou prolongé ; code marqué utilisé ; trace d'audit. Toute erreur annule l'ensemble.
 * Rejeu (même utilisateur, même commerce) : rend le résultat déjà enregistré.
 */
export async function activateCommercialCode(tx: Db, input: { codeId?: string; rawCode?: unknown; businessId: string; actorUserId: string; now?: Date }): Promise<CommercialActivation> {
  const now = input.now ?? new Date();
  let row: CodeRow | undefined;
  if (input.codeId) {
    [row] = await tx.select().from(commercialAccessCode).where(eq(commercialAccessCode.id, input.codeId)).for("update").limit(1);
    if (!row) throw new CommercialError("Code invalide. Vérifiez chaque caractère.", 404, "invalid");
  } else {
    row = (await findCommercialCode(tx, input.rawCode, now, true)).row;
  }
  const duration = { unit: row.durationUnit as DurationUnit, value: row.durationValue };
  const [plan] = await tx.select({ code: subscriptionPlan.code, name: subscriptionPlan.name }).from(subscriptionPlan).where(eq(subscriptionPlan.id, row.planId)).limit(1);
  if (row.consumedAt) {
    if (row.consumedBusinessId === input.businessId && row.consumedByUserId === input.actorUserId && row.subscriptionId) {
      const [current] = await tx.select({ status: businessSubscription.status, startsAt: businessSubscription.startsAt, endsAt: businessSubscription.endsAt })
        .from(businessSubscription).where(eq(businessSubscription.id, row.subscriptionId)).limit(1);
      return { codeId: row.id, subscriptionId: row.subscriptionId, status: current?.status ?? "active", startsAt: (current?.startsAt ?? now).toISOString(), endsAt: (current?.endsAt ?? now).toISOString(), replayed: true, duration, plan: plan ?? null };
    }
    throw stateError("used");
  }
  const state = commercialCodeState(row, now);
  if (state !== "unused") throw stateError(state);

  const [profile] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, input.businessId)).for("update").limit(1);
  if (!profile) throw new CommercialError("Commerce introuvable.", 404, "not_found");
  if (profile.status === "suspended") throw new CommercialError("Ce commerce est suspendu : contactez Qadr Agency.", 403, "business_suspended");

  const subscriptions = await tx.select({ id: businessSubscription.id, planId: businessSubscription.planId, status: businessSubscription.status, startsAt: businessSubscription.startsAt, endsAt: businessSubscription.endsAt })
    .from(businessSubscription).where(eq(businessSubscription.businessId, input.businessId)).for("update");
  const running = subscriptions.filter((item) => isInForce(item, now)).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  const pending = subscriptions.find((item) => item.status === "pending");
  let subscriptionId: string;
  let before: Record<string, Json>;
  let startsAt: Date;
  let endsAt: Date;
  let status: "active";
  if (running) {
    // Jamais de période raccourcie ni de seconde période parallèle sur une autre formule.
    if (running.planId !== row.planId) throw new CommercialError("Un abonnement à une autre formule est en cours : contactez Qadr Agency pour ce code.", 409, "incompatible_subscription");
    startsAt = running.startsAt;
    endsAt = addAccessDuration(running.endsAt, duration.unit, duration.value);
    if (running.status === "trialing") assertTransition("trialing", "active");
    await tx.update(businessSubscription).set({ status: "active", endsAt, updatedAt: now }).where(eq(businessSubscription.id, running.id));
    subscriptionId = running.id;
    before = { status: running.status, endsAt: running.endsAt.toISOString() };
    status = "active";
  } else {
    startsAt = now;
    endsAt = addAccessDuration(now, duration.unit, duration.value);
    status = "active";
    if (pending) {
      assertTransition(pending.status, "active");
      await tx.update(businessSubscription).set({ status, planId: row.planId, startsAt, endsAt, trialEndsAt: null, origin: "access_code", updatedAt: now }).where(eq(businessSubscription.id, pending.id));
      subscriptionId = pending.id;
      before = { status: "pending" };
    } else {
      subscriptionId = randomUUID();
      await tx.insert(businessSubscription).values({ id: subscriptionId, businessId: input.businessId, planId: row.planId, status, startsAt, endsAt, origin: "access_code", createdAt: now, updatedAt: now });
      before = { status: null };
    }
    if (profile.status === "expired" || profile.status === "pending") {
      await tx.update(businessProfile).set({ status: "active", updatedAt: now }).where(eq(businessProfile.businessId, input.businessId));
    }
  }
  const consumed = await tx.update(commercialAccessCode).set({ consumedAt: now, consumedByUserId: input.actorUserId, consumedBusinessId: input.businessId, subscriptionId })
    .where(and(eq(commercialAccessCode.id, row.id), isNull(commercialAccessCode.consumedAt), isNull(commercialAccessCode.revokedAt))).returning({ id: commercialAccessCode.id });
  if (!consumed.length) throw stateError("used");
  await tx.insert(auditEvent).values({
    id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "subscription.commercial_code_activated", entityType: "subscription", entityId: subscriptionId,
    metadata: { businessId: input.businessId, codeId: row.id, hint: row.codeHint, durationUnit: duration.unit, durationValue: duration.value, before, after: { status, endsAt: endsAt.toISOString() }, result: "success" },
    occurredAt: now,
  });
  return { codeId: row.id, subscriptionId, status, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), replayed: false, duration, plan: plan ?? null };
}

/**
 * Renouvellement par le propriétaire (ou un administrateur) d'un commerce déjà ouvert, ou activation d'un commerce
 * resté fermé. Le commerce est toujours celui de la session, jamais une valeur du corps.
 */
export async function redeemCommercialCodeForBusiness(db: Db, actorUserId: string, businessId: string, rawCode: unknown, now = new Date()) {
  return db.transaction(async (tx) => {
    const [membership] = await tx.select({ role: member.role }).from(member).where(and(eq(member.organizationId, businessId), eq(member.userId, actorUserId))).limit(1);
    if (!membership || !["owner", "admin"].includes(membership.role)) throw new CommercialError("Seul le propriétaire ou un administrateur du commerce peut utiliser ce code.", 403, "forbidden");
    return activateCommercialCode(tx as Db, { rawCode, businessId, actorUserId, now });
  });
}

/** Trace d'un refus (sans le code saisi) pour repérer les essais répétés. */
export async function recordCommercialCodeRejection(db: Db, input: { reason: string; actorUserId?: string | null; businessId?: string | null; client: string }) {
  await writePlatformAudit(db, {
    actorUserId: input.actorUserId ?? null, eventType: "platform.commercial_code_rejected", entityType: "commercial_access_code", entityId: "attempt",
    businessId: input.businessId ?? null, result: "failure", metadata: { reason: input.reason, client: input.client },
  });
}

/** Codes encore utilisables à une date donnée (tableau de bord de la console). */
export async function countUsableCommercialCodes(db: Db, now = new Date()) {
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(commercialAccessCode)
    .where(and(isNull(commercialAccessCode.consumedAt), isNull(commercialAccessCode.revokedAt), gt(commercialAccessCode.activationDeadline, now)));
  return Number(row?.total ?? 0);
}

