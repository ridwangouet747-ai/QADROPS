import * as Sentry from "@sentry/nextjs";

export async function POST() {
  const enabled = process.env.NODE_ENV === "development" && process.env.SENTRY_TEST_ENABLED === "true";
  if (!enabled) return new Response(null, { status: 404 });
  if (!process.env.SENTRY_DSN) {
    return Response.json({ error: "SENTRY_NOT_CONFIGURED" }, { status: 503 });
  }

  Sentry.captureException(new Error("QADR OPS Sentry setup test"));
  await Sentry.flush(2_000);
  return Response.json({ accepted: true });
}
