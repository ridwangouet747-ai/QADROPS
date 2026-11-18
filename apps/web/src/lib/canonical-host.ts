/**
 * Adresse unique de la production (2026-11-18).
 *
 * Vercel sert la même production sous plusieurs noms (`web-qadragency.vercel.app`, `web-phi-beryl-45.vercel.app`,
 * adresses propres à chaque déploiement). Or tout ce qui protège l'inscription est lié à **une** adresse, celle de
 * `BETTER_AUTH_URL` : le contrôle d'origine de Better Auth (« Invalid origin » ailleurs), le nom d'hôte attendu
 * par la vérification Turnstile côté serveur, la liste de domaines du widget Turnstile (erreur 110200
 * « domaine non autorisé » ailleurs) et les cookies de session. Constaté en production : sur l'autre adresse,
 * `/redeem-code` affichait « La vérification de sécurité n'a pas pu se charger ».
 *
 * En production Vercel, toute page demandée sous un autre nom est donc renvoyée (307) vers l'adresse de
 * `BETTER_AUTH_URL`, chemin et paramètres conservés. Les routes `/api/*` (crons, webhooks) et les fichiers
 * `/_next/*` ne sont jamais redirigés : une redirection y casserait un appel machine. Redirection temporaire,
 * pour qu'un futur domaine propre (nouvelle `BETTER_AUTH_URL`) prenne le relais sans cache navigateur.
 */
type HostRedirect = {
  source: string; destination: string; permanent: false;
  missing: { type: "host"; value: string }[];
};

export function canonicalHostRedirects(env: Record<string, string | undefined> = process.env): HostRedirect[] {
  if (env.VERCEL_ENV !== "production") return [];
  let canonical: URL;
  try { canonical = new URL(env.BETTER_AUTH_URL ?? ""); } catch { return []; }
  if (canonical.protocol !== "https:") return [];
  const missing = [{ type: "host" as const, value: `^${canonical.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` }];
  return [
    { source: "/", destination: `${canonical.origin}/`, permanent: false, missing },
    { source: "/:path((?!api/|_next/).+)", destination: `${canonical.origin}/:path`, permanent: false, missing },
  ];
}
