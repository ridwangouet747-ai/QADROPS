import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as cronSubscriptionsRoute from "@/app/api/cron/subscriptions/route";
import * as importDiscardRoute from "@/app/api/business/imports/[importId]/discard/route";
import * as importOriginalRoute from "@/app/api/business/imports/[importId]/original/route";
import * as importRoute from "@/app/api/business/imports/[importId]/route";
import * as importsRoute from "@/app/api/business/imports/route";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 12, lot L2 : fichier d'origine d'un import par les vraies routes (PGlite, vraie session Better Auth).
 * Stockage : celui de l'application en mode mémoire (`QADR_FILE_STORAGE=memory`, posé par le harnais),
 * puis sans aucun stockage. Aucun service distant n'est contacté.
 */
describe("mission 12, lot L2 : fichier d'origine des imports (routes HTTP)", () => {
  let h: HttpHarness;
  let owner: Actor; let cashier: Actor;
  const send = (actor: Actor, content: string, name = "catalogue.csv") => {
    const form = new FormData();
    form.append("file", new File([content], name, { type: "text/csv" }));
    return h.call(importsRoute.POST, { path: "/api/business/imports", actor, form });
  };
  const original = (actor: Actor, importId: string) => h.call(importOriginalRoute.GET, { path: `/api/business/imports/${importId}/original`, actor, params: { importId } });

  beforeAll(async () => {
    h = await startHttpHarness();
    owner = await h.signUp("Propriétaire Fichiers", "owner@fichiers.test");
    await h.createBusiness(owner, "Boutique Fichiers", "general");
    cashier = await h.addMember(owner, "Caissière Fichiers", "caisse@fichiers.test", "cashier");
  });

  afterAll(async () => {
    process.env.QADR_FILE_STORAGE = "memory";
    delete process.env.CRON_SECRET;
    await h?.close();
  });

  it("l'original envoyé est conservé et téléchargeable tel quel, en pièce jointe, sans cache", async () => {
    const content = "Désignation;Prix de vente\nSavon de Marseille;750\n";
    const created = await send(owner, content, "C:\\Users\\moi\\Mon catalogue.csv");
    expect(created.status).toBe(201);
    expect(created.body.import.originalStored).toBe(true);
    const id = created.body.import.id as string;
    const detail = await h.call(importRoute.GET, { path: `/api/business/imports/${id}`, actor: owner, params: { importId: id } });
    expect(detail.body.batch.original.status).toBe("stored");
    const response = await original(owner, id);
    expect(response.status).toBe(200);
    expect(response.text).toBe(content);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=\"fichier-origine.csv\"; filename*=UTF-8''Mon%20catalogue.csv");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("une caissière (sans droit d'import) ne peut pas télécharger l'original", async () => {
    const created = await send(owner, "Nom;Prix\nBougie;100\n");
    const response = await original(cashier, created.body.import.id);
    expect(response.status).toBe(403);
    expect(response.text).not.toContain("Bougie");
  });

  it("abandon : l'original est supprimé, la route répond « introuvable »", async () => {
    const created = await send(owner, "Nom;Prix\nAllumettes;50\n");
    const id = created.body.import.id as string;
    expect((await h.call(importDiscardRoute.POST, { path: `/api/business/imports/${id}/discard`, actor: owner, params: { importId: id } })).status).toBe(200);
    const response = await original(owner, id);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Fichier introuvable." });
    expect(await h.count("select count(*)::text n from stored_file f join import_batch b on b.source_file_id=f.id where b.id=$1 and f.status='deleted'", [id])).toBe(1);
  });

  it("sans stockage configuré, l'import fonctionne et ne prétend pas avoir gardé l'original", async () => {
    delete process.env.QADR_FILE_STORAGE;
    try {
      const created = await send(owner, "Nom;Prix\nCrayon;25\n");
      expect(created.status).toBe(201);
      expect(created.body.import.originalStored).toBe(false);
      const id = created.body.import.id as string;
      const detail = await h.call(importRoute.GET, { path: `/api/business/imports/${id}`, actor: owner, params: { importId: id } });
      expect(detail.body.batch.original).toEqual({ status: "none", retentionUntil: null });
      expect((await original(owner, id)).status).toBe(404);
    } finally {
      process.env.QADR_FILE_STORAGE = "memory";
    }
  });

  it("le passage planifié quotidien supprime aussi les originaux échus", async () => {
    process.env.CRON_SECRET = "secret-de-cron-du-harnais-0123456789abcdef";
    const created = await send(owner, "Nom;Prix\nCahier;400\n");
    const id = created.body.import.id as string;
    await h.client.query("update stored_file set retention_until = now() - interval '1 day' where id = (select source_file_id from import_batch where id=$1)", [id]);
    const cron = await h.call(cronSubscriptionsRoute.GET, { path: "/api/cron/subscriptions", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(cron.status).toBe(200);
    expect(cron.body.storage).toMatchObject({ storage: "available", failed: 0 });
    expect(cron.body.storage.deleted).toBeGreaterThanOrEqual(1);
    expect(await h.count("select count(*)::text n from stored_file f join import_batch b on b.source_file_id=f.id where b.id=$1 and f.status='deleted' and f.deletion_reason='retention'", [id])).toBe(1);
    expect((await original(owner, id)).status).toBe(404);
  });
});
