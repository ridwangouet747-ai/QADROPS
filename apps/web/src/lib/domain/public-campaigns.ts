import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvent, businessSubscription, organization, promotionCode, promotionEligiblePlan, promotionRedemption, subscriptionPlan,
} from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { promotionState, requirePlatformAdmin, writePlatformAudit, type PromotionState } from "./platform";

/*
 * Campagnes promotionnelles PUBLIQUES (mission 12, lot L1a, décision D-12-4).
 *
 * Deux systèmes séparés dans la même table `promotion_code` :
 * - `audience = 'private'` : codes remis à un commerce déjà inscrit, appliqués sur /business/subscription
 *   (platform.ts, redeemSubscriptionPromotion) ; ils refusent un code public ;
 * - `audience = 'public'`, `kind = 'campaign'` : campagnes d'acquisition, vérifiées sans session
 *   (checkPublicCampaign) et réclamées UNIQUEMENT à la création du commerce (claimPublicCampaign) ;
 *   elles refusent un code privé.
 *
 * Rien n'est inventé (D-12-5) : jours offerts, remise, formules, dates et quota viennent de l'administration.
 * Le navigateur n'envoie que le code et le code de formule ; durée et remise sont relues ici.
 */

type Db = CommercialDatabase;
type Tx = Parameters<Parameters<CommercialDatabase["transaction"]>[0]>[0];
type Reader = Pick<CommercialDatabase, "select">;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const dayMs = 86_400_000;

/* ------------------------------------------------------------------ Règles communes */

const codeSchema = z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/);
const planCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/);

/** Entrée publique : un code et, facultatif, la formule choisie. Rien d'autre n'est lu. */
export const campaignCodeInput = z.object({ code: codeSchema, planCode: planCodeSchema.optional() }).strict();
export type CampaignCodeInput = z.infer<typeof campaignCodeInput>;

/** Motif interne d'un refus : écrit dans l'audit, jamais renvoyé au public. */
export type CampaignRefusal = "invalid_input" | "unknown" | "private" | Exclude<PromotionState, "active">
  | "no_plan" | "plan_not_eligible" | "plan_required" | "account_already_claimed" | "error";

type PromotionRow = typeof promotionCode.$inferSelect;
type EligiblePlan = { id: string; code: string; name: string; priceXof: bigint; durationDays: number };
type Evaluation = { ok: true; promo: PromotionRow; plans: EligiblePlan[]; plan: EligiblePlan | null } | { ok: false; reason: CampaignRefusal; promotionId?: string };

export type LocalizedText = { fr: string; en: string; ar: string };

async function eligiblePlans(db: Reader, promotionId: string) {
  return db.select({ id: subscriptionPlan.id, code: subscriptionPlan.code, name: subscriptionPlan.name, priceXof: subscriptionPlan.priceXof, durationDays: subscriptionPlan.durationDays })
    .from(promotionEligiblePlan).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, promotionEligiblePlan.planId))
    .where(and(eq(promotionEligiblePlan.promotionId, promotionId), eq(subscriptionPlan.active, true)))
    .orderBy(asc(subscriptionPlan.priceXof), asc(subscriptionPlan.name));
}

/**
 * Évalue une campagne pour un code et une formule. `lock` : ligne du code verrouillée (FOR UPDATE)
 * pour la réclamation, afin que le comptage des réclamations et l'insertion soient sérialisés.
 */
async function evaluateCampaign(db: Tx | Reader, input: CampaignCodeInput, now: Date, lock: boolean): Promise<Evaluation> {
  const base = db.select().from(promotionCode).where(eq(promotionCode.code, input.code));
  const [promo] = lock ? await base.for("update").limit(1) : await base.limit(1);
  if (!promo) return { ok: false, reason: "unknown" };
  if (promo.audience !== "public" || promo.kind !== "campaign") return { ok: false, reason: "private", promotionId: promo.id };
  const [used] = await db.select({ total: count() }).from(promotionRedemption).where(eq(promotionRedemption.promotionId, promo.id));
  const state = promotionState(promo, Number(used?.total ?? 0), now);
  if (state !== "active") return { ok: false, reason: state, promotionId: promo.id };
  const plans = await eligiblePlans(db, promo.id);
  if (!plans.length) return { ok: false, reason: "no_plan", promotionId: promo.id };
  if (input.planCode) {
    const plan = plans.find((item) => item.code === input.planCode);
    return plan ? { ok: true, promo, plans, plan } : { ok: false, reason: "plan_not_eligible", promotionId: promo.id };
  }
  return { ok: true, promo, plans, plan: plans.length === 1 ? plans[0]! : null };
}

