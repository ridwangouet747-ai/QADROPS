import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { auditEvent, businessSubscription } from "../db/schema";
import type { CommercialDatabase } from "./commercial";
import { CommercialError } from "./commercial";

/*
 * Machine à états des abonnements SaaS (valeurs du schéma, « canceled » compris).
 *
 *   pending ──► trialing ──► active ──► expired
 *      │           │  ▲         │
 *      │           ▼  │         ▼
 *      └──────► suspended ◄─────┘          (toute période en cours peut être annulée : canceled)
 *
 * expired et canceled sont terminaux : une nouvelle période crée un nouvel abonnement, l'historique
 * reste intact. L'expiration est constatée à la date de fin, sans intervention (expireDueSubscriptions).
 */
export const subscriptionStatuses = ["pending", "trialing", "active", "suspended", "expired", "canceled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

const transitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  pending: ["trialing", "active", "canceled"],
  trialing: ["active", "suspended", "expired", "canceled"],
  active: ["suspended", "expired", "canceled"],
  suspended: ["trialing", "active", "expired", "canceled"],
  expired: [],
  canceled: [],
};

export const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus =>
  typeof value === "string" && (subscriptionStatuses as readonly string[]).includes(value);

export function canTransition(from: string, to: SubscriptionStatus) {
  return isSubscriptionStatus(from) && transitions[from].includes(to);
}

export function assertTransition(from: string, to: SubscriptionStatus) {
  if (!canTransition(from, to)) throw new CommercialError(`Changement d’état impossible : ${from} → ${to}.`, 409);
}

/**
 * Types de durée (2026-11-27, docs/lifetime-access.md). `lifetime` n'a pas de date de fin : seule une action
 * administrative (annulation, suspension du commerce) y met fin. Le type est toujours lu explicitement, jamais déduit
 * d'une date nulle.
 */
export const durationKinds = ["fixed_duration", "lifetime"] as const;
export type DurationKind = (typeof durationKinds)[number];
export type SubscriptionTerms = { status: string; startsAt: Date; endsAt: Date | null; durationKind: string };
export const isLifetime = (subscription: { durationKind: string }) => subscription.durationKind === "lifetime";
/** Colonnes à lire pour appliquer la règle d'accès (à étaler dans un `select`). */
export const subscriptionTermsColumns = {
  status: businessSubscription.status, startsAt: businessSubscription.startsAt,
  endsAt: businessSubscription.endsAt, durationKind: businessSubscription.durationKind,
};

/** La période est-elle échue ? Jamais pour un accès permanent ; toujours pour un état incohérent (fixe sans fin). */
function lapsed(subscription: Pick<SubscriptionTerms, "endsAt" | "durationKind">, now: Date) {
  if (isLifetime(subscription)) return false;
  return subscription.endsAt === null || subscription.endsAt <= now;
}

/**
 * Règle unique d'accès : un abonnement donne accès s'il est en essai ou actif, que sa date de début est atteinte et,
 * s'il est à durée déterminée, que sa date de fin n'est pas atteinte. Pendant SQL : `subscriptionInForceSql`.
 */
export function isInForce(subscription: SubscriptionTerms, now = new Date()) {
  return (subscription.status === "trialing" || subscription.status === "active") && subscription.startsAt <= now && !lapsed(subscription, now);
}

/** Même règle en SQL, pour les contrôles faits dans la base (assertBusinessOperational, filtres de la console). */
export function subscriptionInForceSql(now: Date) {
  return sql`(${businessSubscription.status} in ('trialing','active') and ${businessSubscription.startsAt} <= ${now}
    and (${businessSubscription.durationKind} = 'lifetime' or ${businessSubscription.endsAt} > ${now}))`;
}

/** Ordre de couverture : l'accès permanent d'abord, puis la date de fin la plus lointaine. */
export function byCoverage(a: Pick<SubscriptionTerms, "endsAt" | "durationKind">, b: Pick<SubscriptionTerms, "endsAt" | "durationKind">) {
  if (isLifetime(a) !== isLifetime(b)) return isLifetime(a) ? -1 : 1;
  return (b.endsAt?.getTime() ?? 0) - (a.endsAt?.getTime() ?? 0);
}

