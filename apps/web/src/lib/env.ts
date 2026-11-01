import { z } from "zod";

const optionalNonEmpty = z.string().trim().min(1).optional();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalNonEmpty,
  BETTER_AUTH_SECRET: optionalNonEmpty,
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_AUTH_URL: z.string().url().default("http://localhost:3000"),
  TURNSTILE_SECRET_KEY: optionalNonEmpty,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalNonEmpty,
  RESEND_API_KEY: optionalNonEmpty,
  RESEND_FROM_EMAIL: optionalNonEmpty,
  RESEND_REPLY_TO: z.union([z.literal(""), z.email()]).optional(),
  SENTRY_DSN: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional().or(z.literal("")),
  SENTRY_ENVIRONMENT: z.string().default("development"),
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().default("development"),
  NEXT_PUBLIC_POSTHOG_KEY: optionalNonEmpty,
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{87}$/).optional().or(z.literal("")),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional().or(z.literal("")),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/).optional().or(z.literal("")),
  NOTIFICATIONS_CRON_SECRET: z.string().min(32).optional().or(z.literal("")),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new Error("Configuration d’environnement invalide. Vérifiez les noms et formats des variables.");
  }
  const values = result.data;
  if (Boolean(values.TURNSTILE_SECRET_KEY) !== Boolean(values.NEXT_PUBLIC_TURNSTILE_SITE_KEY)) {
    throw new Error("Turnstile nécessite une clé publique et une clé secrète configurées ensemble.");
  }
  if (Boolean(values.RESEND_API_KEY) !== Boolean(values.RESEND_FROM_EMAIL)) {
    throw new Error("Resend nécessite RESEND_API_KEY et RESEND_FROM_EMAIL configurées ensemble.");
  }
  return values;
}

/**
 * En production, l'URL publique (cookies, origine de confiance, liens des e-mails, contrôle Turnstile)
 * doit être déclarée explicitement et servie en HTTPS : la valeur par défaut http://localhost:3000
 * casserait silencieusement connexions et e-mails. `localhost` reste admis pour un `next start` local.
 */
export function assertProductionAuthUrl(value: string | undefined) {
  const url = value?.trim() && URL.canParse(value.trim()) ? new URL(value.trim()) : null;
  const local = url !== null && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!url || (url.protocol !== "https:" && !local)) {
    throw new Error("En production, BETTER_AUTH_URL doit être l’adresse publique HTTPS de l’application.");
  }
}

export function requireDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const value = readEnvironment(source).DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL n’est pas configurée.");
  return value;
}
