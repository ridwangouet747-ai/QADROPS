import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { BillingAvailability } from "../billing";
import { GENIUSPAY_MINIMUM_XOF, subscriptionMethodFromGeniusPay } from "../billing/geniuspay";
import { BillingProviderError, type BillingProvider, type ProviderPayment } from "../billing/provider";
import { auditEvent, businessProfile, businessSubscription, member, paymentProviderEvent, promotionCode, promotionRedemption, subscriptionInvoice, subscriptionPayment, subscriptionPlan } from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { idempotencyKeySchema, type CommercialTransaction } from "./operation-guard";
import { assertTransition, isInForce } from "./subscription-lifecycle";

/*
 * Paiement des abonnements Qadr Ops par GeniusPay (mission 12, lot L1b, décision D-12-1).
 *
 *  facture (subscription_invoice) ─┬─ tentative 1 (subscription_payment, provider = geniuspay, référence MTX-…)
 *                                  └─ tentative 2 …
 *
 * - Le prix, la devise et la durée viennent TOUJOURS de la formule en base, jamais du navigateur.
 * - Une tentative ne devient `confirmed` qu'après `GET /payments/{reference}` chez GeniusPay : statut `completed`,
 *   même référence, même montant, devise XOF, même environnement, métadonnées pointant vers la même facture et
 *   la même tentative. Ni la redirection de succès, ni un webhook seul n'activent quoi que ce soit.
 * - Activation idempotente : la facture passe `open → paid` une seule fois ; un second paiement réussi de la même
 *   facture est enregistré et signalé (remboursement manuel), sans prolonger une seconde fois.
 * - États finals : `confirmed` ne revient jamais en arrière (seul `refunded` le suit) ; un événement tardif ou
 *   désordonné qui annoncerait `pending`, `failed`, `cancelled` ou `expired` est ignoré.
 * - Ce module ne touche jamais aux ventes des commerces (`sale`, `payment`).
 *
 * Pourquoi pas `runIdempotent` : il exige un commerce opérationnel (`assertBusinessOperational`), or un commerce
 * EXPIRÉ doit justement pouvoir payer pour reprendre. L'idempotence repose sur la contrainte unique
 * `(business_id, idempotency_key)` de `subscription_payment`, déjà présente.
 */

/** Seul le propriétaire engage une dépense pour le commerce. */
export const subscriptionPaymentRoles = ["owner"] as const;

const dayMs = 86_400_000;
/** Une tentative encore ouverte chez GeniusPay est réutilisée plutôt que d'ouvrir un second paiement. */
const REUSE_MARGIN_MS = 10 * 60_000;
/** Lien hébergé valable 24 h (documentation) quand GeniusPay ne renvoie pas `expires_at`. */
const CHECKOUT_LIFETIME_MS = 24 * 3_600_000;
/** Délai minimal entre deux relectures d'une même tentative depuis la page de retour. */
const REFRESH_INTERVAL_MS = 5_000;
const METADATA_INVOICE = "qadr_invoice";
const METADATA_ATTEMPT = "qadr_attempt";

export type VerificationOutcome = "applied" | "unchanged" | "amount_mismatch" | "currency_mismatch" | "reference_mismatch"
  | "environment_mismatch" | "metadata_mismatch" | "provider_error";

type Attempt = typeof subscriptionPayment.$inferSelect;
type Invoice = typeof subscriptionInvoice.$inferSelect;

const checkoutSchema = z.object({ planCode: z.string().trim().min(1).max(64), idempotencyKey: idempotencyKeySchema });

async function assertOwner(db: Pick<CommercialDatabase, "select">, businessId: string, actorUserId: string) {
  const [membership] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, businessId), eq(member.userId, actorUserId))).limit(1);
  const roles = (membership?.role ?? "").split(",").map((role) => role.trim());
  if (!roles.some((role) => (subscriptionPaymentRoles as readonly string[]).includes(role))) {
    throw new CommercialError("Seul le propriétaire du commerce peut payer l’abonnement.", 403, "forbidden");
  }
}

function audit(tx: CommercialTransaction, input: { businessId: string; actorUserId: string | null; eventType: string; entityType: string; entityId: string; metadata: Record<string, unknown>; now: Date }) {
  return tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: input.eventType,
    entityType: input.entityType, entityId: input.entityId, metadata: { businessId: input.businessId, ...input.metadata }, occurredAt: input.now });
}

/* ------------------------------------------------------------------ Vue renvoyée au commerçant */

async function attemptView(db: Pick<CommercialDatabase, "select">, attempt: Attempt, extra: { replayed?: boolean; reused?: boolean } = {}) {
  const [invoice] = await db.select().from(subscriptionInvoice).where(and(eq(subscriptionInvoice.businessId, attempt.businessId), eq(subscriptionInvoice.id, attempt.invoiceId!))).limit(1);
  const [subscription] = invoice?.subscriptionId ? await db.select({ status: businessSubscription.status, endsAt: businessSubscription.endsAt })
    .from(businessSubscription).where(and(eq(businessSubscription.businessId, attempt.businessId), eq(businessSubscription.id, invoice.subscriptionId))).limit(1) : [];
  return {
    attemptId: attempt.id, invoiceId: attempt.invoiceId, status: attempt.status, amountXof: attempt.amountXof.toString(), currency: "XOF",
    // Le lien n'est utile que tant que le paiement est ouvert.
    checkoutUrl: attempt.status === "pending" ? attempt.checkoutUrl : null,
    plan: invoice ? { code: invoice.planCode, name: invoice.planName, durationDays: invoice.durationDays } : null,
    invoice: invoice ? { status: invoice.status, periodStartsAt: invoice.periodStartsAt, periodEndsAt: invoice.periodEndsAt, paidAt: invoice.paidAt } : null,
    subscription: subscription ?? null,
    replayed: extra.replayed ?? false, reused: extra.reused ?? false,
  };
}

