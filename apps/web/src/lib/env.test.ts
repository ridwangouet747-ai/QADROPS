import { describe, expect, it } from "vitest";
import { assertProductionAuthUrl, migrationDatabaseUrl, readEnvironment, requireDatabaseUrl, requireMigrationDatabaseUrl, socialProviders } from "./env";

describe("readEnvironment", () => {
  it("supports development with optional services absent", () => {
    const result = readEnvironment({ NODE_ENV: "development" });
    expect(result.NEXT_PUBLIC_POSTHOG_KEY).toBeUndefined();
    expect(result.DATABASE_URL).toBeUndefined();
  });

  it("rejects a partial Turnstile configuration", () => {
    expect(() => readEnvironment({
      NODE_ENV: "development",
      TURNSTILE_SECRET_KEY: "test-secret",
    })).toThrow("Turnstile nécessite une clé publique et une clé secrète configurées ensemble.");
  });
});

describe("migrationDatabaseUrl", () => {
  it("préfère la connexion directe pour les migrations, avec repli sur DATABASE_URL", () => {
    const pooled = "postgres://u:p@ep-exemple-pooler.region.aws.neon.tech/db";
    const direct = "postgres://u:p@ep-exemple.region.aws.neon.tech/db";
    expect(migrationDatabaseUrl({ NODE_ENV: "development", DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct })).toBe(direct);
    expect(migrationDatabaseUrl({ NODE_ENV: "development", DATABASE_URL: pooled })).toBe(pooled);
    // Une valeur vide déclarée est une erreur de configuration (même règle que DATABASE_URL).
    expect(() => migrationDatabaseUrl({ NODE_ENV: "development", DATABASE_URL_UNPOOLED: "  " })).toThrow("Configuration");
    expect(() => requireMigrationDatabaseUrl({ NODE_ENV: "development" })).toThrow("DATABASE_URL_UNPOOLED");
    // L'application n'utilise jamais la connexion directe.
    expect(requireDatabaseUrl({ NODE_ENV: "development", DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct })).toBe(pooled);
  });
});

describe("assertProductionAuthUrl", () => {
  it("exige une adresse HTTPS déclarée en production", () => {
    expect(() => assertProductionAuthUrl("https://app.qadrops.ci")).not.toThrow();
    expect(() => assertProductionAuthUrl("http://localhost:3000")).not.toThrow();
    for (const value of [undefined, "", "  ", "http://app.qadrops.ci", "pas une url"]) {
      expect(() => assertProductionAuthUrl(value)).toThrow("BETTER_AUTH_URL");
    }
  });
});

describe("socialProviders (mission 13)", () => {
  // Valeurs de test évidentes : aucun identifiant réel.
  const google = { GOOGLE_CLIENT_ID: "test-google-id", GOOGLE_CLIENT_SECRET: "test-google-secret" };
  const apple = { APPLE_CLIENT_ID: "com.exemple.test", APPLE_CLIENT_SECRET: "test-apple-jwt" };

  it("aucun bouton sans identifiants", () => {
    expect(socialProviders({ NODE_ENV: "development" })).toEqual({ google: null, apple: null });
  });

  it("Google seul, en local comme en HTTPS", () => {
    expect(socialProviders({ NODE_ENV: "development", ...google }).google).toEqual({ clientId: "test-google-id", clientSecret: "test-google-secret" });
  });

  it("Apple seulement derrière une adresse HTTPS", () => {
    expect(socialProviders({ NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3000", ...apple }).apple).toBeNull();
    expect(socialProviders({ NODE_ENV: "development", BETTER_AUTH_URL: "https://preprod.exemple.test", ...apple }).apple)
      .toEqual({ clientId: "com.exemple.test", clientSecret: "test-apple-jwt", appBundleIdentifier: undefined });
  });

  it("refuse une paire incomplète", () => {
    expect(() => readEnvironment({ NODE_ENV: "development", GOOGLE_CLIENT_ID: "seul" })).toThrow("Google nécessite GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET configurées ensemble.");
    expect(() => readEnvironment({ NODE_ENV: "development", APPLE_CLIENT_SECRET: "seul" })).toThrow("Apple nécessite APPLE_CLIENT_ID et APPLE_CLIENT_SECRET configurées ensemble.");
  });
});
