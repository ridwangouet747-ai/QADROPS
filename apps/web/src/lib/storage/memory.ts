import { assertObjectKey, type FileStorage, type ObjectMetadata, type PutObjectOptions } from "./types";

/**
 * Stockage en mémoire du processus, pour les tests et l'aperçu local (`QADR_PREVIEW_MODE`).
 * Refusé en production par `getFileStorage()` : rien n'y survit à un redémarrage et rien n'est partagé
 * entre instances. Il ne produit pas d'URL signée : la route sert alors le contenu elle-même.
 */
export class MemoryFileStorage implements FileStorage {
  readonly kind = "memory" as const;
  private readonly objects = new Map<string, { bytes: Uint8Array; options: PutObjectOptions }>();

  async put(key: string, bytes: Uint8Array, options: PutObjectOptions) {
    assertObjectKey(key);
    if (this.objects.has(key)) throw new Error("Objet déjà présent : une clé n’est jamais réutilisée.");
    this.objects.set(key, { bytes: Uint8Array.from(bytes), options: { ...options } });
  }

  async get(key: string) {
    assertObjectKey(key);
    const object = this.objects.get(key);
    return object ? Uint8Array.from(object.bytes) : null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    assertObjectKey(key);
    const object = this.objects.get(key);
    return object ? { size: object.bytes.byteLength, contentType: object.options.contentType, etag: null } : null;
  }

  async exists(key: string) {
    return (await this.head(key)) !== null;
  }

  async delete(key: string) {
    assertObjectKey(key);
    this.objects.delete(key);
  }

  async createDownloadUrl() {
    return null;
  }

  /** Pour les tests : nombre d'objets présents et options d'un objet. */
  get size() { return this.objects.size; }
  optionsOf(key: string) { return this.objects.get(key)?.options ?? null; }
}
