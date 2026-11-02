import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { layoutReceipt } from "../printing/receipt-ticket";
import { createProduct, createSale } from "./commercial";
import { addPrintDevice, createPrintJob, getPrinterSetup, reportPrintResult, updatePrintDevice, updatePrinterSettings } from "./printing";
import { getSaleReceiptDocument } from "./receipt";

/*
 * Mission 11, phase 5 : ticket unique, profils d'imprimante, réimpression idempotente.
 * Deux commerces A et B : aucun ne lit ni ne modifie le ticket, l'imprimante ou les tâches de l'autre.
 */
describe("impression, phase 5 : profils, document unique et réimpression idempotente (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const [bizA, bizB] = ["p5-a", "p5-b"];
  const [ownerA, cashierA, stockA, ownerB] = ["p5-owner-a", "p5-cashier-a", "p5-stock-a", "p5-owner-b"];
  const A = { businessId: bizA, actorUserId: ownerA };
  const B = { businessId: bizB, actorUserId: ownerB };
  let saleA = "", saleB = "", deviceA = "", deviceB = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const id of [ownerA, cashierA, stockA, ownerB]) await client.query(`insert into "user"(id,name,email) values ($1,$1,$2)`, [id, `${id}@p5.test`]);
    await client.query("insert into organization(id,name,slug) values ($1,'Quincaillerie Koné',$1),($2,'Boutique Awa',$2)", [bizA, bizB]);
    for (const id of [bizA, bizB]) await client.query("insert into business_profile(business_id,activity,phone,address) values ($1,'hardware','+225 07 00 00 00','Abidjan')", [id]);
    await client.query("insert into member(id,organization_id,user_id,role) values ('p5m1',$1,$2,'owner'),('p5m2',$1,$3,'cashier'),('p5m3',$1,$4,'stock_manager'),('p5m4',$5,$6,'owner')",
      [bizA, ownerA, cashierA, stockA, bizB, ownerB]);
    const variantA = (await createProduct(db, { ...A, name: "Ciment 50 kg", salePriceXof: "6500" })).variantId;
    await client.query("update product_variant set on_hand='10' where id=$1", [variantA]);
    saleA = (await createSale(db, { businessId: bizA, actorUserId: cashierA, idempotencyKey: "p5-sale-key-0001", lines: [{ variantId: variantA, quantity: "2" }],
      payments: [{ method: "cash", amountXof: "13000" }] })).id;
    const variantB = (await createProduct(db, { ...B, name: "Pagne", salePriceXof: "5000" })).variantId;
    await client.query("update product_variant set on_hand='5' where id=$1", [variantB]);
    saleB = (await createSale(db, { ...B, idempotencyKey: "p5-sale-key-0002", lines: [{ variantId: variantB, quantity: "1" }], payments: [{ method: "cash", amountXof: "5000" }] })).id;
    for (const context of [A, B]) await updatePrinterSettings(db, context, { enabled: true, autoPrint: false });
    deviceA = (await addPrintDevice(db, A, { name: "Caisse A", transport: "simulated", paperWidthMm: 58, agentId: "agent-p5-aaaa" })).id;
    deviceB = (await addPrintDevice(db, B, { name: "Caisse B", transport: "simulated", paperWidthMm: 80, agentId: "agent-p5-bbbb" })).id;
  });
  afterAll(async () => { await client.close(); });

  it("profil par défaut : PC858 et mode automatique ; modification auditée", async () => {
    expect((await getPrinterSetup(db, A)).devices[0]).toMatchObject({ id: deviceA, paperWidthMm: 58, codePage: "pc858", renderMode: "auto" });
    expect(await updatePrintDevice(db, A, deviceA, { paperWidthMm: 80, codePage: "wpc1252", renderMode: "text" })).toEqual({ id: deviceA, paperWidthMm: 80, codePage: "wpc1252", renderMode: "text" });
    expect((await getPrinterSetup(db, A)).devices[0]).toMatchObject({ paperWidthMm: 80, codePage: "wpc1252", renderMode: "text" });
    const audit = await client.query("select 1 from audit_event where business_id=$1 and event_type='printer.device_updated'", [bizA]);
    expect(audit.rows).toHaveLength(1);
    await expect(updatePrintDevice(db, A, deviceA, { paperWidthMm: 80, codePage: "cp864", renderMode: "auto" })).rejects.toThrow();
    await expect(client.query("update print_device set code_page='cp864' where id=$1", [deviceA])).rejects.toThrow();
    await updatePrintDevice(db, A, deviceA, { paperWidthMm: 58, codePage: "pc858", renderMode: "auto" });
  });

  it("isolation A/B : B ne lit pas le ticket de A, ne modifie pas son imprimante, n'imprime pas sur elle", async () => {
    await expect(getSaleReceiptDocument(db, { ...B, saleId: saleA, language: "fr" })).rejects.toMatchObject({ status: 404 });
    await expect(updatePrintDevice(db, B, deviceA, { paperWidthMm: 80, codePage: "pc850", renderMode: "raster" })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(createPrintJob(db, B, { deviceId: deviceA, kind: "test" })).rejects.toMatchObject({ status: 404 });
    await expect(createPrintJob(db, B, { deviceId: deviceB, kind: "receipt", saleId: saleA })).rejects.toMatchObject({ status: 404 });
    await expect(createPrintJob(db, A, { deviceId: deviceA, kind: "receipt", saleId: saleB })).rejects.toMatchObject({ status: 404 });
    // B ne peut pas réimprimer en citant une tâche de A, même avec sa propre vente.
    const jobA = await createPrintJob(db, A, { deviceId: deviceA, kind: "receipt", saleId: saleA });
    await expect(createPrintJob(db, B, { deviceId: deviceB, kind: "receipt", saleId: saleB, reprintOfJobId: jobA.job.id, idempotencyKey: "p5-reprint-cross-01" })).rejects.toMatchObject({ status: 404 });
    await expect(reportPrintResult(db, B, jobA.job.id, { status: "printed" })).rejects.toMatchObject({ status: 404 });
    expect((await getPrinterSetup(db, A)).devices[0]).toMatchObject({ codePage: "pc858", renderMode: "auto" });
  });

  it("permission refusée (403) : le gestionnaire de stock n'imprime pas, un caissier ne configure pas", async () => {
    await expect(createPrintJob(db, { businessId: bizA, actorUserId: stockA }, { deviceId: deviceA, kind: "test" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(updatePrintDevice(db, { businessId: bizA, actorUserId: cashierA }, deviceA, { paperWidthMm: 80, codePage: "pc858", renderMode: "auto" })).rejects.toMatchObject({ status: 403 });
    await expect(getSaleReceiptDocument(db, { businessId: bizA, actorUserId: ownerB, saleId: saleA, language: "fr" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("le ticket à l'écran et le ticket imprimé viennent du même document", async () => {
    const document = await getSaleReceiptDocument(db, { ...A, saleId: saleA, language: "fr" });
    expect(document).toMatchObject({ business: { name: "Quincaillerie Koné" }, sale: { timeZone: "Africa/Abidjan" }, totals: { totalXof: "13000", paidXof: "13000", dueXof: null } });
    const job = await createPrintJob(db, A, { deviceId: deviceA, kind: "receipt", saleId: saleA });
    expect(job.render).toBe("text");
    expect(job.layout!.blocks).toEqual(layoutReceipt(document).blocks);
    expect(job.preview!.join("\n")).toMatch(/TOTAL\s+13 000 F/);
  });

  it("double demande de réimpression avec la même clé : une seule tâche, un seul audit", async () => {
    const original = await createPrintJob(db, A, { deviceId: deviceA, kind: "receipt", saleId: saleA });
    await reportPrintResult(db, A, original.job.id, { status: "printed" });
    const request = { deviceId: deviceA, kind: "receipt", saleId: saleA, reprintOfJobId: original.job.id, idempotencyKey: "p5-reprint-key-0001" };
    // Double clic : la même intention arrive deux fois (PGlite n'a qu'une connexion : les deux appels se suivent).
    const first = await createPrintJob(db, A, request, new Date(), { requireReprintKey: true });
    const second = await createPrintJob(db, A, request, new Date(), { requireReprintKey: true });
    expect(second.job.id).toBe(first.job.id);
    expect([first.job.duplicate, second.job.duplicate]).toEqual([false, true]);
    expect(second.render).toBe("text");
    const jobs = await client.query("select 1 from print_job where business_id=$1 and reprint_of_job_id=$2", [bizA, original.job.id]);
    expect(jobs.rows).toHaveLength(1);
    const audit = await client.query("select 1 from audit_event where business_id=$1 and event_type='printer.receipt_reprinted'", [bizA]);
    expect(audit.rows).toHaveLength(1);
    // Une nouvelle intention (nouvelle clé) donne une nouvelle réimpression.
    const third = await createPrintJob(db, A, { ...request, idempotencyKey: "p5-reprint-key-0002" }, new Date(), { requireReprintKey: true });
    expect(third.job.id).not.toBe(first.job.id);
  });

  it("la route exige une clé pour réimprimer (400 idempotency_key_required)", async () => {
    const [job] = (await client.query<{ id: string }>("select id from print_job where business_id=$1 and sale_id=$2 limit 1", [bizA, saleA])).rows;
    await expect(createPrintJob(db, A, { deviceId: deviceA, kind: "receipt", saleId: saleA, reprintOfJobId: job!.id }, new Date(), { requireReprintKey: true }))
      .rejects.toMatchObject({ status: 400, code: "idempotency_key_required" });
  });

  it("ticket en arabe : rendu en image (aucun octet texte), sens rtl, même document", async () => {
    const [job] = (await client.query<{ id: string }>("select id from print_job where business_id=$1 and sale_id=$2 and reprint_of_job_id is null limit 1", [bizA, saleA])).rows;
    const arabic = await createPrintJob(db, A, { deviceId: deviceA, kind: "receipt", saleId: saleA, language: "ar", reprintOfJobId: job!.id, idempotencyKey: "p5-reprint-ar-0001" });
    expect(arabic).toMatchObject({ render: "raster", payload: null, profile: { paperWidthMm: 58, dots: 384, columns: 32, codePage: "pc858" } });
    expect(arabic.layout!.direction).toBe("rtl");
    const test = await createPrintJob(db, A, { deviceId: deviceA, kind: "test", language: "ar" });
    expect(test).toMatchObject({ render: "raster", payload: null });
    const french = await createPrintJob(db, A, { deviceId: deviceA, kind: "test", language: "fr" });
    expect(french.render).toBe("text");
    expect(Buffer.from(french.payload!, "base64").subarray(0, 5)).toEqual(Buffer.from([0x1b, 0x40, 0x1b, 0x74, 19]));
  });

  it("profil « texte » forcé en PC850 : la page de codes choisie est annoncée à l'imprimante", async () => {
    await updatePrintDevice(db, A, deviceA, { paperWidthMm: 58, codePage: "pc850", renderMode: "text" });
    const job = await createPrintJob(db, A, { deviceId: deviceA, kind: "test", language: "ar" });
    expect(job.render).toBe("text");
    expect(job.unsupportedCharacters).toBeGreaterThan(0);
    expect(Buffer.from(job.payload!, "base64").subarray(0, 5)).toEqual(Buffer.from([0x1b, 0x40, 0x1b, 0x74, 2]));
    await updatePrintDevice(db, A, deviceA, { paperWidthMm: 58, codePage: "pc858", renderMode: "auto" });
  });

  it("commerce suspendu : aucune tâche créée, mais le ticket à l'écran reste consultable", async () => {
    await client.query("update business_profile set status='suspended' where business_id=$1", [bizB]);
    await expect(createPrintJob(db, B, { deviceId: deviceB, kind: "test" })).rejects.toMatchObject({ status: 403 });
    await expect(createPrintJob(db, B, { deviceId: deviceB, kind: "receipt", saleId: saleB })).rejects.toMatchObject({ status: 403 });
    expect((await getSaleReceiptDocument(db, { ...B, saleId: saleB, language: "en" })).labels.total).toBe("TOTAL");
    await client.query("update business_profile set status='active' where business_id=$1", [bizB]);
  });
});