/** Remise en XOF sur le prix de la formule : pourcentage arrondi à l'unité, plafonnée au prix (même règle que les codes privés). */
export function campaignDiscountXof(priceXof: bigint, promo: { discountPercent: number | null; discountXof: bigint | null }) {
  const raw = promo.discountPercent !== null ? (priceXof * BigInt(promo.discountPercent) + 50n) / 100n : (promo.discountXof ?? 0n);
  return raw > priceXof ? priceXof : raw;
}

function readDescription(value: unknown): LocalizedText {
  const parsed = localizedTextSchema.safeParse(value);
  return parsed.success ? parsed.data : { fr: "", en: "", ar: "" };
}

/* ------------------------------------------------------------------ Vérification publique (sans session) */

/** Réponse unique pour TOUT refus (inconnu, privé, expiré, en pause, révoqué, complet, formule non éligible). */
export const campaignUnavailable = { valid: false } as const;

export type CampaignCheckResult = typeof campaignUnavailable | {
  valid: true; code: string; description: LocalizedText; endsAt: string | null;
  advantage: { grantDays: number | null; discountPercent: number | null; discountXof: string | null };
  plans: { code: string; name: string }[];
  /** Formule retenue (choisie, ou seule éligible) et remise calculée sur son prix ; nulle s'il faut choisir. */
  plan: { code: string; name: string; discountAmountXof: string | null } | null;
};

/**
 * Vérifie un code de campagne publique sans rien consommer ni écrire. Ne renvoie que l'offre à afficher ;
 * tout refus donne exactement `campaignUnavailable` (aucune information interne : ni état, ni quota, ni
 * existence d'un code privé). La limite de tentatives et Turnstile sont appliqués par la route.
 */
export async function checkPublicCampaign(db: Reader, raw: unknown, now = new Date()): Promise<CampaignCheckResult> {
  const input = campaignCodeInput.safeParse(raw);
  if (!input.success) return campaignUnavailable;
  const evaluation = await evaluateCampaign(db, input.data, now, false);
  if (!evaluation.ok) return campaignUnavailable;
  const { promo, plans, plan } = evaluation;
  const hasDiscount = promo.discountPercent !== null || promo.discountXof !== null;
  return {
    valid: true, code: promo.code, description: readDescription(promo.publicDescription), endsAt: promo.endsAt?.toISOString() ?? null,
    advantage: { grantDays: promo.grantDays, discountPercent: promo.discountPercent, discountXof: promo.discountXof?.toString() ?? null },
    plans: plans.map((item) => ({ code: item.code, name: item.name })),
    plan: plan ? { code: plan.code, name: plan.name, discountAmountXof: hasDiscount ? campaignDiscountXof(plan.priceXof, promo).toString() : null } : null,
  };
}

/* ------------------------------------------------------------------ Réclamation à la création du commerce */

export type CampaignClaimOutcome =
  | {
    status: "applied"; replayed: boolean; code: string; plan: { code: string; name: string };
    grantDays: number | null; subscriptionStatus: string; endsAt: string | null; discountAmountXof: string;
  }
  | { status: "unavailable" };

/**
 * Code choisi pendant l'inscription, transmis au crochet `afterCreateOrganization` (auth/server.ts) sans
 * être écrit dans `organization.metadata`. Le crochet y dépose le résultat de la réclamation.
 */
export type SignupCampaignScope = { request: unknown; outcome?: CampaignClaimOutcome };
export const signupCampaignScope = new AsyncLocalStorage<SignupCampaignScope>();

async function refuse(tx: Tx, input: { businessId: string; userId: string }, reason: CampaignRefusal, promotionId?: string): Promise<CampaignClaimOutcome> {
  await tx.insert(auditEvent).values({
    id: randomUUID(), businessId: input.businessId, actorUserId: input.userId, eventType: "subscription.campaign_claim_refused",
    entityType: "business", entityId: input.businessId, metadata: { businessId: input.businessId, promotionId: promotionId ?? null, reason, result: "failure" },
  });
  return { status: "unavailable" };
}

