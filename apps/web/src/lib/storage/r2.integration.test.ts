import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import type { CommercialDatabase } from "../domain/commercial";
import { createCatalogImport, discardImportBatch, getImportOriginal } from "../domain/imports";
import { purgeStoredFiles, uploadBusinessFile } from "../domain/stored-files";
import { DOWNLOAD_URL_TTL_SECONDS } from "./config";
import { R2FileStorage, r2Host } from "./r2";
import { readR2TestTarget } from "./r2-test-target";
import { EMPTY_PAYLOAD_SHA256, canonicalUri, sha256Hex, signHeaders } from "./sigv4";
import { StorageError, type FileStorage } from "./types";

/*
 * Mission 16 : essai RÉEL de l'adaptateur R2 contre un bucket de test.
 *
 * Sauté sans les variables dédiées QADR_TEST_R2_* (voir `r2-test-target.ts`) ; refusé si le bucket ne porte pas
 * de marqueur test/staging/dev/preview. Les variables R2_* de l'application ne sont jamais lues ici.
 * Chaque objet créé est supprimé en fin de suite. Aucun contenu, clé d'objet, URL signée ni secret n'est affiché.
 *
 * Lancer (PowerShell, depuis apps/web) :
 *   $env:QADR_TEST_R2_ACCOUNT_ID='…'; $env:QADR_TEST_R2_BUCKET_NAME='qadr-ops-fichiers-staging'
 *   $env:QADR_TEST_R2_ACCESS_KEY_ID='…'; $env:QADR_TEST_R2_SECRET_ACCESS_KEY='…'
 *   npx vitest run src/lib/storage/r2.integration.test.ts
 */
const target = readR2TestTarget();

