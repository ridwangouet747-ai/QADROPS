/**
 * Tâches planifiées Cloudflare (Cron Triggers) : chaque horaire de wrangler.jsonc appelle la route
 * de l'application qui fait le travail, avec le même `Authorization: Bearer <CRON_SECRET>` que l'ancien
 * Vercel Cron. Les routes gardent donc leur propre contrôle du secret.
 * Toute modification d'horaire se fait ici ET dans `triggers.crons` de wrangler.jsonc.
 */
export const CRON_ROUTES: Readonly<Record<string, string>> = {
  "0 1 * * *": "/api/cron/subscriptions",
  "0 7 * * *": "/api/internal/notifications/process",
};

export function cronRequest(cron: string, secret: string | undefined, origin: string | undefined): Request | null {
  const path = CRON_ROUTES[cron];
  const token = secret?.trim();
  if (!path || !token) return null;
  const base = origin?.trim() && URL.canParse(origin.trim()) ? origin.trim() : "https://localhost";
  return new Request(new URL(path, base), { method: "GET", headers: { authorization: `Bearer ${token}` } });
}
