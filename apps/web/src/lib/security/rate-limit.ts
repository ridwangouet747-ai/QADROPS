import { createHmac } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { rateLimitBucket } from "@/lib/db/schema";
import type { CommercialDatabase } from "@/lib/domain/commercial";

/**
 * Limitation des tentatives partagée par toutes les instances (mission 14).
 *
 * La limitation de Better Auth est gardée en mémoire : chaque instance Vercel a son propre compteur, si bien
 * qu'un attaquant réparti sur plusieurs instances multiplie son quota. Ici, le compteur est une ligne
 * PostgreSQL par (règle, sujet), incrémentée atomiquement : `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
 * Deux instances qui comptent en même temps ne perdent aucune tentative et ne dépassent jamais la limite.
 *
 * - Fenêtre fixe (début aligné sur la durée) : simple, sans tâche de fond ; au plus deux fois la limite à
 *   cheval sur deux fenêtres, ce qui reste borné.
 * - Le sujet (adresse IP, e-mail, empreinte du client) n'est jamais stocké en clair : HMAC avec le secret.
 * - Une tentative réussie peut être rendue (`refundRateLimit`) : seuls les échecs épuisent le quota, mais la
 *   réservation se fait AVANT la vérification, si bien que des requêtes simultanées ne passent pas toutes.
 */
export type RateRule = { readonly name: string; readonly limit: number; readonly windowMs: number };

const MINUTE = 60_000;
export const rateRules = {
  /** Console du propriétaire : par client et au total (tentative distribuée sur beaucoup d'adresses). */
  platformSignInClient: { name: "platform.sign_in.client", limit: 5, windowMs: 15 * MINUTE },
  platformSignInGlobal: { name: "platform.sign_in.global", limit: 30, windowMs: 15 * MINUTE },
  platformVerifyClient: { name: "platform.verify.client", limit: 5, windowMs: 15 * MINUTE },
  platformVerifyGlobal: { name: "platform.verify.global", limit: 30, windowMs: 15 * MINUTE },
  /** Changement du nom ou du mot de passe du propriétaire : le mot de passe actuel n'est pas devinable par essais. */
  platformAccountChange: { name: "platform.account_change", limit: 5, windowMs: 15 * MINUTE },
  /** Vérification publique d'un code de campagne (sans session) : même seuil que la barrière en mémoire, mais partagé entre instances. */
  publicCampaignCheckIp: { name: "public.campaign_check.ip", limit: 20, windowMs: 10 * MINUTE },
  /**
   * Comptes des commerces (routes Better Auth). Les limites par adresse IP restent larges : en Côte d'Ivoire,
   * beaucoup de clients mobiles partagent une même adresse publique (CGNAT). Le compte visé, lui, est
   * protégé plus strictement.
   */
  signInIp: { name: "auth.sign_in.ip", limit: 60, windowMs: 15 * MINUTE },
  signInAccount: { name: "auth.sign_in.account", limit: 10, windowMs: 15 * MINUTE },
  signUpIp: { name: "auth.sign_up.ip", limit: 30, windowMs: 60 * MINUTE },
  passwordResetRequestIp: { name: "auth.reset_request.ip", limit: 20, windowMs: 60 * MINUTE },
  passwordResetRequestAccount: { name: "auth.reset_request.account", limit: 3, windowMs: 60 * MINUTE },
  passwordResetIp: { name: "auth.reset.ip", limit: 20, windowMs: 15 * MINUTE },
  verificationEmailIp: { name: "auth.verification_email.ip", limit: 10, windowMs: 60 * MINUTE },
  socialSignInIp: { name: "auth.social.ip", limit: 60, windowMs: 15 * MINUTE },
  /**
   * Changement du mot de passe d'un commerçant (`/change-password`, mot de passe actuel exigé). Le compte est
   * celui de la session, jamais une valeur du corps : une session volée ne devine pas le mot de passe actuel.
   */
  passwordChangeAccount: { name: "auth.change_password.account", limit: 5, windowMs: 15 * MINUTE },
  passwordChangeIp: { name: "auth.change_password.ip", limit: 20, windowMs: 15 * MINUTE },
} as const satisfies Record<string, RateRule>;