/* ------------------------------------------------------------------ Lecture publique des formules */

/** Formules payables en ligne : actives, en XOF, au moins le minimum GeniusPay (200 XOF). */
export async function listPayablePlans(db: Pick<CommercialDatabase, "select">) {
  const rows = await db.select({ code: subscriptionPlan.code, name: subscriptionPlan.name, priceXof: subscriptionPlan.priceXof, durationDays: subscriptionPlan.durationDays, description: subscriptionPlan.description })
    .from(subscriptionPlan).where(and(eq(subscriptionPlan.active, true), eq(subscriptionPlan.currency, "XOF"), gte(subscriptionPlan.priceXof, GENIUSPAY_MINIMUM_XOF)))
    .orderBy(asc(subscriptionPlan.priceXof), asc(subscriptionPlan.code));
  return rows.map((row) => ({ ...row, priceXof: row.priceXof.toString() }));
}

/** Facture ouverte du commerce et sa tentative en cours éventuelle (lecture seule). */
export async function openInvoiceSummary(db: Pick<CommercialDatabase, "select">, businessId: string, now = new Date()) {
  const [invoice] = await db.select().from(subscriptionInvoice).where(and(eq(subscriptionInvoice.businessId, businessId), eq(subscriptionInvoice.status, "open"))).limit(1);
  if (!invoice) return null;
  const [attempt] = await db.select().from(subscriptionPayment)
    .where(and(eq(subscriptionPayment.businessId, businessId), eq(subscriptionPayment.invoiceId, invoice.id), eq(subscriptionPayment.status, "pending")))
    .orderBy(desc(subscriptionPayment.occurredAt)).limit(1);
  return {
    id: invoice.id, planCode: invoice.planCode, planName: invoice.planName, amountXof: invoice.amountXof.toString(), discountXof: invoice.discountXof.toString(),
    durationDays: invoice.durationDays, pendingAttemptId: attempt && isReusable(attempt, now, 0) ? attempt.id : null,
  };
}

function isReusable(attempt: Attempt, now: Date, margin = REUSE_MARGIN_MS) {
  if (attempt.status !== "pending" || !attempt.checkoutUrl || !attempt.providerReference) return false;
  const expiresAt = attempt.checkoutExpiresAt ?? new Date(attempt.occurredAt.getTime() + CHECKOUT_LIFETIME_MS);
  return expiresAt.getTime() - margin > now.getTime();
}

/* ------------------------------------------------------------------ Remise d'une campagne publique */

/**
 * Remise réservée à l'inscription par une campagne publique (`promotion_redemption.discount_amount_xof`), encore
 * disponible pour la première facture payée du commerce :
 * - seulement une campagne PUBLIQUE avec un montant de remise positif (les codes privés n'ont pas de remise sur facture) ;
 * - seulement tant qu'aucune facture d'abonnement n'est payée : la première facture payée consomme la remise, même si
 *   elle porte sur une autre formule (la remise est alors perdue) ;
 * - seulement sur la formule choisie à l'inscription, au montant figé lors de la réclamation.
 * Une campagne révoquée après l'inscription ne retire pas la remise déjà accordée.
 */
export async function availableCampaignDiscount(db: Pick<CommercialDatabase, "select">, businessId: string) {
  const [paid] = await db.select({ id: subscriptionInvoice.id }).from(subscriptionInvoice)
    .where(and(eq(subscriptionInvoice.businessId, businessId), eq(subscriptionInvoice.status, "paid"))).limit(1);
  if (paid) return null;
  const [row] = await db.select({ id: promotionRedemption.id, code: promotionRedemption.codeSnapshot, amountXof: promotionRedemption.discountAmountXof,
    planId: subscriptionPlan.id, planCode: subscriptionPlan.code })
    .from(promotionRedemption)
    .innerJoin(promotionCode, eq(promotionCode.id, promotionRedemption.promotionId))
    .innerJoin(businessSubscription, and(eq(businessSubscription.businessId, promotionRedemption.businessId), eq(businessSubscription.id, promotionRedemption.subscriptionId)))
    .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(and(eq(promotionRedemption.businessId, businessId), eq(promotionCode.audience, "public"), gt(promotionRedemption.discountAmountXof, 0n)))
    .orderBy(asc(promotionRedemption.redeemedAt)).limit(1);
  return row ?? null;
}

/** Montant à facturer pour une formule : prix officiel moins la remise de campagne applicable (plafonnée au prix). */
export function invoicePricing(plan: { id: string; priceXof: bigint }, discount: Awaited<ReturnType<typeof availableCampaignDiscount>>) {
  const applies = Boolean(discount && discount.planId === plan.id);
  const discountXof = applies ? (discount!.amountXof < plan.priceXof ? discount!.amountXof : plan.priceXof) : 0n;
  return { amountXof: plan.priceXof - discountXof, discountXof, promotionRedemptionId: applies ? discount!.id : null, code: applies ? discount!.code : null };
}

/* ------------------------------------------------------------------ Création d'un paiement */

