/**
 * Limiteur de tentatives en MÉMOIRE LOCALE (fenêtre fixe par clé), pour les routes publiques sans
 * session (mission 12 : vérification d'un code de campagne).
 *
 * Limite assumée : chaque instance du serveur a son propre compteur. Sur plusieurs instances (Vercel,
 * plusieurs régions), la limite réelle est multipliée par le nombre d'instances et repart de zéro à
 * chaque démarrage. C'est une barrière contre l'énumération naïve, pas une protection distribuée ;
 * Cloudflare (WAF, règles de débit) reste la défense de bordure. Aucune donnée n'est écrite en base :
 * une route publique ne doit pas offrir d'écriture gratuite à un attaquant.
 */
export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export function createMemoryRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }) {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  /** Retire les fenêtres échues, puis les plus anciennes si la table reste pleine (mémoire bornée). */
  function prune(now: number) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    while (buckets.size >= maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    consume(key: string, now = Date.now()): RateLimitDecision {
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (!bucket && buckets.size >= maxKeys) prune(now);
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
      bucket.count += 1;
      return { allowed: true, remaining: limit - bucket.count };
    },
    /** Tests uniquement. */
    reset() { buckets.clear(); },
    get size() { return buckets.size; },
  };
}

/**
 * Vérification publique d'un code de campagne (/api/public/campaigns/check) : 20 essais par adresse IP
 * et par fenêtre de 10 minutes. Largement assez pour une personne qui se trompe de saisie, trop peu pour
 * parcourir l'espace des codes depuis une seule adresse.
 */
export const publicCampaignCheckLimiter = createMemoryRateLimiter({ limit: 20, windowMs: 10 * 60_000 });
