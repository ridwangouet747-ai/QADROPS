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

export function requireDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const value = readEnvironment(source).DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL n’est pas configurée.");
  return value;
}
