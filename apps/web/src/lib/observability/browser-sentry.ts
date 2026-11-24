import * as Sentry from "@sentry/nextjs";

/**
 * Sentry du navigateur, importé seulement par client-errors.ts à la première erreur. Mêmes règles qu'avant :
 * aucune trace, aucune donnée personnelle, ni message ni contexte (seuls le type d'erreur et la pile partent).
 * Les intégrations par défaut sont coupées : client-errors.ts écoute déjà les erreurs globales (pas de double envoi).
 */
export function startBrowserSentry(dsn: string) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    beforeSend(event) {
      event.user = undefined;
      event.request = undefined;
      event.extra = undefined;
      event.contexts = undefined;
      event.tags = undefined;
      event.breadcrumbs = undefined;
      if (event.message) event.message = "Application error";
      if (event.exception?.values) {
        for (const exception of event.exception.values) exception.value = undefined;
      }
      if (event.logentry) event.logentry = { message: "Application error" };
      return event;
    },
  });
  return (error: unknown) => { Sentry.captureException(error); };
}
