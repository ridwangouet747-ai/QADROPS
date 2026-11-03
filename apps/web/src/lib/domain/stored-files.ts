import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, lt, lte, ne, sql } from "drizzle-orm";
import { storedFile } from "@/lib/db/schema";
import { ORPHAN_GRACE_MS, storagePolicy, type StoragePurpose } from "@/lib/storage/config";
import { detectFileType, STORED_FILE_MIME, type StoredFileType } from "@/lib/storage/file-type";
import { StorageError, type FileStorage } from "@/lib/storage/types";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { assertBusinessOperational, type CommercialTransaction } from "./operation-guard";

/*
 * Fichiers conservés dans le stockage privé (mission 12, lot L2) : métadonnées en base, contenu dans R2.
 *
 * Cycle de vie :
 *   1. `uploadBusinessFile` contrôle taille et type réel, écrit la ligne `pending`, puis dépose l'objet ;
 *   2. la transaction métier qui utilise le fichier appelle `confirmStoredFile` (→ `stored`) ;
 *   3. le passage planifié `purgeStoredFiles` supprime les objets échus et les orphelins (→ `deleted`).
 * Les permissions sont vérifiées par le service appelant (import, export) avant l'étape 1 et avant toute lecture.
 * Aucun contenu de fichier, nom de fichier ni secret n'est journalisé.
 */

type Context = { businessId: string; actorUserId: string };
type Writer = CommercialDatabase | CommercialTransaction;

/** Clé aléatoire non prévisible : ni nom de fichier, ni identifiant de commerce, ni date. */
export const newObjectKey = (purpose: StoragePurpose) => `${purpose}/${randomBytes(32).toString("hex")}`;

const EXTENSIONS: Record<StoredFileType, string> = { csv: "csv", xlsx: "xlsx", pdf: "pdf", jpeg: "jpg", png: "png" };

/** Nom affichable : sans chemin ni caractère de contrôle, 200 caractères au plus. Jamais utilisé dans la clé. */
export const safeDisplayName = (value: string) => value.replace(/^.*[\\/]/, "").replace(/\p{Cc}/gu, "").trim().slice(0, 200) || "fichier";

/** Téléchargement forcé ; nom ASCII générique, nom d'origine encodé (RFC 6266/8187), sans risque d'injection d'en-tête. */
export function attachmentDisposition(displayName: string, type: StoredFileType) {
  return `attachment; filename="fichier-origine.${EXTENSIONS[type]}"; filename*=UTF-8''${encodeURIComponent(safeDisplayName(displayName))}`;
}

function logStorageFailure(event: string, error: unknown) {
  const detail = error instanceof StorageError ? { code: error.code, status: error.status ?? null } : { code: "unexpected" };
  console.warn(JSON.stringify({ event, ...detail }));
}

export type UploadInput = Context & { purpose: StoragePurpose; bytes: Uint8Array; displayName: string; now?: Date };
export type UploadResult = { fileId: string; type: StoredFileType } | { fileId: null; reason: "upload_failed" };

/**
 * Contrôle puis dépôt. Une taille ou un type refusé lève une erreur métier (rien n'est écrit).
 * Un échec du stockage ne lève pas d'erreur : la ligne reste `pending` (nettoyée plus tard) et l'appelant
 * sait que le fichier n'est PAS conservé.
 */
export async function uploadBusinessFile(db: CommercialDatabase, storage: FileStorage, input: UploadInput): Promise<UploadResult> {
  const policy = storagePolicy(input.purpose);
  if (input.bytes.byteLength > policy.maxBytes) {
    throw new CommercialError(`Le fichier dépasse la taille autorisée (${Math.floor(policy.maxBytes / 1024)} Kio).`, 413, "file_too_large");
  }
  const detected = detectFileType(input.bytes);
  if (!detected.type || !policy.types.includes(detected.type)) {
    throw new CommercialError("Ce type de fichier n’est pas accepté.", 415, "file_type_refused");
  }
  const now = input.now ?? new Date();
  const id = randomUUID();
  const objectKey = newObjectKey(input.purpose);
  const displayName = safeDisplayName(input.displayName);
  await db.transaction(async (tx) => {
    await assertBusinessOperational(tx, input.businessId);
    await tx.insert(storedFile).values({ id, businessId: input.businessId, purpose: input.purpose, status: "pending", objectKey, fileType: detected.type,
      sizeBytes: input.bytes.byteLength, sha256: createHash("sha256").update(input.bytes).digest("hex"), displayName,
      uploadedByUserId: input.actorUserId, receivedAt: now, retentionUntil: new Date(now.getTime() + policy.retentionDays * 86_400_000) });
  });
  try {
    await storage.put(objectKey, input.bytes, { contentType: STORED_FILE_MIME[detected.type], contentDisposition: attachmentDisposition(displayName, detected.type) });
  } catch (error) {
    logStorageFailure("storage.upload_failed", error);
    return { fileId: null, reason: "upload_failed" };
  }
  return { fileId: id, type: detected.type };
}

