import { describe, expect, it } from "vitest";
import { assertProductionAuthUrl, readEnvironment } from "./env";

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

describe("assertProductionAuthUrl", () => {
  it("exige une adresse HTTPS déclarée en production", () => {
    expect(() => assertProductionAuthUrl("https://app.qadrops.ci")).not.toThrow();
    expect(() => assertProductionAuthUrl("http://localhost:3000")).not.toThrow();
    for (const value of [undefined, "", "  ", "http://app.qadrops.ci", "pas une url"]) {
      expect(() => assertProductionAuthUrl(value)).toThrow("BETTER_AUTH_URL");
    }
  });
});
