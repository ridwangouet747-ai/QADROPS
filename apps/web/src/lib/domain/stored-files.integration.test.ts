import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { MemoryFileStorage } from "../storage/memory";
import { R2FileStorage } from "../storage/r2";
import type { CommercialDatabase } from "./commercial";
import { createCatalogImport, discardImportBatch, getImportBatch, getImportOriginal } from "./imports";
import { purgeStoredFiles, uploadBusinessFile } from "./stored-files";

/*
 * Mission 12, lot L2 : conservation du fichier d'origine d'un import (PGlite + stockage mémoire ;
 * l'échec d'envoi est simulé par l'adaptateur R2 avec un `fetch` qui échoue, jamais par un appel réel).
 */
describe("mission 12, lot L2 : fichiers conservés (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const a = { businessId: "files-business-a", actorUserId: "files-owner-a" };
  const b = { businessId: "files-business-b", actorUserId: "files-owner-b" };
  const storage = new MemoryFileStorage();
  let csvCounter = 0;
  const csv = () => Buffer.from(`Désignation;Prix de vente\nArticle ${++csvCounter};${1000 + csvCounter}\n`, "utf8");
  const fileRow = async (id: string) => (await client.query<Record<string, unknown>>("select * from stored_file where id=$1", [id])).rows[0]!;
  const sourceOf = async (batchId: string) => (await client.query<{ source_file_id: string | null }>("select source_file_id from import_batch where id=$1", [batchId])).rows[0]!.source_file_id;

  beforeAll(async () => {
    await migrate(drizzle(client, { schema: databaseSchema }), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, email] of [[a.actorUserId, "a@files.test"], [b.actorUserId, "b@files.test"]]) {
      await client.query("insert into \"user\" (id,name,email) values ($1,'Fichiers',$2)", [id, email]);
    }
    for (const [id, slug] of [[a.businessId, "files-a"], [b.businessId, "files-b"]]) {
      await client.query("insert into organization (id,name,slug) values ($1,'Commerce fichiers',$2)", [id, slug]);
      await client.query("insert into business_profile (business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('fm-a',$1,$2,'owner'),('fm-b',$3,$4,'owner')", [a.businessId, a.actorUserId, b.businessId, b.actorUserId]);
  });

  afterAll(async () => { await client.close(); });

  it("un import conserve l'original : clé aléatoire sans nom, empreinte, type réel, échéance à 90 jours", async () => {
    const bytes = csv();
    const created = await createCatalogImport(db, { ...a, fileName: "C:\\Mes documents\\catalogue-secret.csv", bytes }, { storage });
    expect(created).toMatchObject({ existing: false, originalStored: true });
    const fileId = (await sourceOf(created.id))!;
    const row = await fileRow(fileId);
    expect(row).toMatchObject({ business_id: a.businessId, purpose: "import_source", status: "stored", file_type: "csv", size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), display_name: "catalogue-secret.csv", uploaded_by_user_id: a.actorUserId });
    expect(row.object_key).toMatch(/^import_source\/[0-9a-f]{64}$/);
    expect(String(row.object_key)).not.toContain("catalogue");
    expect(String(row.object_key)).not.toContain(a.businessId);
    const days = ((row.retention_until as Date).getTime() - (row.received_at as Date).getTime()) / 86_400_000;
    expect(days).toBe(90);
    expect(Buffer.from((await storage.get(String(row.object_key)))!).equals(bytes)).toBe(true);
    expect(storage.optionsOf(String(row.object_key))).toMatchObject({ contentType: "text/csv; charset=utf-8" });

    const detail = await getImportBatch(db, a, created.id);
    expect(detail.batch.original).toMatchObject({ status: "stored" });
    const original = await getImportOriginal(db, a, created.id, { storage });
    expect(original.kind).toBe("bytes");
    if (original.kind === "bytes") {
      expect(Buffer.from(original.bytes).equals(bytes)).toBe(true);
      expect(original.contentDisposition).toBe("attachment; filename=\"fichier-origine.csv\"; filename*=UTF-8''catalogue-secret.csv");
    }
  });

  it("un autre commerce ne peut pas lire l'original : réponse identique à un import inconnu", async () => {
    const created = await createCatalogImport(db, { ...a, fileName: "a.csv", bytes: csv() }, { storage });
    const forB = await getImportOriginal(db, b, created.id, { storage }).catch((error: Error) => error);
    const unknown = await getImportOriginal(db, b, "00000000-0000-4000-8000-000000000000", { storage }).catch((error: Error) => error);
    expect(forB).toMatchObject({ status: 404, message: "Fichier introuvable." });
    expect(unknown).toMatchObject({ status: 404, message: "Fichier introuvable." });
  });

  it("sans stockage configuré, l'import fonctionne et l'écran sait que l'original n'est pas conservé", async () => {
    const before = Number((await client.query<{ n: string }>("select count(*)::text n from stored_file")).rows[0]!.n);
    const created = await createCatalogImport(db, { ...a, fileName: "sans-stockage.csv", bytes: csv() }, { storage: null });
    expect(created).toMatchObject({ existing: false, originalStored: false });
    expect(await sourceOf(created.id)).toBeNull();
    expect((await getImportBatch(db, a, created.id)).batch.original).toEqual({ status: "none", retentionUntil: null });
    expect(Number((await client.query<{ n: string }>("select count(*)::text n from stored_file")).rows[0]!.n)).toBe(before);
    await expect(getImportOriginal(db, a, created.id, { storage: null })).rejects.toMatchObject({ status: 404 });
  });

  it("échec d'envoi : l'import est créé sans original, la ligne reste `pending` puis le cron la nettoie", async () => {
    const failing = new R2FileStorage({ accountId: "0123456789abcdef0123456789abcdef", bucket: "qadr-test", accessKeyId: "AKIDEXAMPLE0000000000", secretAccessKey: "x".repeat(40) },
      { fetch: (async () => { throw new TypeError("réseau coupé"); }) as typeof fetch });
    const created = await createCatalogImport(db, { ...a, fileName: "panne.csv", bytes: csv() }, { storage: failing });
    expect(created.originalStored).toBe(false);
    expect((await getImportBatch(db, a, created.id)).batch.original.status).toBe("none");
    const [pending] = (await client.query<{ id: string; received_at: Date }>("select id, received_at from stored_file where status='pending' and display_name='panne.csv'")).rows;
    expect(pending).toBeTruthy();
    // Moins d'une heure : ce n'est pas encore un orphelin.
    expect(await purgeStoredFiles(db, storage, { now: new Date(pending!.received_at.getTime() + 10 * 60_000) })).toMatchObject({ orphans: 0 });
    const result = await purgeStoredFiles(db, storage, { now: new Date(pending!.received_at.getTime() + 2 * 3_600_000) });
    expect(result.orphans).toBeGreaterThanOrEqual(1);
    expect(await fileRow(pending!.id)).toMatchObject({ status: "deleted", deletion_reason: "orphan" });
  });

  it("abandon d'un import : l'original est supprimé aussitôt, puis introuvable", async () => {
    const created = await createCatalogImport(db, { ...a, fileName: "abandon.csv", bytes: csv() }, { storage });
    const fileId = (await sourceOf(created.id))!;
    const key = String((await fileRow(fileId)).object_key);
    await discardImportBatch(db, a, created.id, { storage });
    expect(await fileRow(fileId)).toMatchObject({ status: "deleted", deletion_reason: "import_discarded" });
    expect(await storage.exists(key)).toBe(false);
    expect((await getImportBatch(db, a, created.id)).batch.original.status).toBe("deleted");
    await expect(getImportOriginal(db, a, created.id, { storage })).rejects.toMatchObject({ status: 404, message: "Fichier introuvable." });
  });

  it("échéance passée : introuvable tout de suite, puis supprimé par le passage planifié", async () => {
    const created = await createCatalogImport(db, { ...a, fileName: "echu.csv", bytes: csv() }, { storage });
    const fileId = (await sourceOf(created.id))!;
    const key = String((await fileRow(fileId)).object_key);
    await client.query("update stored_file set retention_until = now() - interval '1 minute' where id=$1", [fileId]);
    await expect(getImportOriginal(db, a, created.id, { storage })).rejects.toMatchObject({ status: 404 });
    // Sans stockage configuré, le passage ne touche à rien.
    expect(await purgeStoredFiles(db, null)).toEqual({ deleted: 0, orphans: 0, failed: 0, storage: "unavailable" });
    expect(await fileRow(fileId)).toMatchObject({ status: "stored" });
    expect((await purgeStoredFiles(db, storage)).deleted).toBeGreaterThanOrEqual(1);
    expect(await fileRow(fileId)).toMatchObject({ status: "deleted", deletion_reason: "retention" });
    expect(await storage.exists(key)).toBe(false);
  });

  it("dépôt direct : exécutable renommé (415) et taille dépassée (413) refusés sans rien écrire", async () => {
    const count = async () => Number((await client.query<{ n: string }>("select count(*)::text n from stored_file")).rows[0]!.n);
    const before = await count();
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]);
    await expect(uploadBusinessFile(db, storage, { ...a, purpose: "import_source", bytes: exe, displayName: "catalogue.csv" }))
      .rejects.toMatchObject({ status: 415, code: "file_type_refused" });
    // Un PDF n'est pas (encore) une finalité admise pour un import.
    await expect(uploadBusinessFile(db, storage, { ...a, purpose: "import_source", bytes: Buffer.from("%PDF-1.7\n"), displayName: "x.pdf" }))
      .rejects.toMatchObject({ status: 415 });
    await expect(uploadBusinessFile(db, storage, { ...a, purpose: "import_source", bytes: Buffer.alloc(2 * 1024 * 1024 + 1, 0x41), displayName: "gros.csv" }))
      .rejects.toMatchObject({ status: 413, code: "file_too_large" });
    expect(await count()).toBe(before);
  });
});