/**
 * Réclame une campagne publique pour un commerce qui vient d'être créé, DANS la transaction qui crée son
 * profil : verrou sur la campagne, revérification complète (état, dates, quota, formule), une fois par
 * commerce et par compte, abonnement créé par la machine à états, réclamation et audit.
 *
 * Comportement retenu si le code est devenu invalide entre la vérification et la création : le commerce
 * est créé SANS avantage et la réponse le dit (`unavailable`). Refuser la création laisserait une
 * organisation Better Auth sans profil (elle est écrite avant ce crochet, hors de cette transaction).
 */
export async function claimPublicCampaign(tx: Tx, input: { businessId: string; userId: string; request: unknown; now?: Date }): Promise<CampaignClaimOutcome> {
  const now = input.now ?? new Date();
  const parsed = campaignCodeInput.safeParse(input.request);
  if (!parsed.success) return refuse(tx, input, "invalid_input");
  const evaluation = await evaluateCampaign(tx, parsed.data, now, true);
  if (!evaluation.ok) return refuse(tx, input, evaluation.reason, evaluation.promotionId);
  const { promo, plan } = evaluation;
  if (!plan) return refuse(tx, input, "plan_required", promo.id);
  const [already] = await tx.select({ id: promotionRedemption.id }).from(promotionRedemption)
    .where(and(eq(promotionRedemption.promotionId, promo.id), eq(promotionRedemption.redeemedByUserId, input.userId))).limit(1);
  if (already) return refuse(tx, input, "account_already_claimed", promo.id);

  // Jours offerts : essai immédiat (pending → trialing n'a pas lieu d'être, l'abonnement naît en essai).
  // Remise seule : abonnement en attente de paiement sur la formule ; la remise est conservée dans la
  // réclamation et devra être déduite par la facture d'abonnement (lot L1, GeniusPay).
  const subscriptionId = randomUUID();
  const trial = promo.grantDays !== null;
  const endsAt = new Date(now.getTime() + (trial ? promo.grantDays! : plan.durationDays) * dayMs);
  const status = trial ? "trialing" : "pending";
  await tx.insert(businessSubscription).values({
    id: subscriptionId, businessId: input.businessId, planId: plan.id, status, startsAt: now, endsAt,
    trialEndsAt: trial ? endsAt : null, origin: "promotion",
  });
  const discount = promo.discountPercent !== null || promo.discountXof !== null ? campaignDiscountXof(plan.priceXof, promo) : 0n;
  const redemptionId = randomUUID();
  await tx.insert(promotionRedemption).values({
    id: redemptionId, promotionId: promo.id, businessId: input.businessId, subscriptionId, codeSnapshot: promo.code,
    discountAmountXof: discount, redeemedByUserId: input.userId, redeemedAt: now,
  });
  await tx.insert(auditEvent).values({
    id: randomUUID(), businessId: input.businessId, actorUserId: input.userId, eventType: "subscription.campaign_claimed",
    entityType: "promotion_redemption", entityId: redemptionId,
    metadata: {
      businessId: input.businessId, promotionId: promo.id, code: promo.code, campaign: promo.campaign, plan: plan.code,
      grantDays: promo.grantDays, discountAmountXof: discount.toString(), before: { status: null },
      after: { status, endsAt: endsAt.toISOString() }, result: "success",
    },
  });
  return {
    status: "applied", replayed: false, code: promo.code, plan: { code: plan.code, name: plan.name }, grantDays: promo.grantDays,
    subscriptionStatus: status, endsAt: trial ? endsAt.toISOString() : null, discountAmountXof: discount.toString(),
  };
}

/**
 * Réclamation isolée dans un point de sauvegarde : une erreur imprévue (base, contrainte unique sur une
 * course entre deux commerces du même compte) annule la seule réclamation, jamais la création du profil.
 */
export async function claimPublicCampaignSafely(tx: Tx, input: { businessId: string; userId: string; request: unknown; now?: Date }): Promise<CampaignClaimOutcome> {
  try {
    return await tx.transaction((savepoint) => claimPublicCampaign(savepoint, input));
  } catch (error) {
    // Ni code ni donnée : seulement le type d'erreur.
    console.error(JSON.stringify({ event: "campaign.claim_failed", error: error instanceof Error ? error.name : "unknown" }));
    return refuse(tx, input, "error");
  }
}