type Prepared = { kind: "new"; attempt: Attempt; invoice: Invoice } | { kind: "reuse"; attempt: Attempt };

async function prepareCheckout(db: CommercialDatabase, provider: BillingProvider, input: { businessId: string; actorUserId: string; planCode: string; idempotencyKey: string; now: Date; allowReuse: boolean }): Promise<Prepared> {
  const { businessId, actorUserId, now } = input;
  return db.transaction(async (tx) => {
    // Verrou du profil : deux demandes simultanées du même commerce ne créent pas deux factures ouvertes.
    const [profile] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).for("update").limit(1);
    if (!profile) throw new CommercialError("Commerce introuvable.", 404, "not_found");
    if (profile.status === "suspended") throw new CommercialError("Ce commerce est suspendu : contactez Qadr Agency.", 403, "business_suspended");
    const [plan] = await tx.select().from(subscriptionPlan).where(and(eq(subscriptionPlan.code, input.planCode), eq(subscriptionPlan.active, true))).limit(1);
    if (!plan) throw new CommercialError("Formule introuvable.", 404, "plan_not_found");
    if (plan.currency !== "XOF" || plan.priceXof < GENIUSPAY_MINIMUM_XOF) throw new CommercialError("Cette formule ne peut pas être payée en ligne.", 422, "amount_too_low");

    // Lue sous le verrou du profil : une facture payée entre-temps consomme la remise.
    const pricing = invoicePricing(plan, await availableCampaignDiscount(tx, businessId));
    if (pricing.amountXof < GENIUSPAY_MINIMUM_XOF) {
      throw new CommercialError("Après la remise de votre code, le montant à payer est trop faible pour un paiement en ligne. Contactez Qadr Agency.", 422, "amount_too_low");
    }

    let invoice: Invoice | undefined = (await tx.select().from(subscriptionInvoice).where(and(eq(subscriptionInvoice.businessId, businessId), eq(subscriptionInvoice.status, "open"))).for("update").limit(1))[0];
    if (invoice && (invoice.planId !== plan.id || invoice.amountXof !== pricing.amountXof || invoice.discountXof !== pricing.discountXof
      || invoice.promotionRedemptionId !== pricing.promotionRedemptionId || invoice.durationDays !== plan.durationDays)) {
      // Autre formule (ou prix ou remise modifiés depuis) : la facture ouverte n'est annulée que si aucun paiement n'y est en cours.
      const live = await tx.select({ id: subscriptionPayment.id }).from(subscriptionPayment)
        .where(and(eq(subscriptionPayment.businessId, businessId), eq(subscriptionPayment.invoiceId, invoice.id), eq(subscriptionPayment.status, "pending"))).limit(1);
      if (live.length) throw new CommercialError("Un paiement est déjà en cours pour une autre formule ou un autre montant. Terminez-le ou attendez son expiration.", 409, "payment_in_progress");
      await tx.update(subscriptionInvoice).set({ status: "void", voidedAt: now, updatedAt: now }).where(eq(subscriptionInvoice.id, invoice.id));
      await audit(tx, { businessId, actorUserId, eventType: "subscription.invoice_voided", entityType: "subscription_invoice", entityId: invoice.id, now,
        metadata: { before: { status: "open", planCode: invoice.planCode }, after: { status: "void" }, reason: "Nouvelle formule choisie", result: "success" } });
      invoice = undefined;
    }
    if (!invoice) {
      // `amount_xof` est le montant NET payé chez GeniusPay ; la remise et son origine restent sur la facture.
      const values = { id: randomUUID(), businessId, planId: plan.id, planCode: plan.code, planName: plan.name, amountXof: pricing.amountXof, currency: "XOF",
        discountXof: pricing.discountXof, promotionRedemptionId: pricing.promotionRedemptionId,
        durationDays: plan.durationDays, status: "open", createdByUserId: actorUserId, createdAt: now, updatedAt: now };
      [invoice] = await tx.insert(subscriptionInvoice).values(values).returning();
      await audit(tx, { businessId, actorUserId, eventType: "subscription.invoice_created", entityType: "subscription_invoice", entityId: invoice!.id, now,
        metadata: { after: { status: "open", planCode: plan.code, amountXof: pricing.amountXof.toString(), currency: "XOF", durationDays: plan.durationDays,
          priceXof: plan.priceXof.toString(), discountXof: pricing.discountXof.toString(), promotionRedemptionId: pricing.promotionRedemptionId, promotionCode: pricing.code }, result: "success" } });
    }

    if (input.allowReuse) {
      const pending = await tx.select().from(subscriptionPayment)
        .where(and(eq(subscriptionPayment.businessId, businessId), eq(subscriptionPayment.invoiceId, invoice!.id), eq(subscriptionPayment.status, "pending")))
        .orderBy(desc(subscriptionPayment.occurredAt));
      const reusable = pending.find((row) => isReusable(row, now) && row.environment === provider.environment);
      if (reusable) return { kind: "reuse" as const, attempt: reusable };
    }

    const [attempt] = await tx.insert(subscriptionPayment).values({
      id: randomUUID(), businessId, invoiceId: invoice!.id, subscriptionId: null, amountXof: invoice!.amountXof, method: "unknown", status: "pending",
      idempotencyKey: input.idempotencyKey, provider: "geniuspay", environment: provider.environment, initiatedByUserId: actorUserId, occurredAt: now,
    }).returning();
    await audit(tx, { businessId, actorUserId, eventType: "subscription.payment_initiated", entityType: "subscription_payment", entityId: attempt!.id, now,
      metadata: { invoiceId: invoice!.id, after: { status: "pending" }, amountXof: invoice!.amountXof.toString(), environment: provider.environment, result: "success" } });
    return { kind: "new" as const, attempt: attempt!, invoice: invoice! };
  });
}

