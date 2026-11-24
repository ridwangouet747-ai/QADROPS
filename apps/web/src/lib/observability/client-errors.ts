/**
 * Signalement des erreurs du navigateur à Sentry, chargé à la PREMIÈRE erreur seulement (mission performance du
 * 2026-11-24). Avant, le SDK (≈ 98 Ko compressés) était téléchargé et lancé sur chaque page, y compris quand rien
 * ne casse. Les erreurs survenues pendant son téléchargement sont gardées puis envoyées dans l'ordre.
 * Le serveur garde son Sentry habituel (sentry.server.config.ts) ; rien ne change pour les erreurs 500.
 */
type Capture = (error: unknown) => void;

const pending: unknown[] = [];
let capture: Capture | null = null;
let loading = false;

export function reportClientError(error: unknown) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || typeof window === "undefined") return;
  if (capture) { capture(error); return; }
  if (pending.length < 20) pending.push(error);
  if (loading) return;
  loading = true;
  void import("./browser-sentry").then(({ startBrowserSentry }) => {
    capture = startBrowserSentry(dsn);
    for (const item of pending.splice(0)) capture(item);
  }).catch(() => {
    // Réseau coupé ou script bloqué : on réessaiera à la prochaine erreur.
    loading = false;
  });
}

/** Branché une fois au démarrage (instrumentation-client.ts) : erreurs non rattrapées et promesses rejetées. */
export function listenForClientErrors() {
  if (typeof window === "undefined" || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  window.addEventListener("error", (event) => reportClientError(event.error ?? new Error("Application error")));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason));
}
