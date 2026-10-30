import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
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
}