async function findAttemptByKey(db: Pick<CommercialDatabase, "select">, businessId: string, idempotencyKey: string) {
  const [row] = await db.select().from(subscriptionPayment).where(and(eq(subscriptionPayment.businessId, businessId), eq(subscriptionPayment.idempotencyKey, idempotencyKey))).limit(1);
  return row;
}

async function replayAttempt(db: CommercialDatabase, attempt: Attempt, planCode: string) {
  const [invoice] = attempt.invoiceId ? await db.select({ planCode: subscriptionInvoice.planCode }).from(subscriptionInvoice)
    .where(and(eq(subscriptionInvoice.businessId, attempt.businessId), eq(subscriptionInvoice.id, attempt.invoiceId))).limit(1) : [];
  if (attempt.provider !== "geniuspay" || !invoice || invoice.planCode !== planCode) {
    throw new CommercialError("Cette clé d’opération a déjà été utilisée pour une requête différente.", 409, "idempotency_conflict");
  }
  if (attempt.status === "pending" && !attempt.checkoutUrl) throw new CommercialError("Ce paiement est en cours de création. Patientez quelques secondes.", 409, "checkout_in_progress");
  // Ouverture refusée : la même clé redonne la même réponse ; un nouvel essai utilise une nouvelle clé.
  if (attempt.status === "failed" && !attempt.providerReference) throw new CommercialError("GeniusPay n’a pas pu ouvrir le paiement. Réessayez.", 502, "provider_unavailable");
  return attemptView(db, attempt, { replayed: true });
}

/**
 * `POST /api/business/subscription/checkout` : propriétaire seulement, clé d'idempotence du client.
 * Retrouve ou crée la facture ouverte de la formule demandée (prix officiel en base), réutilise un paiement
 * GeniusPay encore ouvert (pour ne pas faire payer deux fois) ou en ouvre un, puis renvoie `checkoutUrl`.
 */
export async function startSubscriptionCheckout(db: CommercialDatabase, billing: BillingAvailability, input: {
  actorUserId: string; businessId: string; raw: unknown; now?: Date;
}) {
  const now = input.now ?? new Date();
  const { planCode, idempotencyKey } = checkoutSchema.parse(input.raw);
  await assertOwner(db, input.businessId, input.actorUserId);
  const existing = await findAttemptByKey(db, input.businessId, idempotencyKey);
  if (existing) return replayAttempt(db, existing, planCode);
  if (!billing.available) throw new CommercialError("Le paiement en ligne n’est pas disponible pour le moment.", 503, "billing_unavailable");
  const { provider, appUrl } = billing;

  const prepare = async (allowReuse: boolean) => {
    try {
      return await prepareCheckout(db, provider, { businessId: input.businessId, actorUserId: input.actorUserId, planCode, idempotencyKey, now, allowReuse });
    } catch (error) {
      const concurrent = await findAttemptByKey(db, input.businessId, idempotencyKey);
      if (concurrent) return { kind: "replay" as const, attempt: concurrent };
      throw error;
    }
  };
  let prepared = await prepare(true);
  if (prepared.kind === "replay") return replayAttempt(db, prepared.attempt, planCode);
  if (prepared.kind === "reuse") {
    // Paiement déjà ouvert pour cette facture : on le relit d'abord (il a peut-être abouti) et on renvoie le même
    // lien plutôt que d'ouvrir un second paiement que le commerçant pourrait régler deux fois.
    const outcome = await verifyAttempt(db, provider, prepared.attempt, now);
    const [fresh] = await db.select().from(subscriptionPayment).where(eq(subscriptionPayment.id, prepared.attempt.id)).limit(1);
    if (fresh?.status === "confirmed") return attemptView(db, fresh, { reused: true });
    if (fresh?.status === "pending" && isReusable(fresh, now) && (outcome === "unchanged" || outcome === "provider_error")) return attemptView(db, fresh, { reused: true });
    prepared = await prepare(false);
    if (prepared.kind === "replay") return replayAttempt(db, prepared.attempt, planCode);
    if (prepared.kind !== "new") throw new CommercialError("Le paiement n’a pas pu être préparé. Réessayez.", 409, "checkout_in_progress");
  }

  const { attempt, invoice } = prepared;
  const base = appUrl.replace(/\/+$/, "");
  const back = (result: "success" | "error") => `${base}/business/subscription/return?attempt=${encodeURIComponent(attempt.id)}&result=${result}`;
  try {
    const session = await provider.createCheckout({
      amountXof: invoice.amountXof, currency: "XOF", description: `Qadr Ops - abonnement ${invoice.planName}`.slice(0, 500),
      successUrl: back("success"), errorUrl: back("error"), metadata: { [METADATA_INVOICE]: invoice.id, [METADATA_ATTEMPT]: attempt.id },
    });
    if (session.environment && session.environment !== provider.environment) throw new BillingProviderError("environment_mismatch", null, "Environnement GeniusPay inattendu.");
    const [updated] = await db.update(subscriptionPayment).set({
      providerReference: session.reference, checkoutUrl: session.checkoutUrl, providerStatus: session.status,
      checkoutExpiresAt: session.expiresAt ?? new Date(now.getTime() + CHECKOUT_LIFETIME_MS),
    }).where(and(eq(subscriptionPayment.id, attempt.id), eq(subscriptionPayment.status, "pending"))).returning();
    return attemptView(db, updated ?? attempt);
  } catch (error) {
    const code = error instanceof BillingProviderError ? error.code : "unexpected";
    await db.transaction(async (tx) => {
      await tx.update(subscriptionPayment).set({ status: "failed", providerStatus: `init_${code}`.slice(0, 64), checkedAt: now })
        .where(and(eq(subscriptionPayment.id, attempt.id), eq(subscriptionPayment.status, "pending"), isNull(subscriptionPayment.providerReference)));
      await audit(tx, { businessId: input.businessId, actorUserId: input.actorUserId, eventType: "subscription.payment_failed", entityType: "subscription_payment", entityId: attempt.id, now,
        metadata: { invoiceId: invoice.id, before: { status: "pending" }, after: { status: "failed" }, reason: `Ouverture refusée (${code})`, result: "failure" } });
    });
    if (error instanceof BillingProviderError) throw new CommercialError("GeniusPay n’a pas pu ouvrir le paiement. Réessayez dans un instant.", 502, "provider_unavailable");
    throw error;
  }
}

