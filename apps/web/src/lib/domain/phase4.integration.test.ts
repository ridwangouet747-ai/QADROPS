import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import { getCommercialReport, reportCsv } from "./reports";
import { getInventorySession, recordInventoryCount, startInventory, submitInventory, validateInventory } from "./inventory";

describe("phase 4 inventory and commercial reports on isolated PGlite", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const businessId = "phase4-business";
  const otherBusinessId = "phase4-other-business";
  const counter = "phase4-counter";
  const verifier = "phase4-verifier";
  const now = new Date("2026-10-18T12:00:00.000Z");
  let variantId = "";
  let saleId = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, email] of [[counter, "counter@phase4.test"], [verifier, "verifier@phase4.test"], ["phase4-outsider", "outsider@phase4.test"]]) {
      await client.query("insert into \"user\" (id,name,email) values ($1,'Phase Four User',$2)", [id, email]);
    }
    for (const [id, slug] of [[businessId, "phase4-business"], [otherBusinessId, "phase4-other"]]) {
      await client.query("insert into organization (id,name,slug) values ($1,'Test Commerce',$2)", [id, slug]);
      await client.query("insert into business_profile (business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('phase4-member-counter',$1,$2,'owner'),('phase4-member-verifier',$1,$3,'stock_manager'),('phase4-member-outsider',$4,'phase4-outsider','owner')", [businessId, counter, verifier, otherBusinessId]);
    const created = await createProduct(db, { businessId, actorUserId: counter, name: "=QADR-test-product", salePriceXof: "200" });
    variantId = created.variantId;
    await client.query("update product_variant set on_hand='10',average_cost_xof='100',cost_known=true where business_id=$1 and id=$2", [businessId, variantId]);
    await client.query("insert into customer(id,business_id,name) values ('phase4-customer',$1,'Fixture')", [businessId]);
    await client.query("insert into supplier(id,business_id,name) values ('phase4-supplier',$1,'Fixture Supplier')", [businessId]);
    const createdSale = await createSale(db, { businessId, actorUserId: counter, customerId: "phase4-customer", idempotencyKey: "phase4-sale-key-001",
      lines: [{ variantId, quantity: "2" }], payments: [{ method: "cash", amountXof: "100" }] });
    saleId = createdSale.id;
    await client.query("update sale set occurred_at=$2 where business_id=$1 and id=$3", [businessId, now, saleId]);
    await client.query("insert into payment_refund(id,business_id,payment_id,amount_xof,status,reference,created_by_user_id,occurred_at) values ('phase4-refund',$1,(select id from payment where sale_id=$2 limit 1),25,'confirmed','phase4-refund-ref',$3,$4)", [businessId, saleId, counter, now]);
    await client.query("insert into expense(id,business_id,category,description,amount_xof,paid_by_user_id,occurred_at) values ('phase4-expense',$1,'supplies','Fixture',50,$2,$3)", [businessId, counter, now]);
    await client.query("insert into purchase(id,business_id,supplier_id,reference,status,total_xof,occurred_at) values ('phase4-purchase',$1,'phase4-supplier','P-001','received',700,$2)", [businessId, now]);
    await client.query("update payment set confirmed_at=$3,occurred_at=$3 where sale_id=$2 and business_id=$1", [businessId, saleId, now]);
  });

  afterAll(async () => { await client.close(); });

  it("captures the theoretical balance at count time and applies only the variance to later stock", async () => {
    await expect(startInventory(db, { businessId, actorUserId: "phase4-outsider" })).rejects.toMatchObject({ status: 403 });
    const session = await startInventory(db, { businessId, actorUserId: counter });
    await expect(recordInventoryCount(db, { businessId, actorUserId: counter, sessionId: session.id, variantId, countedQty: "6" })).rejects.toThrow(/motif/);
    const recorded = await recordInventoryCount(db, { businessId, actorUserId: counter, sessionId: session.id, variantId, countedQty: "6", adjustmentReason: "Casse constatée" });
    expect(recorded).toEqual({ saved: true, theoreticalQty: "8.000000", countedQty: "6.000000", differenceQty: "-2.000000" });
    await expect(submitInventory(db, { businessId, actorUserId: counter, sessionId: session.id })).resolves.toMatchObject({ status: "submitted", lineCount: 1 });

    // Simulate a received movement after the physical count: only that +3 is kept on validation.
    await client.query("update product_variant set on_hand='11',stock_revision=stock_revision+1 where business_id=$1 and id=$2", [businessId, variantId]);
    await expect(validateInventory(db, { businessId, actorUserId: counter, sessionId: session.id })).rejects.toMatchObject({ status: 403 });
    await expect(validateInventory(db, { businessId, actorUserId: verifier, sessionId: session.id })).resolves.toMatchObject({ status: "validated", adjustedCount: 1, replayed: false });
    await expect(validateInventory(db, { businessId, actorUserId: verifier, sessionId: session.id })).resolves.toMatchObject({ replayed: true });
    const stock = await client.query<{ on_hand: string; adjustments: string }>("select on_hand,(select count(*)::text from stock_movement where inventory_line_id is not null) as adjustments from product_variant where business_id=$1 and id=$2", [businessId, variantId]);
    expect(stock.rows[0]).toEqual({ on_hand: "9.000000", adjustments: "1" });
    const detail = await getInventorySession(db, { businessId, actorUserId: verifier, sessionId: session.id });
    expect(detail.lines[0]).toMatchObject({ theoreticalQty: "8.000000", countedQty: "6.000000", adjustmentReason: "Casse constatée" });

    const gainSession = await startInventory(db, { businessId, actorUserId: counter });
    await recordInventoryCount(db, { businessId, actorUserId: counter, sessionId: gainSession.id, variantId, countedQty: "10", adjustmentReason: "Stock retrouvé" });
    await submitInventory(db, { businessId, actorUserId: counter, sessionId: gainSession.id });
    await client.query("update product_variant set on_hand='11',stock_revision=stock_revision+1 where business_id=$1 and id=$2", [businessId, variantId]);
    await expect(validateInventory(db, { businessId, actorUserId: verifier, sessionId: gainSession.id })).resolves.toMatchObject({ status: "validated", adjustedCount: 1 });
    const [gainStock] = await client.query<{ on_hand: string; adjustments: string }>("select on_hand,(select count(*)::text from stock_movement where inventory_line_id is not null) as adjustments from product_variant where business_id=$1 and id=$2", [businessId, variantId]).then((result) => result.rows);
    expect(gainStock).toEqual({ on_hand: "12.000000", adjustments: "2" });
    // Keep this report fixture on its declared business date, independent of the machine clock.
    await client.query("update inventory_session set validated_at=$2 where business_id=$1 and status='validated'", [businessId, now]);
    await client.query("update stock_movement set occurred_at=$2 where business_id=$1 and reason='inventory_adjustment'", [businessId, now]);
  });

  it("does not validate an adjustment that would make current stock negative", async () => {
    const session = await startInventory(db, { businessId, actorUserId: counter });
    await recordInventoryCount(db, { businessId, actorUserId: counter, sessionId: session.id, variantId, countedQty: "0", adjustmentReason: "Écart à investiguer" });
    await submitInventory(db, { businessId, actorUserId: counter, sessionId: session.id });
    await client.query("update product_variant set on_hand='0' where business_id=$1 and id=$2", [businessId, variantId]);
    await expect(validateInventory(db, { businessId, actorUserId: verifier, sessionId: session.id })).rejects.toMatchObject({ status: 409 });
    const [state] = await client.query<{ status: string; movements: string }>("select status,(select count(*)::text from stock_movement where inventory_line_id=(select id from inventory_line where session_id=$1)) as movements from inventory_session where id=$1", [session.id]).then((result) => result.rows);
    expect(state).toEqual({ status: "submitted", movements: "0" });
  });

  it("reports tenant-scoped flows with the specified dates and hides margin when costs are unknown", async () => {
    const report = await getCommercialReport(db, { businessId, actorUserId: counter, period: "custom", startDate: "2026-10-18", endDate: "2026-10-18" }, now);
    expect(report).toMatchObject({
      startDate: "2026-10-18", endDate: "2026-10-18",
      sales: { revenueXof: "400", count: "1", averageBasketXof: "400", previousRevenueXof: "0", changePercent: null },
      settlement: { paid: "0", partial: "1", credit: "0" },
      collections: { totalXof: "100", byMethod: [{ method: "cash", amountXof: "100" }] },
      receivablesAsOf: { totalXof: "300", count: "1" }, refunds: { totalXof: "25", count: "1" },
      expenses: { totalXof: "50", count: "1" }, purchases: { totalXof: "700", count: "1" },
      grossMarginEstimate: { available: true, amountXof: "200" },
    });
    expect(report.topProducts[0]).toMatchObject({ name: "=QADR-test-product", quantity: "2.000000", revenueXof: "400" });
    expect(report.inventoryVariance).toMatchObject({ lossQty: "2.000000", gainQty: "1.000000", validatedSessionCount: "2" });
    expect(report.trend).toEqual([{ date: "2026-10-18", revenueXof: "400" }]);
    const csv = reportCsv(report);
    expect(csv).toContain("'=QADR-test-product");
    await expect(getCommercialReport(db, { businessId, actorUserId: "phase4-outsider", period: "monthly" }, now)).rejects.toMatchObject({ status: 403 });
    await client.query("update sale_line set cost_available=false where business_id=$1 and sale_id=$2", [businessId, saleId]);
    const withoutCost = await getCommercialReport(db, { businessId, actorUserId: counter, period: "monthly", date: "2026-10-18" }, now);
    expect(withoutCost.grossMarginEstimate).toMatchObject({ available: false, amountXof: null });
  });
});