/** Réclamation déjà enregistrée pour un commerce (rejeu de la création avec la même clé). */
export async function campaignOutcomeForBusiness(db: Reader, businessId: string): Promise<CampaignClaimOutcome | null> {
  const [row] = await db.select({
    code: promotionRedemption.codeSnapshot, discount: promotionRedemption.discountAmountXof, grantDays: promotionCode.grantDays,
    planCode: subscriptionPlan.code, planName: subscriptionPlan.name, status: businessSubscription.status, trialEndsAt: businessSubscription.trialEndsAt,
  }).from(promotionRedemption)
    .innerJoin(promotionCode, eq(promotionCode.id, promotionRedemption.promotionId))
    .innerJoin(businessSubscription, eq(businessSubscription.id, promotionRedemption.subscriptionId))
    .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(and(eq(promotionRedemption.businessId, businessId), eq(promotionCode.audience, "public"))).limit(1);
  if (!row) return null;
  return {
    status: "applied", replayed: true, code: row.code, plan: { code: row.planCode, name: row.planName }, grantDays: row.grantDays,
    subscriptionStatus: row.status, endsAt: row.trialEndsAt?.toISOString() ?? null, discountAmountXof: row.discount.toString(),
  };
}

/* ------------------------------------------------------------------ Administration (Super Admin) */

const localizedTextSchema = z.object({
  fr: z.string().trim().min(3).max(280), en: z.string().trim().min(3).max(280), ar: z.string().trim().min(3).max(280),
}).strict();
const reasonSchema = z.string().trim().min(5, "Indiquez un motif d’au moins 5 caractères.").max(500);

const campaignSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
  name: z.string().trim().min(3, "Indiquez le nom interne de la campagne.").max(80),
  description: localizedTextSchema,
  planIds: z.array(z.string().min(1).max(100)).min(1, "Choisissez au moins une formule.").max(20),
  grantDays: z.number().int().min(1).max(365).nullable(),
  discountPercent: z.number().int().min(1).max(100).nullable(),
  discountXof: z.string().regex(/^[1-9]\d{0,17}$/).nullable(),
  startsAt: z.string().datetime(), endsAt: z.string().datetime().nullable(),
  maxRedemptions: z.number().int().positive().max(1_000_000).nullable(),
  active: z.boolean(),
}).strict().superRefine((data, ctx) => {
  if (data.discountPercent !== null && data.discountXof !== null) ctx.addIssue({ code: "custom", message: "Choisissez une remise en pourcentage OU en montant, pas les deux." });
  if (data.grantDays === null && data.discountPercent === null && data.discountXof === null) ctx.addIssue({ code: "custom", message: "Indiquez des jours offerts, une remise, ou les deux." });
  if (data.endsAt && Date.parse(data.endsAt) <= Date.parse(data.startsAt)) ctx.addIssue({ code: "custom", message: "La fin doit être postérieure au début." });
});
type CampaignInput = z.infer<typeof campaignSchema>;

async function assertPlans(tx: Tx, planIds: string[]) {
  const ids = [...new Set(planIds)];
  const plans = await tx.select({ id: subscriptionPlan.id, code: subscriptionPlan.code, active: subscriptionPlan.active }).from(subscriptionPlan).where(inArray(subscriptionPlan.id, ids));
  if (plans.length !== ids.length) throw new CommercialError("Une ou plusieurs formules sont introuvables.", 404);
  if (plans.some((plan) => !plan.active)) throw new CommercialError("Une formule inactive ne peut pas être proposée dans une campagne.", 409);
  return plans;
}

function campaignSnapshot(input: CampaignInput, planCodes: string[]): Record<string, Json> {
  return {
    code: input.code, name: input.name, plans: planCodes.sort().join(","), grantDays: input.grantDays, discountPercent: input.discountPercent,
    discountXof: input.discountXof, startsAt: input.startsAt, endsAt: input.endsAt, maxRedemptions: input.maxRedemptions, active: input.active,
  };
}