/* ------------------------------------------------------------------ Vérification et application */

const statusTarget: Record<ProviderPayment["status"], Attempt["status"] | null> = {
  completed: "confirmed", failed: "failed", cancelled: "canceled", expired: "expired", refunded: "refunded",
  pending: null, processing: null, unknown: null,
};

/** Transitions admises d'une tentative : rien ne fait régresser un état final. */
function canMove(from: string, to: string) {
  if (from === to) return false;
  if (from === "pending") return true;
  if (from === "confirmed") return to === "refunded";
  // L'API dit « completed » après un échec annoncé : l'argent est encaissé, on l'enregistre.
  if (from === "failed" || from === "canceled" || from === "expired") return to === "confirmed";
  return false;
}

/** Relit le paiement chez GeniusPay puis l'applique. Une panne du prestataire ne change rien. */
export async function verifyAttempt(db: CommercialDatabase, provider: BillingProvider, attempt: Pick<Attempt, "id" | "businessId" | "providerReference">, now = new Date()): Promise<VerificationOutcome> {
  if (!attempt.providerReference) return "unchanged";
  let payment: ProviderPayment | null;
  try { payment = await provider.getPayment(attempt.providerReference); } catch (error) {
    if (error instanceof BillingProviderError) return "provider_error";
    throw error;
  }
  if (!payment) {
    await recordAnomaly(db, attempt, "reference_mismatch", now);
    return "reference_mismatch";
  }
  return applyProviderPayment(db, provider, attempt, payment, now);
}

async function recordAnomaly(db: CommercialDatabase, attempt: Pick<Attempt, "id" | "businessId">, reason: VerificationOutcome, now: Date) {
  console.warn(`[facturation] paiement d'abonnement non appliqué : ${reason}`);
  await db.transaction(async (tx) => {
    await tx.update(subscriptionPayment).set({ checkedAt: now }).where(eq(subscriptionPayment.id, attempt.id));
    await audit(tx, { businessId: attempt.businessId, actorUserId: null, eventType: "subscription.payment_anomaly", entityType: "subscription_payment", entityId: attempt.id, now,
      metadata: { reason, result: "rejected" } });
  });
}

function anomalyOf(attempt: Attempt, payment: ProviderPayment, environment: BillingProvider["environment"]): VerificationOutcome | null {
  if (payment.reference !== attempt.providerReference) return "reference_mismatch";
  // La doc de `GET /payments/{reference}` ne garantit pas le champ `environment` : absent, l'environnement est celui de la
  // clé qui a servi à relire le paiement ; présent et différent, c'est une anomalie.
  if ((payment.environment !== null && payment.environment !== environment) || attempt.environment !== environment) return "environment_mismatch";
  if (payment.metadata[METADATA_ATTEMPT] !== attempt.id || payment.metadata[METADATA_INVOICE] !== attempt.invoiceId) return "metadata_mismatch";
  if (payment.currency !== "XOF") return "currency_mismatch";
  if (payment.amountXof === null || payment.amountXof !== attempt.amountXof) return "amount_mismatch";
  return null;
}

async function applyProviderPayment(db: CommercialDatabase, provider: BillingProvider, ref: Pick<Attempt, "id" | "businessId">, payment: ProviderPayment, now: Date): Promise<VerificationOutcome> {
  let anomaly: VerificationOutcome | null = null;
  const outcome = await db.transaction(async (tx): Promise<VerificationOutcome> => {
    const [attempt] = await tx.select().from(subscriptionPayment).where(and(eq(subscriptionPayment.businessId, ref.businessId), eq(subscriptionPayment.id, ref.id))).for("update").limit(1);
    if (!attempt || attempt.provider !== "geniuspay" || !attempt.invoiceId) return "reference_mismatch";
    anomaly = anomalyOf(attempt, payment, provider.environment);
    if (anomaly) return anomaly;
    const target = statusTarget[payment.status];
    if (!target || !canMove(attempt.status, target)) {
      await tx.update(subscriptionPayment).set({ checkedAt: now, providerStatus: payment.rawStatus || payment.status }).where(eq(subscriptionPayment.id, attempt.id));
      return "unchanged";
    }
    const method = subscriptionMethodFromGeniusPay(payment.paymentMethod);
    if (target !== "confirmed") {
      await tx.update(subscriptionPayment).set({ status: target, checkedAt: now, providerStatus: payment.rawStatus || payment.status, ...(method !== "unknown" ? { method } : {}) })
        .where(eq(subscriptionPayment.id, attempt.id));
      await audit(tx, { businessId: attempt.businessId, actorUserId: null, eventType: `subscription.payment_${target}`, entityType: "subscription_payment", entityId: attempt.id, now,
        metadata: { invoiceId: attempt.invoiceId, before: { status: attempt.status }, after: { status: target },
          reason: target === "refunded" ? "Remboursement constaté chez GeniusPay : la période n’est pas raccourcie automatiquement." : null, result: "success" } });
      return "applied";
    }
    await confirmAttempt(tx, attempt, method, payment.rawStatus || payment.status, now);
    return "applied";
  });
  if (anomaly) await recordAnomaly(db, ref, anomaly, now);
  return outcome;
}

