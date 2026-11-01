import * as Sentry from "@sentry/nextjs";

// Ce fichier doit rester dans `src/` (à côté de `app/`) : avec un dossier `src`, Next.js ignore un
// `instrumentation.ts` placé à la racine, et Sentry ne démarrerait jamais.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Erreurs serveur interceptées par Next.js (rendu des pages, actions) : transmises à Sentry, qui ne fait
// rien sans DSN. Le filtre beforeSend de sentry.*.config.ts retire messages et données de la requête.
export const onRequestError = Sentry.captureRequestError;
