import { describe, expect, it } from "vitest";
import { readEnvironment } from "./env";

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
