import { createHash } from "node:crypto";
import { z } from "zod";
import type { StoredFileType } from "./file-type";
import { MemoryFileStorage } from "./memory";
import { R2FileStorage, type R2Config } from "./r2";
import type { FileStorage } from "./types";

/*
 * Choix du stockage et politique par finalité (mission 12, lot L2).
 *
 * - Les quatre variables R2 renseignées : stockage R2 (seul stockage admis en production).
 * - Sinon, hors production, `QADR_FILE_STORAGE=memory` ou l'aperçu local (`QADR_PREVIEW_MODE=true`) :
 *   stockage en mémoire du processus.
 * - Sinon : AUCUN stockage. Les fonctions qui en ont besoin le disent (pas de repli silencieux sur le
 *   disque local ni sur la mémoire en production).
 * Une configuration R2 partielle ou mal formée est une erreur de configuration explicite.
 */

export const STORAGE_PURPOSES = ["import_source", "export"] as const;
export type StoragePurpose = (typeof STORAGE_PURPOSES)[number];

/** Durée de validité d'une URL de téléchargement signée. */
export const DOWNLOAD_URL_TTL_SECONDS = 300;
/** Une ligne restée `pending` plus longtemps est un envoi échoué ou abandonné : l'objet éventuel est supprimé. */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const MIB = 1024 * 1024;
type PurposeDefaults = { maxBytes: number; hardMaxBytes: number; retentionDays: number; types: readonly StoredFileType[]; env: string };
const PURPOSE_DEFAULTS: Record<StoragePurpose, PurposeDefaults> = {
  // Original d'un import : relu pendant la revue, puis gardé comme provenance. Les PDF/photos viendront avec le lot L5.
  import_source: { maxBytes: 2 * MIB, hardMaxBytes: 20 * MIB, retentionDays: 90, types: ["csv", "xlsx"], env: "IMPORT" },
  // Exports de rapports (pas encore branchés) : régénérables, donc conservés peu de temps.
  export: { maxBytes: 10 * MIB, hardMaxBytes: 50 * MIB, retentionDays: 7, types: ["csv", "xlsx", "pdf"], env: "EXPORT" },
};

export type StoragePolicy = { maxBytes: number; retentionDays: number; types: readonly StoredFileType[] };

function integerSetting(source: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = source[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) throw new Error(`${name} doit être un entier entre ${min} et ${max}.`);
  return value;
}

/** Taille maximale, durée de conservation et types admis pour une finalité (variables facultatives bornées). */
export function storagePolicy(purpose: StoragePurpose, source: NodeJS.ProcessEnv = process.env): StoragePolicy {
  const defaults = PURPOSE_DEFAULTS[purpose];
  return {
    maxBytes: integerSetting(source, `QADR_STORAGE_${defaults.env}_MAX_BYTES`, defaults.maxBytes, 1, defaults.hardMaxBytes),
    retentionDays: integerSetting(source, `QADR_STORAGE_${defaults.env}_RETENTION_DAYS`, defaults.retentionDays, 1, 3650),
    types: defaults.types,
  };
}

const r2Schema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/),
  R2_BUCKET_NAME: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  R2_ACCESS_KEY_ID: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
  R2_SECRET_ACCESS_KEY: z.string().regex(/^[A-Za-z0-9]{32,128}$/),
  R2_JURISDICTION: z.enum(["eu", "fedramp"]).optional(),
});
const R2_VARIABLES = ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

export type StorageConfig = { mode: "r2"; r2: R2Config } | { mode: "memory" } | { mode: "none" };

export function readStorageConfig(source: NodeJS.ProcessEnv = process.env): StorageConfig {
  const value = (name: string) => source[name]?.trim() || undefined;
  const present = R2_VARIABLES.filter((name) => value(name));
  if (present.length > 0 && present.length < R2_VARIABLES.length) {
    throw new Error("Cloudflare R2 nécessite R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID et R2_SECRET_ACCESS_KEY ensemble.");
  }
  const production = source.NODE_ENV === "production";
  if (production && value("QADR_FILE_STORAGE") === "memory") {
    throw new Error("Le stockage en mémoire est interdit en production : configurez Cloudflare R2.");
  }
  if (present.length === R2_VARIABLES.length) {
    const parsed = r2Schema.safeParse(Object.fromEntries([...R2_VARIABLES, "R2_JURISDICTION"].map((name) => [name, value(name)])));
    // Le détail de zod pourrait citer une valeur : seul le nom des variables est donné.
    if (!parsed.success) throw new Error(`Configuration R2 invalide (${[...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].join(", ")}).`);
    const r2 = parsed.data;
    return { mode: "r2", r2: { accountId: r2.R2_ACCOUNT_ID, bucket: r2.R2_BUCKET_NAME, accessKeyId: r2.R2_ACCESS_KEY_ID, secretAccessKey: r2.R2_SECRET_ACCESS_KEY, jurisdiction: r2.R2_JURISDICTION ?? null } };
  }
  if (!production && (value("QADR_FILE_STORAGE") === "memory" || value("QADR_PREVIEW_MODE") === "true")) return { mode: "memory" };
  return { mode: "none" };
}

const MEMORY_KEY = Symbol.for("qadr-ops.file-storage.memory");
const R2_KEY = Symbol.for("qadr-ops.file-storage.r2");
type StorageGlobal = typeof globalThis & { [MEMORY_KEY]?: MemoryFileStorage; [R2_KEY]?: { signature: string; storage: R2FileStorage } };

/**
 * Stockage de l'application, ou `null` s'il n'est pas configuré. Une instance par processus
 * (la mémoire est partagée par toutes les requêtes du processus, comme la base d'aperçu).
 */
export function getFileStorage(source: NodeJS.ProcessEnv = process.env): FileStorage | null {
  const config = readStorageConfig(source);
  const global = globalThis as StorageGlobal;
  if (config.mode === "none") return null;
  if (config.mode === "memory") return (global[MEMORY_KEY] ??= new MemoryFileStorage());
  const signature = createHash("sha256").update(JSON.stringify(config.r2)).digest("hex");
  if (global[R2_KEY]?.signature !== signature) global[R2_KEY] = { signature, storage: new R2FileStorage(config.r2) };
  return global[R2_KEY]!.storage;
}

/** État affichable (sans secret) : utilisé par l'interface et la documentation d'exploitation. */
export function storageMode(source: NodeJS.ProcessEnv = process.env): StorageConfig["mode"] {
  return readStorageConfig(source).mode;
}
