import { describe, expect, it } from "vitest";
import { getFileStorage, readStorageConfig, storagePolicy } from "./config";

const r2 = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_BUCKET_NAME: "qadr-fichiers",
  R2_ACCESS_KEY_ID: "0123456789abcdef0123456789abcdef", R2_SECRET_ACCESS_KEY: "0123456789abcdef".repeat(4),
};

describe("choix du stockage", () => {
  it("R2 quand les quatre variables sont présentes, en production comme ailleurs", () => {
    expect(readStorageConfig({ NODE_ENV: "production", ...r2 })).toMatchObject({ mode: "r2", r2: { bucket: "qadr-fichiers", jurisdiction: null } });
    expect(readStorageConfig({ NODE_ENV: "production", ...r2, R2_JURISDICTION: "eu" })).toMatchObject({ mode: "r2", r2: { jurisdiction: "eu" } });
    expect(getFileStorage({ NODE_ENV: "production", ...r2 })?.kind).toBe("r2");
  });

  it("sans R2 en production : aucun stockage, jamais de repli mémoire ou disque", () => {
    expect(readStorageConfig({ NODE_ENV: "production" })).toEqual({ mode: "none" });
    expect(readStorageConfig({ NODE_ENV: "production", QADR_PREVIEW_MODE: "true" })).toEqual({ mode: "none" });
    expect(getFileStorage({ NODE_ENV: "production" })).toBeNull();
    expect(() => readStorageConfig({ NODE_ENV: "production", QADR_FILE_STORAGE: "memory" })).toThrow("interdit en production");
  });

  it("mémoire seulement hors production, sur demande ou en aperçu local", () => {
    expect(readStorageConfig({ NODE_ENV: "test", QADR_FILE_STORAGE: "memory" })).toEqual({ mode: "memory" });
    expect(readStorageConfig({ NODE_ENV: "development", QADR_PREVIEW_MODE: "true" })).toEqual({ mode: "memory" });
    expect(readStorageConfig({ NODE_ENV: "development" })).toEqual({ mode: "none" });
    expect(getFileStorage({ NODE_ENV: "test", QADR_FILE_STORAGE: "memory" })).toBe(getFileStorage({ NODE_ENV: "test", QADR_FILE_STORAGE: "memory" }));
  });

  it("une configuration R2 partielle ou mal formée est refusée sans citer les valeurs", () => {
    expect(() => readStorageConfig({ NODE_ENV: "development", R2_ACCOUNT_ID: r2.R2_ACCOUNT_ID })).toThrow("ensemble");
    const bad = (() => { try { readStorageConfig({ NODE_ENV: "production", ...r2, R2_BUCKET_NAME: "Bucket_Invalide" }); return null; } catch (error) { return error as Error; } })();
    expect(bad?.message).toContain("R2_BUCKET_NAME");
    expect(bad?.message).not.toContain("Bucket_Invalide");
    expect(() => readStorageConfig({ NODE_ENV: "production", ...r2, R2_JURISDICTION: "mars" })).toThrow("R2_JURISDICTION");
  });
});

describe("politique par finalité", () => {
  it("valeurs par défaut prudentes et types admis", () => {
    expect(storagePolicy("import_source", { NODE_ENV: "test" })).toEqual({ maxBytes: 2 * 1024 * 1024, retentionDays: 90, types: ["csv", "xlsx"] });
    expect(storagePolicy("export", { NODE_ENV: "test" })).toMatchObject({ maxBytes: 10 * 1024 * 1024, retentionDays: 7 });
  });

  it("surcharges bornées : un plafond ou une durée hors limites est une erreur de configuration", () => {
    expect(storagePolicy("import_source", { NODE_ENV: "test", QADR_STORAGE_IMPORT_MAX_BYTES: "1048576", QADR_STORAGE_IMPORT_RETENTION_DAYS: "30" }))
      .toMatchObject({ maxBytes: 1_048_576, retentionDays: 30 });
    expect(() => storagePolicy("import_source", { NODE_ENV: "test", QADR_STORAGE_IMPORT_MAX_BYTES: String(21 * 1024 * 1024) })).toThrow("QADR_STORAGE_IMPORT_MAX_BYTES");
    expect(() => storagePolicy("import_source", { NODE_ENV: "test", QADR_STORAGE_IMPORT_RETENTION_DAYS: "0" })).toThrow();
    expect(() => storagePolicy("export", { NODE_ENV: "test", QADR_STORAGE_EXPORT_RETENTION_DAYS: "7.5" })).toThrow();
  });
});
