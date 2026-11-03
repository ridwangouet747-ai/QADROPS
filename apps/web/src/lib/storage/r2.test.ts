import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { R2FileStorage } from "./r2";
import { sha256Hex } from "./sigv4";
import { StorageError } from "./types";

/*
 * Adaptateur R2 avec un `fetch` injecté : aucune requête ne part vers Cloudflare. On vérifie la forme exacte
 * des requêtes (point de terminaison, chemin, en-têtes signés) et le traitement des réponses.
 */
const config = { accountId: "0123456789abcdef0123456789abcdef", bucket: "qadr-fichiers", accessKeyId: "AKIDEXAMPLE0000000000", secretAccessKey: "secretdetestnonvalide0000000000000000000000" };
const key = `import_source/${"a".repeat(64)}`;
const now = () => new Date("2026-11-03T10:00:00Z");

type Seen = { url: string; method: string; headers: Headers; body: Buffer | null };

function fakeFetch(respond: (seen: Seen) => Response) {
  const calls: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const seen = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ? Buffer.from(init.body as Uint8Array) : null };
    calls.push(seen);
    return respond(seen);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("adaptateur R2 (API S3, fetch simulé)", () => {
  it("dépose un objet : chemin /bucket/clé, corps signé, MD5, type réel, jamais d'écrasement", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response(null, { status: 200 }));
    const storage = new R2FileStorage(config, { fetch: fetchImpl, now });
    const bytes = Buffer.from("Nom;Prix\nSavon;300\n");
    await storage.put(key, bytes, { contentType: "text/csv; charset=utf-8", contentDisposition: "attachment; filename=\"fichier-origine.csv\"" });
    const [call] = calls;
    expect(call!.method).toBe("PUT");
    expect(call!.url).toBe(`https://${config.accountId}.r2.cloudflarestorage.com/qadr-fichiers/${key}`);
    expect(call!.body?.equals(bytes)).toBe(true);
    expect(call!.headers.get("x-amz-content-sha256")).toBe(sha256Hex(bytes));
    expect(call!.headers.get("content-md5")).toBe(createHash("md5").update(bytes).digest("base64"));
    expect(call!.headers.get("if-none-match")).toBe("*");
    expect(call!.headers.get("x-amz-date")).toBe("20261103T100000Z");
    const authorization = call!.headers.get("authorization")!;
    expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE0000000000\/20261103\/auto\/s3\/aws4_request, SignedHeaders=content-disposition;content-md5;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(authorization).not.toContain(config.secretAccessKey);
  });

  it("utilise le point de terminaison de la juridiction quand le bucket en a une", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response(null, { status: 204 }));
    await new R2FileStorage({ ...config, jurisdiction: "eu" }, { fetch: fetchImpl, now }).delete(key);
    expect(new URL(calls[0]!.url).host).toBe(`${config.accountId}.eu.r2.cloudflarestorage.com`);
  });

  it("lecture, métadonnées, existence et suppression ; un objet absent n'est pas une erreur", async () => {
    const stored = Buffer.from("contenu");
    const { calls, fetchImpl } = fakeFetch((seen) => {
      if (seen.url.endsWith("b".repeat(64))) return new Response(null, { status: 404 });
      if (seen.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": "7", "content-type": "text/csv", etag: "\"e\"" } });
      if (seen.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(stored, { status: 200 });
    });
    const storage = new R2FileStorage(config, { fetch: fetchImpl, now });
    const missing = `import_source/${"b".repeat(64)}`;
    expect(Buffer.from((await storage.get(key))!).equals(stored)).toBe(true);
    expect(await storage.get(missing)).toBeNull();
    expect(await storage.head(key)).toEqual({ size: 7, contentType: "text/csv", etag: "\"e\"" });
    expect(await storage.exists(missing)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
    await expect(storage.delete(missing)).resolves.toBeUndefined();
    for (const call of calls.filter((item) => item.method !== "PUT")) {
      expect(call.headers.get("x-amz-content-sha256")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
  });

  it("une erreur du service ou du réseau devient une StorageError sans URL, clé ni secret", async () => {
    const refused = new R2FileStorage(config, { fetch: fakeFetch(() => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })).fetchImpl, now });
    const error = await refused.put(key, Buffer.from("x"), { contentType: "text/csv", contentDisposition: "attachment" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "rejected", status: 403 });
    const offline = new R2FileStorage(config, { fetch: (async () => { throw new TypeError(`fetch failed https://${config.accountId}.r2.cloudflarestorage.com`); }) as typeof fetch, now });
    const network = await offline.get(key).catch((caught: unknown) => caught) as StorageError;
    expect(network).toMatchObject({ code: "network" });
    for (const secret of [config.accountId, config.secretAccessKey, key, "AccessDenied"]) {
      expect(String((error as Error).message)).not.toContain(secret);
      expect(network.message).not.toContain(secret);
    }
  });

  it("refuse toute clé qui n'a pas été produite par le serveur (chemin, nom de fichier, ..)", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response(null, { status: 200 }));
    const storage = new R2FileStorage(config, { fetch: fetchImpl, now });
    for (const bad of ["../autre-bucket/x", "import_source/catalogue.csv", `/import_source/${"a".repeat(64)}`, `import_source/${"A".repeat(64)}`]) {
      await expect(storage.get(bad)).rejects.toMatchObject({ code: "invalid_key" });
      await expect(storage.createDownloadUrl(bad, 300)).rejects.toMatchObject({ code: "invalid_key" });
    }
    expect(calls).toHaveLength(0);
  });

  it("URL de téléchargement présignée : GET, 5 minutes, bonne clé, sans secret", async () => {
    const storage = new R2FileStorage(config, { now });
    const url = new URL((await storage.createDownloadUrl(key, 300))!);
    expect(url.host).toBe(`${config.accountId}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/qadr-fichiers/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE0000000000/20261103/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.toString()).not.toContain(config.secretAccessKey);
  });
});
