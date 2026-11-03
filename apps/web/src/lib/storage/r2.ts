import { createHash } from "node:crypto";
import { canonicalUri, EMPTY_PAYLOAD_SHA256, presignUrl, sha256Hex, signHeaders, type SigV4Credentials } from "./sigv4";
import { assertObjectKey, StorageError, type FileStorage, type ObjectMetadata, type PutObjectOptions } from "./types";

/*
 * Adaptateur Cloudflare R2 par l'API compatible S3 (documentation R2 lue le 2026-11-03) :
 * - point de terminaison `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, ou
 *   `https://<ACCOUNT_ID>.<juridiction>.r2.cloudflarestorage.com` pour un bucket créé dans une juridiction (`eu`) ;
 * - région de signature `auto` ; adressage par chemin `/<bucket>/<clé>` ;
 * - URL présignées : GET/HEAD/PUT/DELETE, 1 s à 7 jours, jamais avec un domaine personnalisé.
 * Signature SigV4 maison (`sigv4.ts`), sans SDK. `fetch` est injectable : les tests n'appellent jamais R2.
 */

export type R2Jurisdiction = "eu" | "fedramp";
export type R2Config = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; jurisdiction?: R2Jurisdiction | null };
export type R2Dependencies = { fetch?: typeof fetch; now?: () => Date; timeoutMs?: number };

export function r2Host(accountId: string, jurisdiction?: R2Jurisdiction | null) {
  return jurisdiction ? `${accountId}.${jurisdiction}.r2.cloudflarestorage.com` : `${accountId}.r2.cloudflarestorage.com`;
}

export class R2FileStorage implements FileStorage {
  readonly kind = "r2" as const;
  private readonly host: string;
  private readonly credentials: SigV4Credentials;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly config: R2Config, dependencies: R2Dependencies = {}) {
    this.host = r2Host(config.accountId, config.jurisdiction);
    this.credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.timeoutMs = dependencies.timeoutMs ?? 15_000;
  }

  private path(key: string) {
    assertObjectKey(key);
    return `/${this.config.bucket}/${key}`;
  }

  private async send(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, payloadHash: string, headers: Record<string, string> = {}, body?: Uint8Array) {
    const request = { method, host: this.host, path: this.path(key), headers };
    const signed = signHeaders(request, payloadHash, { credentials: this.credentials, region: "auto", service: "s3", date: this.now() });
    try {
      return await this.fetchImpl(`https://${this.host}${canonicalUri(request.path)}`, {
        method, headers: signed, body: body ? Buffer.from(body) : undefined, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Le message d'origine peut contenir l'URL : il n'est pas repris.
      throw new StorageError("network", "Le stockage de fichiers ne répond pas.");
    }
  }

  /** Corps d'erreur lu puis jeté (libère la connexion) ; il n'est jamais journalisé. */
  private async refuse(response: Response, action: string): Promise<never> {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageError("rejected", `Le stockage de fichiers a refusé l’opération (${action}).`, response.status);
  }

  async put(key: string, bytes: Uint8Array, options: PutObjectOptions) {
    const payloadHash = sha256Hex(bytes);
    const response = await this.send("PUT", key, payloadHash, {
      "content-type": options.contentType,
      "content-disposition": options.contentDisposition,
      // Contrôle d'intégrité par R2, en plus de l'empreinte SHA-256 signée.
      "content-md5": createHash("md5").update(bytes).digest("base64"),
      // Une clé n'est jamais réutilisée : un objet existant n'est jamais écrasé.
      "if-none-match": "*",
    }, bytes);
    if (!response.ok) await this.refuse(response, "dépôt");
    await response.arrayBuffer().catch(() => undefined);
  }

  async get(key: string) {
    const response = await this.send("GET", key, EMPTY_PAYLOAD_SHA256);
    if (response.status === 404) { await response.arrayBuffer().catch(() => undefined); return null; }
    if (!response.ok) await this.refuse(response, "lecture");
    return new Uint8Array(await response.arrayBuffer());
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const response = await this.send("HEAD", key, EMPTY_PAYLOAD_SHA256);
    if (response.status === 404) return null;
    if (!response.ok) await this.refuse(response, "métadonnées");
    return {
      size: Number(response.headers.get("content-length") ?? 0),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
    };
  }

  async exists(key: string) {
    return (await this.head(key)) !== null;
  }

  async delete(key: string) {
    const response = await this.send("DELETE", key, EMPTY_PAYLOAD_SHA256);
    if (!response.ok && response.status !== 404) await this.refuse(response, "suppression");
    await response.arrayBuffer().catch(() => undefined);
  }

  async createDownloadUrl(key: string, expiresSeconds: number) {
    return presignUrl({ method: "GET", host: this.host, path: this.path(key) },
      { credentials: this.credentials, region: "auto", service: "s3", date: this.now(), expiresSeconds });
  }
}
