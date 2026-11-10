/**
 * Contrôle d'origine des routes de l'application authentifiées par cookie (mission 16).
 *
 * Better Auth vérifie déjà l'origine de ses propres routes (`trustedOrigins`). Les routes de l'application
 * (`/api/account/*`, `/api/business/*`, `/api/platform/*`, `/api/notifications/*`) ne s'appuyaient que sur
 * le cookie `SameSite=Lax` : il bloque un formulaire posté depuis un AUTRE site, pas depuis un sous-domaine
 * frère (même « site »), et `parseJsonRequest` accepte un corps JSON envoyé en `text/plain` (formulaire HTML
 * sans pré-vol CORS). Ce contrôle ferme cette porte :
 *
 * - en-tête `Origin` présent : il doit être l'origine publique de l'application (`BETTER_AUTH_URL`, la même
 *   que `trustedOrigins` de Better Auth) ou celle de l'hôte qui reçoit la requête (aperçu local, 127.0.0.1) ;
 *   `Origin: null` (iframe isolée, fichier local, redirection) est refusé ;
 * - en-tête `Origin` absent : un navigateur l'envoie pour toute requête autre que GET/HEAD ; son absence
 *   signifie une lecture (GET) ou un client hors navigateur, qui ne porte pas les cookies d'une victime.
 *   Pour une écriture dont la méthode est connue, `Sec-Fetch-Site: cross-site | same-site` sans `Origin`
 *   est tout de même refusé (défense supplémentaire).
 *
 * Les webhooks et les crons n'utilisent pas de cookie et ne passent pas par ce contrôle.
 */

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string | undefined | null) {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

/** Origines de l'application : URL publique configurée (la valeur par défaut de lib/env compris). */
export function applicationOrigins(): Set<string> {
  const origins = new Set<string>();
  // Même repli que readEnvironment() quand BETTER_AUTH_URL manque (développement seulement : la production l'exige).
  const configured = originOf(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  if (configured) origins.add(configured);
  // Aperçu local : Better Auth y prend BETTER_AUTH_URL ou http://localhost:<PORT> (lib/auth/server.ts).
  if (process.env.QADR_PREVIEW_MODE === "true" && process.env.NODE_ENV === "development") {
    origins.add(`http://localhost:${process.env.PORT ?? "3001"}`);
  }
  return origins;
}

export type OriginVerdict = { trusted: true } | { trusted: false; reason: "untrusted_origin" | "null_origin" | "cross_site_without_origin" };

/**
 * Verdict pour une requête : `headers` seuls (méthode inconnue : seule la règle `Origin` s'applique) ou
 * avec la méthode (écriture : la règle `Sec-Fetch-Site` s'ajoute).
 */
export function requestOriginVerdict(headers: Headers, method?: string): OriginVerdict {
  const origin = headers.get("origin");
  if (origin !== null) {
    if (origin.trim().toLowerCase() === "null") return { trusted: false, reason: "null_origin" };
    const parsed = originOf(origin);
    if (!parsed) return { trusted: false, reason: "untrusted_origin" };
    if (applicationOrigins().has(parsed)) return { trusted: true };
    // Même hôte que celui qui reçoit la requête : c'est la définition d'une requête de même origine (un site
    // tiers ne choisit pas l'en-tête Host envoyé par le navigateur de la victime).
    const host = headers.get("host");
    if (host && new URL(parsed).host === host.toLowerCase()) return { trusted: true };
    return { trusted: false, reason: "untrusted_origin" };
  }
  if (method && writeMethods.has(method.toUpperCase())) {
    const site = headers.get("sec-fetch-site");
    if (site === "cross-site" || site === "same-site") return { trusted: false, reason: "cross_site_without_origin" };
  }
  return { trusted: true };
}

/** Message et code stables renvoyés en 403 (même code que la console du propriétaire). */
export const originRefusal = { error: "Origine de la requête refusée.", code: "invalid_origin" } as const;

/** Vrai si la requête peut être traitée ; un refus est journalisé (raison seule). L'appelant répond 403 `originRefusal`. */
export function isTrustedRequest(headers: Headers, method?: string) {
  const verdict = requestOriginVerdict(headers, method);
  if (!verdict.trusted) {
    // Raison seulement : ni origine complète, ni cookie, ni adresse IP dans les journaux.
    console.warn(JSON.stringify({ event: "request.origin_refused", reason: verdict.reason }));
  }
  return verdict.trusted;
}
