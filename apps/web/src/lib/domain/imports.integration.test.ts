import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct } from "./commercial";
import { applyImportBatch, createCatalogImport, discardImportBatch, getImportBatch, listImportBatches, updateImportMapping, updateImportRow } from "./imports";

describe("mission 11, phase 3 : import de catalogue relu puis appliqué (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const businessA = "import-business-a";
  const businessB = "import-business-b";
  const ownerA = "import-owner-a";
  const cashierA = "import-cashier-a";
  const ownerB = "import-owner-b";
  const a = { businessId: businessA, actorUserId: ownerA };
  const b = { businessId: businessB, actorUserId: ownerB };
  const now = new Date("2026-11-01T12:00:00.000Z");
  const variants: Record<string, string> = {};
  let batchId = "";

  const csv = [
    "Désignation;Prix de vente;Quantité;Unité;Référence",
    "Ciment CIMAF 50 kg;5 500;120;sac;CIM50",
    "Tôles ondulées 3 m;4000;45;feuille;",
    "Pointes 10 cm;1 500;30;kg;",
    "Pointes 10 cm;1500;5;kg;",
    "Fer à béton 8;2,5;10;;",
    ";1000;2;;",
  ].join("\n");
  const count = async (sql: string, params: unknown[] = []) => Number((await client.query<{ n: string }>(sql, params)).rows[0]!.n);
  const rowsOf = async () => (await getImportBatch(db, a, batchId)).rows;
  const row = async (number: number) => (await rowsOf()).find((item) => item.rowNumber === number)!;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, email] of [[ownerA, "a@import.test"], [cashierA, "c@import.test"], [ownerB, "b@import.test"]]) {
      await client.query("insert into \"user\" (id,name,email) values ($1,'Import Test',$2)", [id, email]);
    }
    for (const [id, slug] of [[businessA, "import-a"], [businessB, "import-b"]]) {
      await client.query("insert into organization (id,name,slug) values ($1,'Commerce test',$2)", [id, slug]);
      await client.query("insert into business_profile (business_id,activity,timezone) values ($1,'hardware','Africa/Abidjan')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('im-a',$1,$2,'owner'),('im-ca',$1,$3,'cashier'),('im-b',$4,$5,'owner')", [businessA, ownerA, cashierA, businessB, ownerB]);
    variants.ciment = (await createProduct(db, { ...a, name: "Ciment CIMAF 50 kg", salePriceXof: "5500", sku: "CIM50" })).variantId;
    variants.tole = (await createProduct(db, { ...a, name: "Tôle ondulée 3 m", salePriceXof: "4000" })).variantId;
    variants.peinture = (await createProduct(db, { ...a, name: "Peinture blanche 5 L", salePriceXof: "12000" })).variantId;
    // Même nom chez B : le rapprochement de A ne doit jamais le proposer.
    variants.other = (await createProduct(db, { ...b, name: "Pointes 10 cm", salePriceXof: "900" })).variantId;
  });

  afterAll(async () => { await client.close(); });

  it("lit le fichier sans rien écrire au catalogue et propose une décision prudente par ligne", async () => {
    const products = await count("select count(*)::text n from product where business_id=$1", [businessA]);
    const created = await createCatalogImport(db, { ...a, fileName: "C:\\Users\\moi\\catalogue.csv", bytes: Buffer.from(csv, "utf8") });
    batchId = created.id;
    expect(created.existing).toBe(false);
    expect(await count("select count(*)::text n from product where business_id=$1", [businessA])).toBe(products);

    const { batch, rows, counts } = await getImportBatch(db, a, batchId);
    expect(batch).toMatchObject({ fileName: "catalogue.csv", fileType: "csv", headerRowNumber: 1, rowCount: 6, mappingConfirmed: false });
    expect(batch.mapping.map((entry) => entry.field)).toEqual(["name", "salePrice", "quantity", "unit", "sku"]);
    expect(rows).toHaveLength(6);
    const byNumber = Object.fromEntries(rows.map((item) => [item.rowNumber, item]));
    // Référence identique : rattachement certain, proposé d'office.
    expect(byNumber[2]).toMatchObject({ decision: "match", decisionSource: "auto", matchVariantId: variants.ciment, status: "ready" });
    // Nom proche seulement : question posée, rien n'est fusionné.
    expect(byNumber[3]).toMatchObject({ decision: null, status: "needs_review" });
    expect(byNumber[3]!.issues).toContain("match_needed");
    expect(byNumber[3]!.candidates[0]).toMatchObject({ variantId: variants.tole, reason: "similar" });
    // Aucun produit de B n'est proposé, même avec un nom identique.
    expect(byNumber[4]).toMatchObject({ decision: "create", status: "ready", candidates: [] });
    expect(byNumber[5]!.issues).toContain("duplicate_in_file");
    expect(byNumber[5]!.status).toBe("invalid");
    // « 2,5 » : virgule décimale ou séparateur de milliers ? Ambigu, jamais deviné.
    expect(byNumber[6]!.issues).toContain("price_ambiguous");
    expect(byNumber[6]!.status).toBe("invalid");
    expect(byNumber[7]!.issues).toContain("missing_name");
    expect(counts).toEqual({ ready: 2, needs_review: 1, invalid: 3, skipped: 0, applied: 0 });
  });

  it("rouvre l'import existant quand le même fichier est envoyé une deuxième fois", async () => {
    const again = await createCatalogImport(db, { ...a, fileName: "copie.csv", bytes: Buffer.from(csv, "utf8") });
    expect(again).toEqual({ id: batchId, existing: true });
    expect(await count("select count(*)::text n from import_batch where business_id=$1", [businessA])).toBe(1);
    expect(await count("select count(*)::text n from import_row where business_id=$1", [businessA])).toBe(7);
  });

  it("refuse l'import aux rôles sans droit produit et isole chaque commerce", async () => {
    await expect(createCatalogImport(db, { businessId: businessA, actorUserId: cashierA, fileName: "x.csv", bytes: Buffer.from("Nom;Prix\nA;1\n") })).rejects.toMatchObject({ status: 403 });
    await expect(getImportBatch(db, { businessId: businessA, actorUserId: cashierA }, batchId)).rejects.toMatchObject({ status: 403 });
    // B ne voit, ne corrige, n'applique ni n'abandonne l'import de A, même en connaissant son identifiant.
    await expect(getImportBatch(db, b, batchId)).rejects.toMatchObject({ status: 404 });
    const target = await row(4);
    await expect(updateImportRow(db, b, { batchId, rowId: target.id, decision: "skip" })).rejects.toMatchObject({ status: 404 });
    await expect(applyImportBatch(db, b, { batchId, idempotencyKey: "import-b-key-1" }, now)).rejects.toMatchObject({ status: 404 });
    await expect(discardImportBatch(db, b, batchId)).rejects.toMatchObject({ status: 404 });
    expect((await listImportBatches(db, b)).batches).toEqual([]);
    // A ne peut pas rattacher une ligne à un produit de B.
    await expect(updateImportRow(db, a, { batchId, rowId: target.id, decision: "match", matchVariantId: variants.other })).rejects.toMatchObject({ status: 404 });
  });

  it("n'applique rien tant que les colonnes ne sont pas confirmées et que des lignes attendent une réponse", async () => {
    await expect(applyImportBatch(db, a, { batchId, idempotencyKey: "import-a-key-early" }, now)).rejects.toMatchObject({ code: "import_mapping_unconfirmed" });
    await expect(updateImportMapping(db, a, { batchId, headerRowNumber: 1, mapping: [{ column: 1, field: "salePrice" }] })).rejects.toMatchObject({ code: "import_mapping_name" });
    await expect(updateImportMapping(db, a, { batchId, headerRowNumber: 1, mapping: [{ column: 0, field: "name" }, { column: 1, field: "name" }] })).rejects.toMatchObject({ code: "import_mapping_duplicate" });
    const confirmed = await updateImportMapping(db, a, { batchId, headerRowNumber: 1,
      mapping: [{ column: 0, field: "name" }, { column: 1, field: "salePrice" }, { column: 2, field: "quantity" }, { column: 3, field: "unit" }, { column: 4, field: "sku" }] });
    expect(confirmed.counts).toEqual({ ready: 2, needs_review: 1, invalid: 3, skipped: 0, applied: 0 });
    await expect(applyImportBatch(db, a, { batchId, idempotencyKey: "import-a-key-early" }, now)).rejects.toMatchObject({ code: "import_rows_pending" });
    expect(await count("select count(*)::text n from product where business_id=$1", [businessA])).toBe(3);
  });

  it("corrige ligne par ligne sans perdre la cellule d'origine", async () => {
    const tole = await row(3);
    await updateImportRow(db, a, { batchId, rowId: tole.id, decision: "match", matchVariantId: variants.tole });
    // Ignorer la première ligne « Pointes » libère la seconde (le doublon disparaît).
    const duplicate = await row(5);
    const skipped = await updateImportRow(db, a, { batchId, rowId: (await row(4)).id, decision: "skip" });
    expect(skipped.row.status).toBe("skipped");
    expect((await row(5)).status).toBe("ready");
    await updateImportRow(db, a, { batchId, rowId: (await row(4)).id, decision: "auto" });
    expect((await row(5)).issues).toContain("duplicate_in_file");
    await updateImportRow(db, a, { batchId, rowId: duplicate.id, decision: "skip" });

    const fer = await row(6);
    const corrected = await updateImportRow(db, a, { batchId, rowId: fer.id, edits: { salePrice: "2 500" } });
    expect(corrected.row).toMatchObject({ status: "ready", decision: "create", edits: { salePrice: "2 500" } });
    expect(corrected.row.values.salePriceXof).toBe("2500");
    expect(corrected.row.cells[1]).toBe("2,5");
    await updateImportRow(db, a, { batchId, rowId: (await row(7)).id, decision: "skip" });
    const state = await getImportBatch(db, a, batchId);
    expect(state.counts).toEqual({ ready: 4, needs_review: 0, invalid: 0, skipped: 2, applied: 0 });
  });

  it("applique via les services métier : produits, stock de départ, alias appris, audit", async () => {
    const result = await applyImportBatch(db, a, { batchId, idempotencyKey: "import-a-key-0001" }, now);
    expect(result).toEqual({ status: "applied", summary: { created: 2, matched: 2, skipped: 2, stockLines: 4, stockIgnored: 0 } });

    const products = await client.query<{ name: string; base_unit: string; sale_price_xof: string; on_hand: string }>(
      "select p.name,p.base_unit,v.sale_price_xof::text,v.on_hand::text from product p join product_variant v on v.business_id=p.business_id and v.product_id=p.id where p.business_id=$1 order by p.name", [businessA]);
    expect(products.rows).toEqual([
      { name: "Ciment CIMAF 50 kg", base_unit: "piece", sale_price_xof: "5500", on_hand: "120.000000" },
      { name: "Fer à béton 8", base_unit: "piece", sale_price_xof: "2500", on_hand: "10.000000" },
      { name: "Peinture blanche 5 L", base_unit: "piece", sale_price_xof: "12000", on_hand: "0.000000" },
      { name: "Pointes 10 cm", base_unit: "kg", sale_price_xof: "1500", on_hand: "30.000000" },
      { name: "Tôle ondulée 3 m", base_unit: "piece", sale_price_xof: "4000", on_hand: "45.000000" },
    ]);
    // Un stock de départ, pas une vente ni un achat.
    expect(await count("select count(*)::text n from stock_movement where business_id=$1 and reason='opening_stock'", [businessA])).toBe(4);
    expect(await count("select count(*)::text n from sale where business_id=$1", [businessA])).toBe(0);
    expect(await count("select count(*)::text n from purchase where business_id=$1", [businessA])).toBe(0);
    const aliases = await client.query<{ alias: string; variant_id: string }>("select alias,variant_id from product_alias where business_id=$1", [businessA]);
    expect(aliases.rows).toEqual([{ alias: "Tôles ondulées 3 m", variant_id: variants.tole }]);
    const audit = await client.query<{ event_type: string }>("select event_type from audit_event where business_id=$1 and event_type like 'import.%' order by occurred_at", [businessA]);
    expect(audit.rows.map((item) => item.event_type)).toEqual(["import.created", "import.rows_applied", "import.applied"]);
    expect(await count("select count(*)::text n from product where business_id=$1", [businessB])).toBe(1);
  });

  it("rejouer l'application (même clé ou autre clé) ne crée aucun doublon", async () => {
    const counts = async () => [
      await count("select count(*)::text n from product where business_id=$1", [businessA]),
      await count("select count(*)::text n from stock_movement where business_id=$1", [businessA]),
      await count("select count(*)::text n from stock_opening where business_id=$1", [businessA]),
    ];
    const before = await counts();
    expect((await applyImportBatch(db, a, { batchId, idempotencyKey: "import-a-key-0001" }, now)).status).toBe("applied");
    expect((await applyImportBatch(db, a, { batchId, idempotencyKey: "import-a-key-0002" }, now)).status).toBe("applied");
    expect(await counts()).toEqual(before);
    await expect(updateImportRow(db, a, { batchId, rowId: (await row(2)).id, decision: "skip" })).rejects.toMatchObject({ code: "import_closed" });
  });

  it("un alias appris rend le rapprochement certain au prochain import, et le stock existant n'est pas écrasé", async () => {
    const second = await createCatalogImport(db, { ...a, fileName: "arrivage.csv", bytes: Buffer.from("Nom;Prix;Stock\nTôles ondulées 3 m;4000;10\nBrouette;25000;3\n", "utf8") });
    const { rows } = await getImportBatch(db, a, second.id);
    expect(rows[0]).toMatchObject({ decision: "match", matchVariantId: variants.tole, status: "ready" });
    expect(rows[0]!.issues).toContain("stock_existing");
    await updateImportMapping(db, a, { batchId: second.id, headerRowNumber: 1, mapping: [{ column: 0, field: "name" }, { column: 1, field: "salePrice" }, { column: 2, field: "quantity" }] });
    const result = await applyImportBatch(db, a, { batchId: second.id, idempotencyKey: "import-a-key-0003" }, now);
    expect(result.summary).toMatchObject({ created: 1, matched: 1, stockLines: 1, stockIgnored: 1 });
    const tole = await client.query<{ on_hand: string }>("select on_hand::text from product_variant where business_id=$1 and id=$2", [businessA, variants.tole]);
    expect(tole.rows[0]!.on_hand).toBe("45.000000");
  });

  it("abandonner efface les cellules lues et libère le fichier", async () => {
    const third = await createCatalogImport(db, { ...a, fileName: "brouillon.csv", bytes: Buffer.from("Article,Prix\nSeau,1500\n", "utf8") });
    await discardImportBatch(db, a, third.id);
    const cells = await client.query<{ cells: unknown }>("select cells from import_row where business_id=$1 and batch_id=$2", [businessA, third.id]);
    expect(cells.rows.every((item) => Array.isArray(item.cells) && item.cells.length === 0)).toBe(true);
    await expect(applyImportBatch(db, a, { batchId: third.id, idempotencyKey: "import-a-key-0004" }, now)).rejects.toMatchObject({ code: "import_closed" });
    const again = await createCatalogImport(db, { ...a, fileName: "brouillon.csv", bytes: Buffer.from("Article,Prix\nSeau,1500\n", "utf8") });
    expect(again.existing).toBe(false);
  });

  it("une ligne décalée par « 1,250 » sans guillemets attend la vérification du commerçant", async () => {
    const shifted = await createCatalogImport(db, { ...a, fileName: "decale.csv", bytes: Buffer.from("Article,Prix,Qté\nSeau,1500,2\nSavon,1,250,3\nPelle,3000,1\n", "utf8") });
    const savon = (await getImportBatch(db, a, shifted.id)).rows.find((item) => item.rowNumber === 3)!;
    expect(savon).toMatchObject({ status: "needs_review", values: { salePriceXof: "1", quantity: "250" } });
    expect(savon.issues).toContain("extra_cells");
    const corrected = await updateImportRow(db, a, { batchId: shifted.id, rowId: savon.id, edits: { salePrice: "1250", quantity: "3" } });
    expect(corrected.row).toMatchObject({ status: "ready", values: { salePriceXof: "1250", quantity: "3" } });
    expect(corrected.row.issues).not.toContain("extra_cells");
    await discardImportBatch(db, a, shifted.id);
  });

  it("refuse les fichiers qui ne sont pas des tableaux, avec un code stable", async () => {
    await expect(createCatalogImport(db, { ...a, fileName: "scan.pdf", bytes: Buffer.from("%PDF-1.7\n%\u00e2\u00e3") })).rejects.toMatchObject({ status: 400, code: "import_document_reader_disabled" });
    await expect(createCatalogImport(db, { ...a, fileName: "cahier.jpg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) })).rejects.toMatchObject({ code: "import_document_reader_disabled" });
    await expect(createCatalogImport(db, { ...a, fileName: "image.bin", bytes: Buffer.from([0, 1, 2, 3, 0, 0, 7]) })).rejects.toMatchObject({ status: 400 });
    await expect(createCatalogImport(db, { ...a, fileName: "vide.csv", bytes: Buffer.from("\n\n") })).rejects.toMatchObject({ code: "import_empty" });
  });
});
