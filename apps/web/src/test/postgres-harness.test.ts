import { describe, expect, it } from "vitest";
import { postgresHarnessTarget } from "./postgres-harness";

describe("harnais PostgreSQL réel : garde-fous de la cible", () => {
  const direct = "postgresql://role:motdepasse@ep-exemple.c-1.us-east-1.aws.neon.tech/qadr_staging?sslmode=require";

  it("reste sur PGlite tant qu'aucune base n'est désignée", () => {
    expect(postgresHarnessTarget({})).toBeNull();
  });

  it("exige la déclaration explicite d'une cible de staging", () => {
    expect(() => postgresHarnessTarget({ QADR_TEST_POSTGRES_URL: direct })).toThrow(/QADR_TEST_POSTGRES_TARGET=staging/);
    expect(() => postgresHarnessTarget({ QADR_TEST_POSTGRES_URL: direct, QADR_TEST_POSTGRES_TARGET: "production" })).toThrow();
  });

  it("refuse la base par défaut (branche principale) et la connexion poolée", () => {
    const env = { QADR_TEST_POSTGRES_TARGET: "staging" };
    expect(() => postgresHarnessTarget({ ...env, QADR_TEST_POSTGRES_URL: direct.replace("qadr_staging", "neondb") })).toThrow(/neondb/);
    expect(() => postgresHarnessTarget({ ...env, QADR_TEST_POSTGRES_URL: direct.replace("ep-exemple", "ep-exemple-pooler") })).toThrow(/pooler/);
  });

  it("accepte une base de staging en connexion directe", () => {
    expect(postgresHarnessTarget({ QADR_TEST_POSTGRES_TARGET: "staging", QADR_TEST_POSTGRES_URL: direct })?.pathname).toBe("/qadr_staging");
  });
});
