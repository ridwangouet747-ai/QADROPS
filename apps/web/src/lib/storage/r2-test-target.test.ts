import { describe, expect, it } from "vitest";
import { isTestBucketName, readR2TestTarget } from "./r2-test-target";

/* Garde du test R2 réel : il ne vise jamais un bucket sans marqueur de test, ni les variables R2_* de l'application. */
const valid = {
  NODE_ENV: "test" as const,
  QADR_TEST_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  QADR_TEST_R2_BUCKET_NAME: "qadr-ops-fichiers-staging",
  QADR_TEST_R2_ACCESS_KEY_ID: "AKIDEXAMPLE0000000000",
  QADR_TEST_R2_SECRET_ACCESS_KEY: "secretdetestnonvalide0000000000000000000000",
};

describe("cible du test R2 réel", () => {
  it("sans variables dédiées, le test est sauté, même si l'application a des variables R2_*", () => {
    const target = readR2TestTarget({ NODE_ENV: "test", R2_ACCOUNT_ID: valid.QADR_TEST_R2_ACCOUNT_ID, R2_BUCKET_NAME: "qadr-ops-fichiers-staging",
      R2_ACCESS_KEY_ID: valid.QADR_TEST_R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: valid.QADR_TEST_R2_SECRET_ACCESS_KEY });
    expect(target.enabled).toBe(false);
  });

  it("accepte un bucket marqué test/staging/dev/preview et applique la validation de l'application", () => {
    const target = readR2TestTarget({ ...valid, QADR_TEST_R2_JURISDICTION: "eu" });
    expect(target).toMatchObject({ enabled: true, config: { bucket: "qadr-ops-fichiers-staging", jurisdiction: "eu" } });
    for (const name of ["qadr-test", "test-qadr", "qadr-ops-dev", "qadr.preview.files", "qadr-tests"]) expect(isTestBucketName(name)).toBe(true);
  });

  it("refuse un bucket sans marqueur (production probable), y compris un marqueur collé à un autre mot", () => {
    for (const name of ["qadropsbucket", "qadr-ops-fichiers-prod", "latest-files", "devices-qadr", "contest"]) expect(isTestBucketName(name)).toBe(false);
    expect(() => readR2TestTarget({ ...valid, QADR_TEST_R2_BUCKET_NAME: "qadropsbucket" })).toThrow(/qadropsbucket.*marqueur/);
  });

  it("une configuration partielle ou mal formée est une erreur qui ne cite aucun secret", () => {
    expect(() => readR2TestTarget({ NODE_ENV: "test", QADR_TEST_R2_BUCKET_NAME: "qadr-test" })).toThrow(/ensemble/);
    const error = (() => { try { readR2TestTarget({ ...valid, QADR_TEST_R2_SECRET_ACCESS_KEY: "court!" }); } catch (caught) { return caught as Error; } })();
    expect(error?.message).toMatch(/R2_SECRET_ACCESS_KEY/);
    expect(error?.message).not.toContain("court!");
    expect(error?.message).not.toContain(valid.QADR_TEST_R2_ACCESS_KEY_ID);
  });
});
