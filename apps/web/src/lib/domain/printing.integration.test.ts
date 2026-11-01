import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import { addPrintDevice, archivePrintDevice, createPrintJob, getPrinterSetup, listPrintJobs, reportPrintResult, updatePrinterSettings } from "./printing";

describe("module d'impression thermique (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const [biz, other] = ["p-biz", "p-other"];
  const [owner, cashier, stock, outsider] = ["p-owner", "p-cashier", "p-stock", "p-outsider"];
  const A = { businessId: biz, actorUserId: owner };
  let saleId = "";
  let otherSaleId = "";
  let deviceId = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const id of [owner, cashier, stock, outsider]) await client.query(`insert into "user"(id,name,email) values ($1,$1,$2)`, [id, `${id}@p.test`]);
    for (const id of [biz, other]) {
      await client.query("insert into organization(id,name,slug) values ($1,'Boutique Élégance',$1)", [id]);
      await client.query("insert into business_profile(business_id,activity,phone,address) values ($1,'clothing','+225 01 02 03 04','Cocody, Abidjan')", [id]);
    }
    await client.query("insert into receipt_settings(business_id,paper_width_mm,footer) values ($1,80,'Merci, à très bientôt !')", [biz]);
    await client.query("insert into member(id,organization_id,user_id,role) values ('pm1',$1,$2,'owner'),('pm2',$1,$3,'cashier'),('pm3',$1,$4,'stock_manager'),('pm4',$5,$6,'owner')", [biz, owner, cashier, stock, other, outsider]);
    const variant = (await createProduct(db, { businessId: biz, actorUserId: owner, name: "Robe en wax", salePriceXof: "12500" })).variantId;
    await client.query("update product_variant set on_hand='10' where id=$1", [variant]);
    saleId = (await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: "p-sale-key-0001", lines: [{ variantId: variant, quantity: "2" }], payments: [{ method: "cash", amountXof: "25000" }] })).id;
    const otherVariant = (await createProduct(db, { businessId: other, actorUserId: outsider, name: "Téléphone", salePriceXof: "50000" })).variantId;
    await client.query("update product_variant set on_hand='1' where id=$1", [otherVariant]);
    otherSaleId = (await createSale(db, { businessId: other, actorUserId: outsider, idempotencyKey: "p-sale-key-0002", lines: [{ variantId: otherVariant, quantity: "1" }], payments: [{ method: "cash", amountXof: "50000" }] })).id;
  });
  afterAll(async () => { await client.close(); });

  it("désactivé par défaut : un commerce sans imprimante n'a rien à faire, et l'impression est refusée", async () => {
    expect(await getPrinterSetup(db, A)).toMatchObject({ enabled: false, autoPrint: false, devices: [] });
    deviceId = (await addPrintDevice(db, A, { name: "Caisse 1", transport: "tcp", paperWidthMm: 80, agentId: "agent-0001-abcd" })).id;
    await expect(createPrintJob(db, A, { deviceId, kind: "test" })).rejects.toMatchObject({ code: "module_disabled" });
  });

  it("seul un responsable configure ; le caissier imprime ; le gestionnaire de stock non", async () => {
    await expect(updatePrinterSettings(db, { businessId: biz, actorUserId: cashier }, { enabled: true, autoPrint: true })).rejects.toMatchObject({ status: 403 });
    await expect(getPrinterSetup(db, { businessId: biz, actorUserId: stock })).rejects.toMatchObject({ status: 403 });
    expect(await updatePrinterSettings(db, A, { enabled: true, autoPrint: true })).toMatchObject({ enabled: true, autoPrint: true });
    expect((await getPrinterSetup(db, { businessId: biz, actorUserId: cashier })).permissions).toEqual({ configure: false, print: true });
  });

  it("ticket construit depuis la vente validée, dans ce commerce seulement", async () => {
    const job = await createPrintJob(db, { businessId: biz, actorUserId: cashier }, { deviceId, kind: "receipt", saleId });
    expect(job.job).toMatchObject({ status: "pending", duplicate: false });
    expect(job.preview!.join("\n")).toMatch(/Robe en wax[\s\S]*TOTAL\s+25 000 F/);
    expect(Buffer.from(job.payload!, "base64").subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    await expect(createPrintJob(db, A, { deviceId, kind: "receipt", saleId: otherSaleId })).rejects.toMatchObject({ status: 404 });
    await expect(createPrintJob(db, { businessId: other, actorUserId: outsider }, { deviceId, kind: "test" })).rejects.toMatchObject({ status: 409 });
  });

  it("pas de double impression accidentelle ; état incertain tranché par la personne ; réimpression volontaire tracée", async () => {
    const again = await createPrintJob(db, { businessId: biz, actorUserId: cashier }, { deviceId, kind: "receipt", saleId });
    expect(again.job.duplicate).toBe(true);
    expect(again.payload).not.toBeNull(); // encore « pending » : même tâche, le service local ne l'imprimera qu'une fois
    await reportPrintResult(db, A, again.job.id, { status: "uncertain", errorCode: "timeout" });
    await expect(reportPrintResult(db, A, again.job.id, { status: "pending" })).rejects.toThrow();
    await reportPrintResult(db, A, again.job.id, { status: "printed" });
    const third = await createPrintJob(db, A, { deviceId, kind: "receipt", saleId });
    expect(third).toMatchObject({ job: { duplicate: true, status: "printed" }, payload: null });
    await expect(reportPrintResult(db, A, again.job.id, { status: "failed" })).rejects.toMatchObject({ code: "job_final" });
    const reprint = await createPrintJob(db, A, { deviceId, kind: "receipt", saleId, reprintOfJobId: again.job.id });
    expect(reprint.job.duplicate).toBe(false);
    const audit = await client.query("select 1 from audit_event where event_type='printer.receipt_reprinted'");
    expect(audit.rows).toHaveLength(1);
    const history = await listPrintJobs(db, A);
    expect(history.map((row) => row.status)).toEqual(["pending", "printed"]);
    expect(history[0]).toMatchObject({ reference: expect.stringMatching(/^V-/), deviceName: "Caisse 1" });
  });

  it("une panne d'imprimante n'affecte jamais la vente", async () => {
    const test = await createPrintJob(db, A, { deviceId, kind: "test" });
    await reportPrintResult(db, A, test.job.id, { status: "failed", errorCode: "paper_out", deviceStatus: "paper_out" });
    const saleRow = await client.query<{ status: string; total_xof: string }>("select status,total_xof::text from sale where id=$1", [saleId]);
    expect(saleRow.rows[0]).toEqual({ status: "completed", total_xof: "25000" });
    expect((await getPrinterSetup(db, A)).devices[0]).toMatchObject({ lastStatus: "paper_out" });
    await archivePrintDevice(db, A, deviceId);
    await expect(createPrintJob(db, A, { deviceId, kind: "test" })).rejects.toMatchObject({ status: 404 });
  });
});
