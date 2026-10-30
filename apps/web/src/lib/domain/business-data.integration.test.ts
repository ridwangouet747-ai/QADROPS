import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct } from "./commercial";
import {
  createBusinessCustomer, createBusinessExpense, createBusinessSupplier, createReceivedPurchase,
  getBusinessSettings, getStockWorkspace, listBusinessCustomers, listBusinessProducts, recordCustomerPayment,
  updateBusinessSettings,
} from "./business-data";

describe("commercial workspace operations on isolated PGlite", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const businessId = "workspace-business";
  const outsiderBusinessId = "workspace-other-business";
  const ownerId = "workspace-owner";
  let variantId = "";
  let customerId = "";
  let supplierId = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query("insert into \"user\"(id,name,email) values ($1,'Workspace Owner','workspace-owner@test.local'),('workspace-outsider','Other Owner','workspace-outsider@test.local')", [ownerId]);
    for (const [id, slug] of [[businessId, "workspace-business"], [outsiderBusinessId, "workspace-other"]]) {
      await client.query("insert into organization(id,name,slug) values ($1,'Workspace Test',$2)", [id, slug]);
      await client.query("insert into business_profile(business_id,activity) values ($1,'general')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('workspace-owner-member',$1,$2,'owner'),('workspace-outsider-member',$3,'workspace-outsider','owner')", [businessId, ownerId, outsiderBusinessId]);
    const product = await createProduct(db, { businessId, actorUserId: ownerId, name: "Article de test", salePriceXof: "500" });
    variantId = product.variantId;
    customerId = (await createBusinessCustomer(db, { businessId, actorUserId: ownerId, name: "Client fictif" })).id;
    supplierId = (await createBusinessSupplier(db, { businessId, actorUserId: ownerId, name: "Fournisseur fictif" })).id;
  });

  afterAll(async () => { await client.close(); });

  it("receives purchases atomically and recalculates weighted average cost", async () => {
    await createReceivedPurchase(db, { businessId, actorUserId: ownerId, supplierId, idempotencyKey: "test-reception-01", reference: "TEST-RECEPTION-01", lines: [{ variantId, quantity: "10", unitCostXof: "100" }], paidXof: "200" });
    await createReceivedPurchase(db, { businessId, actorUserId: ownerId, supplierId, idempotencyKey: "test-reception-02", reference: "TEST-RECEPTION-02", lines: [{ variantId, quantity: "10", unitCostXof: "200" }] });
    const data = await listBusinessProducts(db, { businessId, actorUserId: ownerId });
    expect(data.products[0]).toMatchObject({ onHand: "20.000000", averageCostXof: "150.000000000000", costKnown: true });
    const workspace = await getStockWorkspace(db, { businessId, actorUserId: ownerId });
    expect(workspace.movements).toHaveLength(2);
    expect(workspace.movements.map((movement) => movement.reason)).toEqual(["purchase", "purchase"]);
  });

  it("keeps customer balances as tenant-scoped event totals and accepts partial settlement", async () => {
    const sale = await import("./commercial").then(({ createSale }) => createSale(db, {
      businessId, actorUserId: ownerId, customerId, idempotencyKey: "workspace-credit-sale-01",
      lines: [{ variantId, quantity: "2" }], payments: [{ method: "cash", amountXof: "300" }],
    }));
    expect(sale.dueXof).toBe(700n);
    await createBusinessExpense(db, { businessId, actorUserId: ownerId, idempotencyKey: "test-expense-01", category: "transport", description: "Trajet test", amountXof: "75" });
    await expect(recordCustomerPayment(db, { businessId, actorUserId: ownerId, idempotencyKey: "test-credit-01", saleId: sale.id, amountXof: "200", method: "wave" })).resolves.toMatchObject({ remainingXof: "500" });
    const customers = await listBusinessCustomers(db, { businessId, actorUserId: ownerId });
    expect(customers[0]).toMatchObject({ balanceXof: "500", saleCount: "1" });
    await expect(recordCustomerPayment(db, { businessId, actorUserId: ownerId, idempotencyKey: "test-credit-02", saleId: sale.id, amountXof: "501", method: "cash" })).rejects.toMatchObject({ status: 409 });
  });

  it("saves only the active business identity and denies cross-tenant operations", async () => {
    await updateBusinessSettings(db, { businessId, actorUserId: ownerId, name: "Commerce de test", phone: null, address: "Adresse de test", email: "", primaryColor: "#2563EB", paperWidthMm: 80, showLogo: false, receiptFooter: "Merci" });
    await expect(getBusinessSettings(db, { businessId, actorUserId: ownerId })).resolves.toMatchObject({ name: "Commerce de test", paperWidthMm: 80, receiptFooter: "Merci" });
    await expect(getStockWorkspace(db, { businessId: outsiderBusinessId, actorUserId: ownerId })).rejects.toMatchObject({ status: 403 });
  });
});