export type RateDecision = { allowed: boolean; hits: number; retryAfterSeconds: number; key: string };

/** Clé stockée : nom de la règle + empreinte du sujet (jamais l'adresse ou l'e-mail eux-mêmes). */
export function rateLimitKey(rule: RateRule, subject: string, secret: string) {
  const digest = createHmac("sha256", secret).update(`${rule.name}\u0000${subject}`).digest("hex").slice(0, 40);
  return `${rule.name}:${digest}`;
}

function windowStartOf(rule: RateRule, now: Date) {
  return new Date(Math.floor(now.getTime() / rule.windowMs) * rule.windowMs);
}

/**
 * Compte une tentative et dit si elle est autorisée. Une fenêtre plus ancienne repart à 1 ; une fenêtre
 * plus récente que celle de l'appelant (horloges d'instances légèrement décalées) est conservée et
 * incrémentée, jamais remise à zéro.
 */
export async function consumeRateLimit(db: CommercialDatabase, rule: RateRule, subject: string, secret: string, now = new Date()): Promise<RateDecision> {
  const key = rateLimitKey(rule, subject, secret);
  const windowStart = windowStartOf(rule, now);
  const [row] = await db.insert(rateLimitBucket).values({ key, windowStart, hits: 1 })
    .onConflictDoUpdate({
      target: rateLimitBucket.key,
      set: {
        hits: sql`case when "rate_limit_bucket"."window_start" >= excluded."window_start" then "rate_limit_bucket"."hits" + 1 else 1 end`,
        windowStart: sql`greatest("rate_limit_bucket"."window_start", excluded."window_start")`,
      },
    })
    .returning({ hits: rateLimitBucket.hits, windowStart: rateLimitBucket.windowStart });
  const hits = row?.hits ?? 1;
  const end = (row?.windowStart ?? windowStart).getTime() + rule.windowMs;
  return { allowed: hits <= rule.limit, hits, retryAfterSeconds: Math.max(1, Math.ceil((end - now.getTime()) / 1000)), key };
}

/** Plusieurs règles à la fois (par exemple adresse IP et compte visé) : refus dès qu'une seule est dépassée. */
export async function consumeRateLimits(db: CommercialDatabase, checks: ReadonlyArray<{ rule: RateRule; subject: string }>, secret: string, now = new Date()) {
  const decisions: RateDecision[] = [];
  for (const check of checks) decisions.push(await consumeRateLimit(db, check.rule, check.subject, secret, now));
  const refused = decisions.filter((decision) => !decision.allowed);
  return {
    allowed: refused.length === 0,
    retryAfterSeconds: refused.length ? Math.max(...refused.map((decision) => decision.retryAfterSeconds)) : 0,
    decisions,
  };
}

/** Rend une tentative réussie (le propriétaire légitime n'épuise pas son propre quota). */
export async function refundRateLimit(db: CommercialDatabase, decisions: ReadonlyArray<RateDecision>) {
  for (const decision of decisions) {
    await db.update(rateLimitBucket).set({ hits: sql`greatest("rate_limit_bucket"."hits" - 1, 0)` }).where(eq(rateLimitBucket.key, decision.key));
  }
}

/** Purge des fenêtres terminées depuis plus d'un jour (appelée par le cron quotidien). */
export async function purgeRateLimitBuckets(db: CommercialDatabase, now = new Date()) {
  const removed = await db.delete(rateLimitBucket).where(lt(rateLimitBucket.windowStart, new Date(now.getTime() - 24 * 60 * MINUTE)))
    .returning({ key: rateLimitBucket.key });
  return removed.length;
}