export async function listPublicCampaigns(db: Db, actorUserId: string, now = new Date()) {
  await requirePlatformAdmin(db, actorUserId);
  const promos = await db.select().from(promotionCode).where(eq(promotionCode.audience, "public")).orderBy(desc(promotionCode.createdAt));
  if (!promos.length) return [];
  const ids = promos.map((promo) => promo.id);
  const [plans, uses] = await Promise.all([
    db.select({ promotionId: promotionEligiblePlan.promotionId, id: subscriptionPlan.id, code: subscriptionPlan.code, name: subscriptionPlan.name, active: subscriptionPlan.active })
      .from(promotionEligiblePlan).innerJoin(subscriptionPlan, eq(subscriptionPlan.id, promotionEligiblePlan.planId)).where(inArray(promotionEligiblePlan.promotionId, ids)),
    db.select({ promotionId: promotionRedemption.promotionId, total: count() }).from(promotionRedemption).where(inArray(promotionRedemption.promotionId, ids)).groupBy(promotionRedemption.promotionId),
  ]);
  const useCount = new Map(uses.map((row) => [row.promotionId, Number(row.total)]));
  return promos.map((promo) => {
    const used = useCount.get(promo.id) ?? 0;
    return {
      id: promo.id, code: promo.code, name: promo.campaign ?? "", description: readDescription(promo.publicDescription),
      plans: plans.filter((plan) => plan.promotionId === promo.id).map(({ id, code, name, active }) => ({ id, code, name, active })),
      grantDays: promo.grantDays, discountPercent: promo.discountPercent, discountXof: promo.discountXof?.toString() ?? null,
      startsAt: promo.startsAt, endsAt: promo.endsAt, maxRedemptions: promo.maxRedemptions, active: promo.active,
      useCount: used, remaining: promo.maxRedemptions === null ? null : Math.max(0, promo.maxRedemptions - used),
      state: promotionState(promo, used, now), revokedAt: promo.revokedAt, revokeReason: promo.revokeReason,
      createdAt: promo.createdAt, updatedAt: promo.updatedAt,
    };
  });
}

/** Fiche d'une campagne : réglages, compteur et historique des réclamations (commerce, formule, date). */
export async function getPublicCampaign(db: Db, actorUserId: string, id: string, now = new Date()) {
  const campaign = (await listPublicCampaigns(db, actorUserId, now)).find((item) => item.id === id);
  if (!campaign) throw new CommercialError("Campagne introuvable.", 404);
  const redemptions = await db.select({
    id: promotionRedemption.id, businessId: promotionRedemption.businessId, businessName: organization.name, planName: subscriptionPlan.name,
    subscriptionStatus: businessSubscription.status, discountAmountXof: promotionRedemption.discountAmountXof, redeemedAt: promotionRedemption.redeemedAt,
  }).from(promotionRedemption)
    .innerJoin(organization, eq(organization.id, promotionRedemption.businessId))
    .innerJoin(businessSubscription, eq(businessSubscription.id, promotionRedemption.subscriptionId))
    .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, businessSubscription.planId))
    .where(eq(promotionRedemption.promotionId, id)).orderBy(desc(promotionRedemption.redeemedAt)).limit(500);
  return { ...campaign, redemptions: redemptions.map((row) => ({ ...row, discountAmountXof: row.discountAmountXof.toString() })) };
}

export async function createPublicCampaign(db: Db, actorUserId: string, raw: unknown) {
  const input = campaignSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const plans = await assertPlans(tx, input.planIds);
    const [taken] = await tx.select({ id: promotionCode.id }).from(promotionCode).where(eq(promotionCode.code, input.code)).limit(1);
    if (taken) throw new CommercialError("Ce code existe déjà (codes privés et campagnes partagent les mêmes codes).", 409);
    await tx.insert(promotionCode).values({
      id, code: input.code, kind: "campaign", audience: "public", campaign: input.name, publicDescription: input.description,
      grantDays: input.grantDays, discountPercent: input.discountPercent, discountXof: input.discountXof === null ? null : BigInt(input.discountXof),
      startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null, maxRedemptions: input.maxRedemptions,
      active: input.active, createdByUserId: actorUserId,
    });
    await tx.insert(promotionEligiblePlan).values(plans.map((plan) => ({ promotionId: id, planId: plan.id })));
    await writePlatformAudit(tx as unknown as Db, {
      actorUserId, eventType: "platform.campaign_created", entityType: "promotion", entityId: id,
      after: campaignSnapshot(input, plans.map((plan) => plan.code)), metadata: { code: input.code, campaign: input.name },
    });
  });
  return { id, code: input.code };
}

