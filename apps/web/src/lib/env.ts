import { z } from "zod";

const optionalNonEmpty = z.string().trim().min(1).optional();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalNonEmpty,
  // Connexion directe Neon (nom posé par l'intégration Neon/Vercel), réservée aux migrations.
  DATABASE_URL_UNPOOLED: optionalNonEmpty,
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
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{87}$/).optional().or(z.literal("")),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional().or(z.literal("")),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/).optional().or(z.literal("")),
  NOTIFICATIONS_CRON_SECRET: z.string().min(32).optional().or(z.literal("")),
  // Connexions sociales (mission 13) : actives seulement si les deux valeurs du fournisseur sont présentes.
  GOOGLE_CLIENT_ID: optionalNonEmpty,
  GOOGLE_CLIENT_SECRET: optionalNonEmpty,
  APPLE_CLIENT_ID: optionalNonEmpty,
  // Secret client Apple = jeton JWT ES256 signé avec la clé .p8 (6 mois au plus), voir scripts/apple-client-secret.mjs.
  APPLE_CLIENT_SECRET: optionalNonEmpty,
  APPLE_APP_BUNDLE_IDENTIFIER: optionalNonEmpty,
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
  if (Boolean(values.GOOGLE_CLIENT_ID) !== Boolean(values.GOOGLE_CLIENT_SECRET)) {
    throw new Error("Google nécessite GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET configurées ensemble.");
  }
  if (Boolean(values.APPLE_CLIENT_ID) !== Boolean(values.APPLE_CLIENT_SECRET)) {
    throw new Error("Apple nécessite APPLE_CLIENT_ID et APPLE_CLIENT_SECRET configurées ensemble.");
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

/**
 * URL des migrations (drizzle-kit, `scripts/migrate.ts`) : la connexion directe `DATABASE_URL_UNPOOLED`
 * (sans `-pooler`) si elle est déclarée, sinon `DATABASE_URL`. L'application, elle, n'utilise que `DATABASE_URL`.
 */
export function migrationDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string | undefined {
  const values = readEnvironment(source);
  return values.DATABASE_URL_UNPOOLED ?? values.DATABASE_URL;
}

export function requireMigrationDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const value = migrationDatabaseUrl(source);
  if (!value) throw new Error("Ni DATABASE_URL_UNPOOLED ni DATABASE_URL ne sont configurées.");
  return value;
}

/**
 * Fournisseurs de connexion sociale réellement configurés. Apple exige en plus une adresse HTTPS publique
 * (pas de localhost) : sans elle, le bouton n'est pas proposé.
 */
export function socialProviders(source: NodeJS.ProcessEnv = process.env) {
  const env = readEnvironment(source);
  const https = env.BETTER_AUTH_URL.startsWith("https://");
  return {
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null,
    apple: env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET && https
      ? { clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET, appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER } : null,
  };
}
