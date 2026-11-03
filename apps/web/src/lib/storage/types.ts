/*
 * Contrat minimal du stockage privé de fichiers (mission 12, lot L2, décision D-12-3).
 * Les modules métier ne dépendent que de ce contrat : l'adaptateur R2 (`r2.ts`) peut être remplacé
 * sans toucher aux services. L'adaptateur mémoire (`memory.ts`) est réservé aux tests et à l'aperçu.
 *
 * Le stockage ne décide JAMAIS d'un accès : l'appartenance du fichier au commerce et la permission sont
 * vérifiées en base avant tout appel (voir `lib/domain/stored-files.ts`).
 */

export type PutObjectOptions = {
  /** Type MIME déduit du contenu (jamais celui annoncé par le navigateur). */
  contentType: string;
  /** Enregistré avec l'objet : le navigateur télécharge le fichier au lieu de l'afficher. */
  contentDisposition: string;
};

export type ObjectMetadata = { size: number; contentType: string | null; etag: string | null };

export interface FileStorage {
  readonly kind: "r2" | "memory";
  /** Dépose un objet. Ne remplace jamais un objet existant (clé aléatoire, `If-None-Match: *` côté R2). */
  put(key: string, bytes: Uint8Array, options: PutObjectOptions): Promise<void>;
  /** Contenu de l'objet, ou `null` s'il n'existe pas. */
  get(key: string): Promise<Uint8Array | null>;
  /** Métadonnées sans le contenu, ou `null` si l'objet n'existe pas. */
  head(key: string): Promise<ObjectMetadata | null>;
  exists(key: string): Promise<boolean>;
  /** Suppression idempotente : un objet déjà absent n'est pas une erreur. */
  delete(key: string): Promise<void>;
  /**
   * URL temporaire signée de lecture, ou `null` si l'adaptateur ne sait pas en produire (mémoire) :
   * l'appelant sert alors le contenu lui-même, après les mêmes contrôles.
   */
  createDownloadUrl(key: string, expiresSeconds: number): Promise<string | null>;
}

export type StorageErrorCode = "network" | "rejected" | "invalid_key";

/** Erreur de stockage : le message ne contient ni secret, ni clé d'accès, ni contenu de fichier. */
export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = "StorageError";
  }
}

/** Clé d'objet produite par le serveur : `<finalité>/<64 caractères hexadécimaux aléatoires>`. */
const OBJECT_KEY = /^[a-z_]{1,32}\/[0-9a-f]{64}$/;

export function assertObjectKey(key: string) {
  if (!OBJECT_KEY.test(key)) throw new StorageError("invalid_key", "Clé d’objet refusée.");
}