export async function updatePublicCampaign(db: Db, actorUserId: string, id: string, raw: unknown) {
  const input = campaignSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(promotionCode).where(and(eq(promotionCode.id, id), eq(promotionCode.audience, "public"))).for("update").limit(1);
    if (!current) throw new CommercialError("Campagne introuvable.", 404);
    if (current.revokedAt) throw new CommercialError("Une campagne révoquée ne peut plus être modifiée.", 409);
    const [used] = await tx.select({ total: count() }).from(promotionRedemption).where(eq(promotionRedemption.promotionId, id));
    const uses = Number(used?.total ?? 0);
    if (input.code !== current.code) {
      if (uses > 0) throw new CommercialError("Le code d’une campagne déjà réclamée ne peut plus changer.", 409);
      const [taken] = await tx.select({ id: promotionCode.id }).from(promotionCode).where(eq(promotionCode.code, input.code)).limit(1);
      if (taken) throw new CommercialError("Ce code existe déjà (codes privés et campagnes partagent les mêmes codes).", 409);
    }
    if (input.maxRedemptions !== null && input.maxRedemptions < uses) throw new CommercialError(`Le quota ne peut pas être inférieur aux ${uses} réclamations déjà faites.`, 409);
    const plans = await assertPlans(tx, input.planIds);
    const previousPlans = await tx.select({ code: subscriptionPlan.code }).from(promotionEligiblePlan)
      .innerJoin(subscriptionPlan, eq(subscriptionPlan.id, promotionEligiblePlan.planId)).where(eq(promotionEligiblePlan.promotionId, id));
    const before = campaignSnapshot({
      code: current.code, name: current.campaign ?? "", description: readDescription(current.publicDescription), planIds: [],
      grantDays: current.grantDays, discountPercent: current.discountPercent, discountXof: current.discountXof?.toString() ?? null,
      startsAt: current.startsAt.toISOString(), endsAt: current.endsAt?.toISOString() ?? null, maxRedemptions: current.maxRedemptions, active: current.active,
    }, previousPlans.map((plan) => plan.code));
    const after = campaignSnapshot(input, plans.map((plan) => plan.code));
    await tx.update(promotionCode).set({
      code: input.code, campaign: input.name, publicDescription: input.description, grantDays: input.grantDays, discountPercent: input.discountPercent,
      discountXof: input.discountXof === null ? null : BigInt(input.discountXof), startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : null,
      maxRedemptions: input.maxRedemptions, active: input.active, updatedAt: new Date(),
    }).where(eq(promotionCode.id, id));
    // Liste des formules : configuration courante (l'historique des réclamations garde l'abonnement réel).
    await tx.delete(promotionEligiblePlan).where(eq(promotionEligiblePlan.promotionId, id));
    await tx.insert(promotionEligiblePlan).values(plans.map((plan) => ({ promotionId: id, planId: plan.id })));
    const changed = Object.keys(after).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]));
    const descriptionChanged = JSON.stringify(readDescription(current.publicDescription)) !== JSON.stringify(input.description);
    await writePlatformAudit(tx as unknown as Db, {
      actorUserId, eventType: "platform.campaign_updated", entityType: "promotion", entityId: id,
      before: Object.fromEntries(changed.map((key) => [key, before[key] ?? null])), after: Object.fromEntries(changed.map((key) => [key, after[key] ?? null])),
      metadata: { code: input.code, campaign: input.name, changedFields: [...changed, ...(descriptionChanged ? ["description"] : [])].join(",") },
    });
    return { id };
  });
}

const statusSchema = z.object({ action: z.enum(["pause", "resume", "revoke"]), reason: reasonSchema }).strict();

/** Désactivation (pause, réversible) ou révocation (définitive) d'une campagne, motivées et tracées. */
export async function setPublicCampaignStatus(db: Db, actorUserId: string, id: string, raw: unknown) {
  const { action, reason } = statusSchema.parse(raw);
  await requirePlatformAdmin(db, actorUserId);
  return db.transaction(async (tx) => {
    const [promo] = await tx.select({ id: promotionCode.id, code: promotionCode.code, active: promotionCode.active, revokedAt: promotionCode.revokedAt })
      .from(promotionCode).where(and(eq(promotionCode.id, id), eq(promotionCode.audience, "public"))).for("update").limit(1);
    if (!promo) throw new CommercialError("Campagne introuvable.", 404);
    if (promo.revokedAt) throw new CommercialError("Cette campagne est déjà révoquée, définitivement.", 409);
    const now = new Date();
    const values = action === "revoke" ? { active: false, revokedAt: now, revokedByUserId: actorUserId, revokeReason: reason, updatedAt: now } : { active: action === "resume", updatedAt: now };
    await tx.update(promotionCode).set(values).where(eq(promotionCode.id, id));
    await writePlatformAudit(tx as unknown as Db, {
      actorUserId, eventType: { pause: "platform.campaign_paused", resume: "platform.campaign_resumed", revoke: "platform.campaign_revoked" }[action],
      entityType: "promotion", entityId: id, before: { active: promo.active, revoked: false }, after: { active: values.active, revoked: action === "revoke" },
      reason, metadata: { code: promo.code },
    });
    return { id, action };
  });
}