describe.skipIf(!target.enabled)("mission 16 : Cloudflare R2 réel (bucket de test)", () => {
  const config = target.enabled ? target.config : null!;
  const host = target.enabled ? r2Host(config.accountId, config.jurisdiction) : "";
  const created = new Set<string>();
  const real = target.enabled ? new R2FileStorage(config) : null!;
  /** Même adaptateur, avec la liste des dépôts pour le nettoyage et pour vérifier qu'un refus n'atteint pas R2. */
  const puts: string[] = [];
  const storage: FileStorage = target.enabled ? {
    kind: "r2",
    put: async (key, bytes, options) => { puts.push(key); created.add(key); await real.put(key, bytes, options); },
    get: (key) => real.get(key), head: (key) => real.head(key), exists: (key) => real.exists(key),
    delete: (key) => real.delete(key), createDownloadUrl: (key, seconds) => real.createDownloadUrl(key, seconds),
  } : null!;
  const newKey = () => { const key = `import_source/${randomBytes(32).toString("hex")}`; created.add(key); return key; };
  const csv = (label: string) => Buffer.from(`Désignation;Prix de vente\n${label} ${randomBytes(4).toString("hex")};1500\n`, "utf8");
  const putCsv = (key: string, bytes: Uint8Array) => storage.put(key, bytes, { contentType: "text/csv; charset=utf-8", contentDisposition: "attachment; filename=\"fichier-origine.csv\"" });
  /** Requête signée brute, pour les cas que l'adaptateur ne sait volontairement pas produire. */
  const rawSigned = (method: "GET" | "PUT", path: string, headers: Record<string, string> = {}, body?: Uint8Array) => {
    const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
    const signed = signHeaders({ method, host, path, headers }, payloadHash,
      { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, region: "auto", service: "s3", date: new Date() });
    return fetch(`https://${host}${canonicalUri(path)}`, { method, headers: signed, body: body ? Buffer.from(body) : undefined, redirect: "manual" });
  };

  afterAll(async () => {
    for (const key of created) await real.delete(key).catch(() => undefined);
  });

  it("dépôt, métadonnées, lecture : octets identiques, type et pièce jointe conservés", async () => {
    const key = newKey();
    const bytes = csv("Savon");
    await putCsv(key, bytes);
    expect(await storage.head(key)).toMatchObject({ size: bytes.byteLength, contentType: "text/csv; charset=utf-8" });
    expect(Buffer.from((await storage.get(key))!).equals(bytes)).toBe(true);
    expect(await storage.exists(`import_source/${randomBytes(32).toString("hex")}`)).toBe(false);
  });

  it("jamais d'écrasement (If-None-Match: *) et contrôle d'intégrité Content-MD5", async () => {
    const key = newKey();
    const first = csv("Original");
    await putCsv(key, first);
    const overwrite = await putCsv(key, csv("Remplaçant")).catch((error: unknown) => error);
    expect(overwrite).toBeInstanceOf(StorageError);
    expect((overwrite as StorageError).status).toBe(412);
    expect(Buffer.from((await storage.get(key))!).equals(first)).toBe(true);

    const other = newKey();
    const body = csv("Corrompu");
    const response = await rawSigned("PUT", `/${config.bucket}/${other}`, { "content-md5": createHash("md5").update("autre contenu").digest("base64") }, body);
    await response.arrayBuffer();
    expect(response.ok).toBe(false);
    expect(await storage.exists(other)).toBe(false);
  });

  it("URL signée de 5 min : lisible sans identifiants, en pièce jointe ; altérée ou détournée vers un autre objet, refusée", async () => {
    const key = newKey();
    const otherKey = newKey();
    const bytes = csv("Signé");
    await putCsv(key, bytes);
    await putCsv(otherKey, csv("Autre"));
    const url = (await storage.createDownloadUrl(key, DOWNLOAD_URL_TTL_SECONDS))!;
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("300");
    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);

    const tampered = new URL(url);
    tampered.searchParams.set("X-Amz-Signature", "0".repeat(64));
    const refusedSignature = await fetch(tampered, { redirect: "manual" });
    await refusedSignature.arrayBuffer();
    expect(refusedSignature.status).toBe(403);

    // La signature couvre le chemin : l'URL d'un objet n'ouvre pas un autre objet (même bucket, clé connue).
    const redirected = new URL(url);
    redirected.pathname = canonicalUri(`/${config.bucket}/${otherKey}`);
    const refusedPath = await fetch(redirected, { redirect: "manual" });
    await refusedPath.arrayBuffer();
    expect(refusedPath.status).toBe(403);
  });

  it("URL signée expirée : refusée", async () => {
    const key = newKey();
    await putCsv(key, csv("Expiré"));
    // Signée il y a 10 minutes pour 5 minutes : expirée depuis 5 minutes, sans attendre.
    const past = new R2FileStorage(config, { now: () => new Date(Date.now() - 10 * 60_000) });
    const response = await fetch((await past.createDownloadUrl(key, DOWNLOAD_URL_TTL_SECONDS))!, { redirect: "manual" });
    await response.arrayBuffer();
    expect(response.status).toBe(403);
  });

  it("bucket privé : une lecture sans signature est refusée", async () => {
    const key = newKey();
    const bytes = csv("Privé");
    await putCsv(key, bytes);
    const response = await fetch(`https://${host}${canonicalUri(`/${config.bucket}/${key}`)}`, { redirect: "manual" });
    const body = Buffer.from(await response.arrayBuffer());
    expect(response.ok).toBe(false);
    expect(body.includes(bytes)).toBe(false);
  });

  it("jeton à portée limitée : ni liste des buckets, ni écriture dans un autre bucket", async () => {
    const list = await rawSigned("GET", "/");
    await list.arrayBuffer();
    expect(list.ok).toBe(false);
    const elsewhere = await rawSigned("PUT", `/${config.bucket}-autre-${randomBytes(3).toString("hex")}/import_source/${"0".repeat(64)}`, {}, Buffer.from("x"));
    await elsewhere.arrayBuffer();
    expect(elsewhere.ok).toBe(false);
  });

  it("suppression : idempotente, puis l'objet et son URL signée sont introuvables", async () => {
    const key = newKey();
    await putCsv(key, csv("Supprimé"));
    const url = (await storage.createDownloadUrl(key, DOWNLOAD_URL_TTL_SECONDS))!;
    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    expect(await storage.get(key)).toBeNull();
    const response = await fetch(url, { redirect: "manual" });
    await response.arrayBuffer();
    expect(response.status).toBe(404);
  });

  describe("parcours complet avec la base (PGlite) et R2 réel", () => {
    let client: PGlite;
    let db: CommercialDatabase;
    const a = { businessId: "r2-business-a", actorUserId: "r2-owner-a" };
    const b = { businessId: "r2-business-b", actorUserId: "r2-owner-b" };
    const fileOf = async (batchId: string) => (await client.query<{ id: string; object_key: string; status: string }>(
      "select f.id, f.object_key, f.status from import_batch i join stored_file f on f.business_id=i.business_id and f.id=i.source_file_id where i.id=$1", [batchId])).rows[0]!;

    beforeAll(async () => {
      client = new PGlite();
      db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
      await migrate(drizzle(client, { schema: databaseSchema }), { migrationsFolder: resolve(process.cwd(), "drizzle") });
      for (const [id, email] of [[a.actorUserId, "a@r2.test"], [b.actorUserId, "b@r2.test"]]) await client.query("insert into \"user\" (id,name,email) values ($1,'R2',$2)", [id, email]);
      for (const [id, slug] of [[a.businessId, "r2-a"], [b.businessId, "r2-b"]]) {
        await client.query("insert into organization (id,name,slug) values ($1,'Commerce R2',$2)", [id, slug]);
        await client.query("insert into business_profile (business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
      }
      await client.query("insert into member(id,organization_id,user_id,role) values ('r2m-a',$1,$2,'owner'),('r2m-b',$3,$4,'owner')", [a.businessId, a.actorUserId, b.businessId, b.actorUserId]);
    });

    afterAll(async () => { await client?.close(); });

    it("l'original d'un import de A est servi à A par URL signée, jamais à B (réponse d'un import inconnu)", async () => {
      const bytes = csv("Catalogue A");
      const batch = await createCatalogImport(db, { ...a, fileName: "catalogue-a.csv", bytes }, { storage });
      expect(batch.originalStored).toBe(true);
      const original = await getImportOriginal(db, a, batch.id, { storage });
      expect(original.kind).toBe("redirect");
      if (original.kind === "redirect") {
        const response = await fetch(original.url, { redirect: "manual" });
        expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
      }
      const forB = await getImportOriginal(db, b, batch.id, { storage }).catch((error: Error) => error);
      const unknown = await getImportOriginal(db, b, "00000000-0000-4000-8000-000000000000", { storage }).catch((error: Error) => error);
      expect(forB).toMatchObject({ status: 404, message: "Fichier introuvable." });
      expect(unknown).toMatchObject({ status: 404, message: "Fichier introuvable." });
    });

    it("taille dépassée (413) et type refusé (415) : rien n'est envoyé à R2", async () => {
      const before = puts.length;
      await expect(uploadBusinessFile(db, storage, { ...a, purpose: "import_source", bytes: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]), displayName: "x.csv" }))
        .rejects.toMatchObject({ status: 415, code: "file_type_refused" });
      await expect(uploadBusinessFile(db, storage, { ...a, purpose: "import_source", bytes: Buffer.alloc(2 * 1024 * 1024 + 1, 0x41), displayName: "gros.csv" }))
        .rejects.toMatchObject({ status: 413, code: "file_too_large" });
      expect(puts.length).toBe(before);
    });

    it("abandon de l'import puis passage planifié : objets réellement supprimés de R2", async () => {
      const discarded = await createCatalogImport(db, { ...a, fileName: "abandon.csv", bytes: csv("Abandon") }, { storage });
      const discardedFile = await fileOf(discarded.id);
      await discardImportBatch(db, a, discarded.id, { storage });
      expect((await fileOf(discarded.id)).status).toBe("deleted");
      expect(await real.exists(discardedFile.object_key)).toBe(false);

      const expiring = await createCatalogImport(db, { ...a, fileName: "echu.csv", bytes: csv("Échu") }, { storage });
      const expiringFile = await fileOf(expiring.id);
      const result = await purgeStoredFiles(db, storage, { now: new Date(Date.now() + 91 * 86_400_000) });
      expect(result.failed).toBe(0);
      expect((await fileOf(expiring.id)).status).toBe("deleted");
      expect(await real.exists(expiringFile.object_key)).toBe(false);
    });
  });
});

describe.skipIf(target.enabled)("mission 16 : Cloudflare R2 réel", () => {
  it("sauté : aucune variable QADR_TEST_R2_* ne désigne un bucket de test (aucune requête envoyée)", () => {
    expect(target.enabled).toBe(false);
  });
});
