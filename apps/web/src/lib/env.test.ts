import { describe, expect, it } from "vitest";
import { assertProductionAuthUrl, migrationDatabaseUrl, readEnvironment, requireDatabaseUrl, requireMigrationDatabaseUrl } from "./env";

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