/**
 * Statut affiché, calculé en lecture seule : un essai ou un abonnement actif dont la date de fin est
 * atteinte se lit « expired » avant même le passage planifié (cron quotidien expireDueSubscriptions).
 * Les lectures n'écrivent plus en base (mission 11, phase 6) : ce que voit l'utilisateur ne change pas.
 */
export function effectiveSubscriptionStatus(subscription: Pick<SubscriptionTerms, "status" | "endsAt" | "durationKind">, now = new Date()) {
  return (subscription.status === "trialing" || subscription.status === "active") && lapsed(subscription, now) ? "expired" : subscription.status;
}

/** Jours entiers restants (0 si l'échéance est passée) ; `null` pour un accès permanent (aucun compte à rebours). */
export function remainingDays(endsAt: Date | null, now = new Date()) {
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
}

export type BusinessLifecycle = "active" | "trial" | "suspended" | "expired" | "pending";

/**
 * État commercial d'un commerce, dérivé une seule fois pour toute la plateforme :
 * suspension administrative > essai en cours > abonnement actif > expiré (déjà abonné, plus rien
 * en cours, ou statut expiré) > sans abonnement (aucun ou seulement en attente/annulé).
 */
export function businessLifecycle(profileStatus: string, subscriptions: SubscriptionTerms[], now = new Date()): BusinessLifecycle {
  if (profileStatus === "suspended") return "suspended";
  const current = subscriptions.filter((item) => isInForce(item, now));
  if (current.some((item) => item.status === "active")) return "active";
  if (current.some((item) => item.status === "trialing")) return "trial";
  if (profileStatus === "expired" || subscriptions.some((item) => ["trialing", "active", "expired"].includes(item.status))) return "expired";
  return "pending";
}

/**
 * Passe en « expired » les abonnements en essai ou actifs dont la date de fin est atteinte, avec une
 * trace d'audit système par abonnement. Idempotent : un second passage ne trouve plus rien. L'accès
 * est de toute façon refusé dès l'échéance par assertBusinessOperational, même avant ce passage.
 */
export async function expireDueSubscriptions(db: CommercialDatabase, now = new Date()) {
  return db.transaction(async (tx) => {
    const due = await tx.select({ id: businessSubscription.id, businessId: businessSubscription.businessId, status: businessSubscription.status })
      .from(businessSubscription)
      // Un accès permanent n'a pas de date de fin : jamais concerné (type vérifié explicitement).
      .where(and(inArray(businessSubscription.status, ["trialing", "active"]), eq(businessSubscription.durationKind, "fixed_duration"), lte(businessSubscription.endsAt, now)))
      .for("update");
    if (!due.length) return { expired: 0 };
    await tx.update(businessSubscription).set({ status: "expired", updatedAt: now }).where(inArray(businessSubscription.id, due.map((row) => row.id)));
    await tx.insert(auditEvent).values(due.map((row) => ({
      id: randomUUID(), businessId: row.businessId, actorUserId: null, eventType: "subscription.expired", entityType: "subscription", entityId: row.id,
      metadata: { businessId: row.businessId, before: { status: row.status }, after: { status: "expired" }, reason: "Date de fin atteinte", result: "success" },
      occurredAt: now,
    })));
    return { expired: due.length };
  });
}

/** Lecture de l'abonnement en vigueur d'un commerce (le plus récent s'il y en a plusieurs). */
export async function currentSubscription(db: Pick<CommercialDatabase, "select">, businessId: string, now = new Date()) {
  const rows = await db.select({ id: businessSubscription.id, planId: businessSubscription.planId, status: businessSubscription.status, startsAt: businessSubscription.startsAt, endsAt: businessSubscription.endsAt, durationKind: businessSubscription.durationKind })
    .from(businessSubscription).where(eq(businessSubscription.businessId, businessId));
  return rows.filter((row) => isInForce(row, now)).sort(byCoverage)[0] ?? null;
}