/**
 * Paiement vérifié : la tentative passe `confirmed`, puis la facture ouverte devient payée et la période est
 * servie par la machine à états. Même formule en cours : prolongation à partir de sa fin (renouvellement). Sinon
 * nouvelle période qui commence à la fin de la période en cours si elle est future, maintenant sinon.
 */
async function confirmAttempt(tx: CommercialTransaction, attempt: Attempt, method: Attempt["method"], providerStatus: string, now: Date) {
  const businessId = attempt.businessId;
  // Ordre des verrous : tentative (déjà prise) → profil → facture → abonnements.
  const [profile] = await tx.select({ status: businessProfile.status }).from(businessProfile).where(eq(businessProfile.businessId, businessId)).for("update").limit(1);
  const [invoice] = await tx.select().from(subscriptionInvoice).where(and(eq(subscriptionInvoice.businessId, businessId), eq(subscriptionInvoice.id, attempt.invoiceId!))).for("update").limit(1);
  const confirm = (subscriptionId: string | null) => tx.update(subscriptionPayment).set({ status: "confirmed", confirmedAt: now, checkedAt: now, providerStatus, subscriptionId,
    ...(method !== "unknown" ? { method } : {}) }).where(eq(subscriptionPayment.id, attempt.id));

  if (!invoice || invoice.status !== "open") {
    // Facture déjà payée par une autre tentative, ou annulée : l'argent est enregistré, rien n'est prolongé.
    await confirm(invoice?.subscriptionId ?? null);
    await audit(tx, { businessId, actorUserId: null, eventType: invoice?.status === "paid" ? "subscription.payment_duplicate" : "subscription.payment_on_void_invoice",
      entityType: "subscription_payment", entityId: attempt.id, now,
      metadata: { invoiceId: attempt.invoiceId, before: { status: attempt.status }, after: { status: "confirmed" }, amountXof: attempt.amountXof.toString(),
        reason: "Paiement reçu sans période à servir : remboursement ou affectation manuelle par Qadr Agency.", result: "attention" } });
    return;
  }

  const subscriptions = await tx.select().from(businessSubscription).where(eq(businessSubscription.businessId, businessId)).for("update");
  const running = subscriptions.filter((row) => isInForce(row, now)).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
  const samePlan = running.find((row) => row.planId === invoice.planId);
  const duration = invoice.durationDays * dayMs;
  let subscriptionId: string;
  let periodStartsAt: Date;
  let periodEndsAt: Date;
  let before: Record<string, unknown>;
  if (samePlan) {
    periodStartsAt = samePlan.endsAt;
    periodEndsAt = new Date(samePlan.endsAt.getTime() + duration);
    if (samePlan.status !== "active") assertTransition(samePlan.status, "active");
    await tx.update(businessSubscription).set({ status: "active", endsAt: periodEndsAt, updatedAt: now, ...(samePlan.status === "trialing" ? { origin: "payment" } : {}) })
      .where(eq(businessSubscription.id, samePlan.id));
    subscriptionId = samePlan.id;
    before = { status: samePlan.status, endsAt: samePlan.endsAt.toISOString() };
  } else {
    const latest = running[0];
    periodStartsAt = latest && latest.endsAt > now ? latest.endsAt : now;
    periodEndsAt = new Date(periodStartsAt.getTime() + duration);
    const pending = !latest ? subscriptions.find((row) => row.status === "pending" && row.planId === invoice.planId) : undefined;
    if (pending) {
      assertTransition(pending.status, "active");
      await tx.update(businessSubscription).set({ status: "active", startsAt: periodStartsAt, endsAt: periodEndsAt, origin: "payment", updatedAt: now }).where(eq(businessSubscription.id, pending.id));
      subscriptionId = pending.id;
      before = { status: "pending" };
    } else {
      subscriptionId = randomUUID();
      await tx.insert(businessSubscription).values({ id: subscriptionId, businessId, planId: invoice.planId, status: "active", startsAt: periodStartsAt, endsAt: periodEndsAt, origin: "payment", createdAt: now, updatedAt: now });
      before = { status: null };
    }
  }
  // Un commerce expiré reprend ; une suspension administrative n'est jamais levée par un paiement.
  if (profile?.status === "expired") await tx.update(businessProfile).set({ status: "active", updatedAt: now }).where(eq(businessProfile.businessId, businessId));
  await tx.update(subscriptionInvoice).set({ status: "paid", paidAt: now, subscriptionId, periodStartsAt, periodEndsAt, updatedAt: now }).where(eq(subscriptionInvoice.id, invoice.id));
  await confirm(subscriptionId);
  await audit(tx, { businessId, actorUserId: null, eventType: "subscription.payment_activated", entityType: "subscription", entityId: subscriptionId, now,
    metadata: { invoiceId: invoice.id, attemptId: attempt.id, planCode: invoice.planCode, amountXof: invoice.amountXof.toString(), currency: invoice.currency,
      discountXof: invoice.discountXof.toString(), promotionRedemptionId: invoice.promotionRedemptionId, before, after: { status: "active", startsAt: periodStartsAt.toISOString(), endsAt: periodEndsAt.toISOString() }, result: "success" } });
}