/** À appeler dans la transaction métier qui utilise le fichier : `pending` → `stored`. */
export async function confirmStoredFile(tx: CommercialTransaction, businessId: string, fileId: string, now = new Date()) {
  const updated = await tx.update(storedFile).set({ status: "stored", storedAt: now })
    .where(and(eq(storedFile.businessId, businessId), eq(storedFile.id, fileId), eq(storedFile.status, "pending"))).returning({ id: storedFile.id });
  return updated.length === 1;
}

/** Avance l'échéance de conservation à maintenant : l'objet sera supprimé au prochain passage planifié. */
export async function scheduleStoredFileDeletion(tx: Writer, businessId: string, fileId: string, now = new Date()) {
  await tx.update(storedFile).set({ retentionUntil: sql`least(${storedFile.retentionUntil}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(storedFile.businessId, businessId), eq(storedFile.id, fileId), ne(storedFile.status, "deleted")));
}

/**
 * Suppression immédiate, au mieux, d'un fichier dont l'échéance vient d'être avancée (import abandonné).
 * Si le stockage échoue, l'échéance passée suffit : le passage planifié retentera.
 */
export async function deleteStoredFileNow(db: CommercialDatabase, storage: FileStorage | null, businessId: string, fileId: string, reason: "import_discarded", now = new Date()) {
  if (!storage) return false;
  const [row] = await db.select({ objectKey: storedFile.objectKey }).from(storedFile)
    .where(and(eq(storedFile.businessId, businessId), eq(storedFile.id, fileId), eq(storedFile.status, "stored"), lte(storedFile.retentionUntil, now))).limit(1);
  if (!row) return false;
  try { await storage.delete(row.objectKey); } catch (error) {
    logStorageFailure("storage.delete_failed", error);
    return false;
  }
  const updated = await db.update(storedFile).set({ status: "deleted", deletedAt: now, deletionReason: reason })
    .where(and(eq(storedFile.businessId, businessId), eq(storedFile.id, fileId), eq(storedFile.status, "stored"))).returning({ id: storedFile.id });
  return updated.length === 1;
}

export type DownloadableFile ={ id: string; objectKey: string; fileType: StoredFileType; sha256: string; displayName: string; sizeBytes: number };

/**
 * Lecture autorisée : fournit l'URL signée courte (R2) ou, à défaut, le contenu vérifié par son empreinte.
 * L'appelant a déjà vérifié le commerce et la permission ; `file` vient d'une requête filtrée par commerce.
 */
export async function openStoredFile(storage: FileStorage, file: DownloadableFile, expiresSeconds: number) {
  const url = await storage.createDownloadUrl(file.objectKey, expiresSeconds);
  if (url) return { kind: "redirect" as const, url };
  const bytes = await storage.get(file.objectKey);
  if (!bytes) return null;
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new CommercialError("Le fichier conservé ne correspond plus à l’original.", 409, "file_integrity");
  }
  return { kind: "bytes" as const, bytes, contentType: STORED_FILE_MIME[file.fileType], contentDisposition: attachmentDisposition(file.displayName, file.fileType) };
}

export type PurgeResult = { deleted: number; orphans: number; failed: number; storage: "available" | "unavailable" };

/**
 * Passage planifié (tous commerces) : supprime les objets dont l'échéance est passée, puis les orphelins
 * (`pending` depuis plus d'une heure). La ligne n'est marquée `deleted` qu'après la suppression effective
 * de l'objet ; en cas d'échec elle est retentée au passage suivant. Sans stockage configuré, rien n'est fait.
 */
export async function purgeStoredFiles(db: CommercialDatabase, storage: FileStorage | null, options: { now?: Date; limit?: number } = {}): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  if (!storage) return { deleted: 0, orphans: 0, failed: 0, storage: "unavailable" };
  const columns = { id: storedFile.id, businessId: storedFile.businessId, objectKey: storedFile.objectKey, status: storedFile.status };
  const expired = await db.select(columns).from(storedFile).where(and(eq(storedFile.status, "stored"), lte(storedFile.retentionUntil, now))).orderBy(asc(storedFile.retentionUntil)).limit(limit);
  const orphans = await db.select(columns).from(storedFile).where(and(eq(storedFile.status, "pending"), lt(storedFile.receivedAt, new Date(now.getTime() - ORPHAN_GRACE_MS))))
    .orderBy(asc(storedFile.receivedAt)).limit(limit);
  const result: PurgeResult = { deleted: 0, orphans: 0, failed: 0, storage: "available" };
  for (const [rows, reason] of [[expired, "retention"], [orphans, "orphan"]] as const) {
    for (const row of rows) {
      try { await storage.delete(row.objectKey); } catch (error) {
        logStorageFailure("storage.delete_failed", error);
        result.failed += 1;
        continue;
      }
      // Le statut lu est rechecké : une confirmation concurrente (`pending` → `stored`) n'est pas écrasée.
      const updated = await db.update(storedFile).set({ status: "deleted", deletedAt: now, deletionReason: reason })
        .where(and(eq(storedFile.businessId, row.businessId), eq(storedFile.id, row.id), eq(storedFile.status, row.status))).returning({ id: storedFile.id });
      if (updated.length) result[reason === "retention" ? "deleted" : "orphans"] += 1;
    }
  }
  return result;
}