/* ------------------------------------------------------------------ Page de retour */

/**
 * `GET /api/business/subscription/payments/[attemptId]` : état d'une tentative du commerce de la session.
 * Une tentative encore ouverte est relue chez GeniusPay (au plus toutes les 5 s). Une tentative d'un autre
 * commerce répond exactement comme une tentative inconnue.
 */
export async function getSubscriptionPaymentStatus(db: CommercialDatabase, billing: BillingAvailability, input: { actorUserId: string; businessId: string; attemptId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await assertOwner(db, input.businessId, input.actorUserId);
  const notFound = () => new CommercialError("Paiement introuvable.", 404, "not_found");
  if (!z.uuid().safeParse(input.attemptId).success) throw notFound();
  const load = async () => (await db.select().from(subscriptionPayment)
    .where(and(eq(subscriptionPayment.businessId, input.businessId), eq(subscriptionPayment.id, input.attemptId), eq(subscriptionPayment.provider, "geniuspay"))).limit(1))[0];
  let attempt = await load();
  if (!attempt) throw notFound();
  let verification: "fresh" | "recent" | "unavailable" | "final" = "final";
  if (attempt.status === "pending") {
    if (!billing.available || !attempt.providerReference) verification = "unavailable";
    else if (attempt.checkedAt && now.getTime() - attempt.checkedAt.getTime() < REFRESH_INTERVAL_MS) verification = "recent";
    else {
      const outcome = await verifyAttempt(db, billing.provider, attempt, now);
      verification = outcome === "provider_error" ? "unavailable" : "fresh";
      attempt = (await load()) ?? attempt;
    }
  }
  return { ...(await attemptView(db, attempt)), verification };
}

/* ------------------------------------------------------------------ Webhook */

const referencePattern = /^[A-Za-z0-9_-]{1,64}$/;

export type WebhookResult = { status: number; body: Record<string, unknown> };

/**
 * `POST /api/webhooks/geniuspay`. Ordre : signature sur le corps brut → déduplication de l'événement →
 * relecture du paiement par l'API → application. La charge utile n'est jamais crue sur parole (montant,
 * statut) et n'est pas conservée : seulement son empreinte, son type, la référence et le résultat.
 */
export async function handleGeniusPayWebhook(db: CommercialDatabase, billing: BillingAvailability, rawBody: string, headers: Headers, now = new Date()): Promise<WebhookResult> {
  if (!billing.available) return { status: 503, body: { error: "billing_unavailable" } };
  const provider = billing.provider;
  const verification = provider.verifyWebhook(rawBody, headers, now);
  if (!verification.ok) {
    // Variante éventuelle : un libellé de format seulement, jamais le corps ni la signature (diagnostic de l'essai sandbox).
    console.warn(`[facturation] webhook GeniusPay refusé : ${verification.reason}${verification.variant ? ` (variante reconnue : ${verification.variant})` : ""}`);
    return { status: 401, body: { error: "invalid_signature" } };
  }
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch { return { status: 400, body: { error: "invalid_payload" } }; }

  // Seuls les champs couverts par la signature servent : l'en-tête X-Webhook-Event, lui, n'est pas signé.
  const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const eventType = typeof payload.event === "string" ? payload.event.slice(0, 64) : null;
  const eventId = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim().slice(0, 128) : `sha256:${payloadHash}`;
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const reference = typeof data.reference === "string" && referencePattern.test(data.reference) ? data.reference : null;
  const environment = payload.environment === "sandbox" || payload.environment === "live" ? payload.environment : null;

  const [inserted] = await db.insert(paymentProviderEvent).values({ id: randomUUID(), businessId: null, provider: "geniuspay", eventId, payloadHash, eventType,
    providerReference: reference, environment, outcome: "received", receivedAt: now }).onConflictDoNothing({ target: [paymentProviderEvent.provider, paymentProviderEvent.eventId] })
    .returning({ id: paymentProviderEvent.id });
  let eventRowId = inserted?.id;
  if (!eventRowId) {
    const [previous] = await db.select({ id: paymentProviderEvent.id, processedAt: paymentProviderEvent.processedAt }).from(paymentProviderEvent)
      .where(and(eq(paymentProviderEvent.provider, "geniuspay"), eq(paymentProviderEvent.eventId, eventId))).limit(1);
    if (previous?.processedAt) return { status: 200, body: { received: true, duplicate: true } };
    eventRowId = previous?.id;
    if (!eventRowId) return { status: 503, body: { error: "retry" } };
  }
  const finish = (outcome: string, link?: { businessId: string; attemptId: string }) => db.update(paymentProviderEvent)
    .set({ outcome, processedAt: now, ...(link ? { businessId: link.businessId, subscriptionPaymentId: link.attemptId } : {}) })
    .where(eq(paymentProviderEvent.id, eventRowId!));

  if (!eventType?.startsWith("payment.") || !reference) {
    await finish("ignored");
    return { status: 200, body: { received: true } };
  }
  if (environment && environment !== provider.environment) {
    console.warn("[facturation] webhook GeniusPay d'un autre environnement ignoré");
    await finish("environment_mismatch");
    return { status: 200, body: { received: true } };
  }

  let [attempt] = await db.select().from(subscriptionPayment).where(and(eq(subscriptionPayment.provider, "geniuspay"), eq(subscriptionPayment.providerReference, reference))).limit(1);
  let outcome: VerificationOutcome;
  if (attempt) {
    outcome = await verifyAttempt(db, provider, attempt, now);
  } else {
    // Référence encore inconnue : seule la relecture par l'API (métadonnées renvoyées par GeniusPay) peut la
    // relier à une tentative de Qadr Ops dont la création n'a pas encore enregistré la référence.
    let payment: ProviderPayment | null;
    try { payment = await provider.getPayment(reference); } catch (error) {
      if (error instanceof BillingProviderError) return { status: 503, body: { error: "retry" } };
      throw error;
    }
    const attemptId = payment?.metadata[METADATA_ATTEMPT];
    const [candidate] = payment && attemptId && z.uuid().safeParse(attemptId).success ? await db.select().from(subscriptionPayment)
      .where(and(eq(subscriptionPayment.id, attemptId), eq(subscriptionPayment.provider, "geniuspay"), isNull(subscriptionPayment.providerReference))).limit(1) : [];
    if (!payment || !candidate || payment.metadata[METADATA_INVOICE] !== candidate.invoiceId) {
      console.warn("[facturation] webhook GeniusPay pour une référence inconnue : rien n'est modifié");
      await finish("unmatched");
      return { status: 200, body: { received: true } };
    }
    await db.update(subscriptionPayment).set({ providerReference: reference }).where(and(eq(subscriptionPayment.id, candidate.id), isNull(subscriptionPayment.providerReference)));
    attempt = { ...candidate, providerReference: reference };
    outcome = await applyProviderPayment(db, provider, attempt, payment, now);
  }
  if (outcome === "provider_error") return { status: 503, body: { error: "retry" } };
  await finish(outcome, { businessId: attempt.businessId, attemptId: attempt.id });
  return { status: 200, body: { received: true } };
}

/* ------------------------------------------------------------------ Rapprochement planifié */

/**
 * Revérifie les tentatives GeniusPay restées `pending` (webhook perdu, page de retour fermée). Appelé par le cron
 * quotidien des abonnements. Une tentative sans référence depuis plus de 24 h (création interrompue) est close
 * en échec : aucun lien de paiement n'a été remis au commerçant.
 *
 * Budget de temps (mission 15) : chaque relecture peut attendre GeniusPay jusqu'à 15 s ; au-delà de `budgetMs`
 * (120 s par défaut), les tentatives restantes sont laissées au passage suivant (`deferred`), pour que l'expiration
 * des abonnements, qui suit dans le même cron, tienne dans la durée maximale de la fonction Vercel.
 */
export async function reconcilePendingSubscriptionPayments(db: CommercialDatabase, billing: BillingAvailability,
  options: { now?: Date; olderThanMs?: number; limit?: number; budgetMs?: number; clock?: () => number } = {}) {
  const now = options.now ?? new Date();
  if (!billing.available) return { available: false as const, checked: 0, applied: 0, anomalies: 0, errors: 0, abandoned: 0, deferred: 0 };
  const clock = options.clock ?? Date.now;
  const started = clock();
  const budgetMs = options.budgetMs ?? 120_000;
  const cutoff = new Date(now.getTime() - (options.olderThanMs ?? 10 * 60_000));
  const rows = await db.select().from(subscriptionPayment)
    .where(and(eq(subscriptionPayment.provider, "geniuspay"), eq(subscriptionPayment.status, "pending"), lt(subscriptionPayment.occurredAt, cutoff)))
    .orderBy(asc(subscriptionPayment.occurredAt)).limit(options.limit ?? 50);
  const totals = { available: true as const, checked: 0, applied: 0, anomalies: 0, errors: 0, abandoned: 0, deferred: 0 };
  for (const [index, row] of rows.entries()) {
    if (clock() - started >= budgetMs) { totals.deferred = rows.length - index; break; }
    if (!row.providerReference) {
      if (now.getTime() - row.occurredAt.getTime() < CHECKOUT_LIFETIME_MS) continue;
      await db.transaction(async (tx) => {
        const [closed] = await tx.update(subscriptionPayment).set({ status: "failed", providerStatus: "init_incomplete", checkedAt: now })
          .where(and(eq(subscriptionPayment.id, row.id), eq(subscriptionPayment.status, "pending"), isNull(subscriptionPayment.providerReference))).returning({ id: subscriptionPayment.id });
        if (closed) await audit(tx, { businessId: row.businessId, actorUserId: null, eventType: "subscription.payment_failed", entityType: "subscription_payment", entityId: row.id, now,
          metadata: { invoiceId: row.invoiceId, before: { status: "pending" }, after: { status: "failed" }, reason: "Création du paiement jamais terminée", result: "success" } });
      });
      totals.abandoned += 1;
      continue;
    }
    totals.checked += 1;
    const outcome = await verifyAttempt(db, billing.provider, row, now);
    if (outcome === "applied") totals.applied += 1;
    else if (outcome === "provider_error") totals.errors += 1;
    else if (outcome !== "unchanged") totals.anomalies += 1;
  }
  return totals;
}
