import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import {
  archiveBusinessProduct, createBusinessCustomer, createBusinessExpense, createBusinessSupplier, createCategory,
  createReceivedPurchase, listBusinessProducts, recordCustomerPayment, updateBusinessProduct, updateBusinessSettings,
} from "./business-data";
import { startInventory } from "./inventory";

describe("operation integrity: idempotent writes and blocked businesses (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const businessA = "integrity-business-a";
  const businessB = "integrity-business-b";
  const ownerA = "integrity-owner-a";
  const ownerB = "integrity-owner-b";
  let variantA = "";
  let productA = "";
  let supplierA = "";
  let customerA = "";

  const count = async (table: string, businessId: string) =>
    Number((await client.query<{ n: string }>(`select count(*)::text n from ${table} where business_id=$1`, [businessId])).rows[0].n);
  const onHand = async () => (await listBusinessProducts(db, { businessId: businessA, actorUserId: ownerA })).products[0].onHand;
  const setStatus = (status: string) => client.query("update business_profile set status=$1 where business_id=$2", [status, businessA]);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query("insert into \"user\"(id,name,email) values ($1,'Owner A','a@test.local'),($2,'Owner B','b@test.local')", [ownerA, ownerB]);
    for (const [id, slug] of [[businessA, "integrity-a"], [businessB, "integrity-b"]]) {
      await client.query("insert into organization(id,name,slug) values ($1,'Integrity',$2)", [id, slug]);
      await client.query("insert into business_profile(business_id,activity) values ($1,'general')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('integrity-member-a',$1,$2,'owner'),('integrity-member-b',$3,$4,'owner')", [businessA, ownerA, businessB, ownerB]);
    const product = await createProduct(db, { businessId: businessA, actorUserId: ownerA, name: "Ciment", salePriceXof: "1000" });
    productA = product.id; variantA = product.variantId;
    supplierA = (await createBusinessSupplier(db, { businessId: businessA, actorUserId: ownerA, name: "Fournisseur A" })).id;
    customerA = (await createBusinessCustomer(db, { businessId: businessA, actorUserId: ownerA, name: "Client A" })).id;
    await client.query("insert into subscription_plan(id,code,name,price_xof,duration_days) values ('integrity-plan','INTEGRITY','Test',5000,30)");
  });

  beforeEach(async () => {
    await setStatus("active");
    await client.query("delete from business_subscription where business_id=$1", [businessA]);
  });

  afterAll(async () => { await client.close(); });

  describe("idempotency", () => {
    const purchase = (key: string, reference: string, quantity = "10") => ({ businessId: businessA, actorUserId: ownerA, idempotencyKey: key,
      supplierId: supplierA, reference, lines: [{ variantId: variantA, quantity, unitCostXof: "500" }] });

    it("replays a received purchase instead of adding the stock twice (response lost after commit)", async () => {
      const first = await createReceivedPurchase(db, purchase("purchase-key-0001", "INT-ACH-001"));
      const stockAfterFirst = await onHand();
      const second = await createReceivedPurchase(db, purchase("purchase-key-0001", "INT-ACH-001"));
      expect(first.replayed).toBe(false);
      expect(second).toEqual({ ...first, replayed: true });
      expect(await onHand()).toBe(stockAfterFirst);
      expect(await count("purchase", businessA)).toBe(1);
      expect(await count("stock_movement", businessA)).toBe(1);
    });

    it("rejects a reused purchase key with a different content and changes nothing", async () => {
      const before = await onHand();
      await expect(createReceivedPurchase(db, purchase("purchase-key-0001", "INT-ACH-001", "11"))).rejects.toMatchObject({ status: 409 });
      expect(await onHand()).toBe(before);
    });

    it("rejects a new purchase that reuses an existing supplier reference", async () => {
      await expect(createReceivedPurchase(db, purchase("purchase-key-0002", "INT-ACH-001"))).rejects.toMatchObject({ status: 409 });
      expect(await count("purchase", businessA)).toBe(1);
    });

    it("records an expense once even when the same request is sent twice concurrently", async () => {
      const request = { businessId: businessA, actorUserId: ownerA, idempotencyKey: "expense-key-0001", category: "transport", description: "Livraison", amountXof: "2500" };
      const [one, two] = await Promise.all([createBusinessExpense(db, request), createBusinessExpense(db, request)]);
      expect(one.id).toBe(two.id);
      expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
      expect(await count("expense", businessA)).toBe(1);
      await expect(createBusinessExpense(db, { ...request, amountXof: "3000" })).rejects.toMatchObject({ status: 409 });
    });

    it("settles a receivable once per key and keeps the balance consistent", async () => {
      const sale = await createSale(db, { businessId: businessA, actorUserId: ownerA, customerId: customerA, idempotencyKey: "integrity-credit-sale",
        lines: [{ variantId: variantA, quantity: "2" }], payments: [] });
      const settle = { businessId: businessA, actorUserId: ownerA, idempotencyKey: "credit-key-0001", saleId: sale.id, amountXof: "500", method: "cash" };
      const first = await recordCustomerPayment(db, settle);
      const again = await recordCustomerPayment(db, settle);
      expect(again).toEqual({ ...first, replayed: true });
      expect(first.remainingXof).toBe("1500");
      expect(Number((await client.query<{ n: string }>("select count(*)::text n from payment where sale_id=$1", [sale.id])).rows[0].n)).toBe(1);
      await expect(recordCustomerPayment(db, { ...settle, idempotencyKey: "credit-key-0002", amountXof: "1501" })).rejects.toMatchObject({ status: 409 });
    });

    it("scopes keys per business: the same key in another business is a separate operation", async () => {
      const shared = { idempotencyKey: "expense-key-0001", category: "loyer", description: "Loyer B", amountXof: "9000" };
      const resultB = await createBusinessExpense(db, { businessId: businessB, actorUserId: ownerB, ...shared });
      expect(resultB.replayed).toBe(false);
      expect(await count("expense", businessB)).toBe(1);
      expect(await count("expense", businessA)).toBe(1);
    });

    it("never replays across tenants: a foreign actor is refused before any lookup", async () => {
      await expect(createBusinessExpense(db, { businessId: businessA, actorUserId: ownerB, idempotencyKey: "expense-key-0001",
        category: "transport", description: "Livraison", amountXof: "2500" })).rejects.toMatchObject({ status: 403 });
    });

    it("rejects missing or malformed operation keys", async () => {
      await expect(createBusinessExpense(db, { businessId: businessA, actorUserId: ownerA, category: "x", description: "y", amountXof: "1" })).rejects.toThrow();
      await expect(createBusinessExpense(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "short", category: "x", description: "y", amountXof: "1" })).rejects.toThrow();
    });
  });

  describe("business status guard", () => {
    const writes: [string, () => Promise<unknown>][] = [
      ["createProduct", () => createProduct(db, { businessId: businessA, actorUserId: ownerA, name: "Bloqué", salePriceXof: "1" })],
      ["createSale", () => createSale(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: `blocked-sale-${Math.random()}`, lines: [{ variantId: variantA, quantity: "1" }], payments: [{ method: "cash", amountXof: "1000" }] })],
      ["createCategory", () => createCategory(db, { businessId: businessA, actorUserId: ownerA, name: "Bloquée" })],
      ["updateBusinessProduct", () => updateBusinessProduct(db, { businessId: businessA, actorUserId: ownerA, productId: productA, variantId: variantA, name: "Ciment", description: null, categoryId: null, variantLabel: "Standard", sku: null, salePriceXof: "1000", lowStockThreshold: "0" })],
      ["archiveBusinessProduct", () => archiveBusinessProduct(db, { businessId: businessA, actorUserId: ownerA, productId: productA })],
      ["createBusinessCustomer", () => createBusinessCustomer(db, { businessId: businessA, actorUserId: ownerA, name: "Bloqué" })],
      ["createBusinessSupplier", () => createBusinessSupplier(db, { businessId: businessA, actorUserId: ownerA, name: "Bloqué" })],
      ["createReceivedPurchase", () => createReceivedPurchase(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "blocked-purchase-1", supplierId: supplierA, reference: "BLOQUE-1", lines: [{ variantId: variantA, quantity: "1", unitCostXof: "1" }] })],
      ["createBusinessExpense", () => createBusinessExpense(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "blocked-expense-1", category: "x", description: "y", amountXof: "1" })],
      ["updateBusinessSettings", () => updateBusinessSettings(db, { businessId: businessA, actorUserId: ownerA, name: "Bloqué", phone: null, address: null, email: "", primaryColor: "#2563EB", paperWidthMm: 80, showLogo: false, receiptFooter: null })],
      ["startInventory", () => startInventory(db, { businessId: businessA, actorUserId: ownerA })],
    ];

    it.each(["suspended", "expired"])("blocks every commercial write while the business is %s, without writing anything", async (status) => {
      await setStatus(status);
      const before = await count("audit_event", businessA);
      for (const [name, write] of writes) {
        await expect(write(), name).rejects.toMatchObject({ status: 403 });
      }
      expect(await count("audit_event", businessA)).toBe(before);
    });

    it("keeps data readable and still answers replays of operations completed before the suspension", async () => {
      await setStatus("suspended");
      await expect(listBusinessProducts(db, { businessId: businessA, actorUserId: ownerA })).resolves.toMatchObject({ products: expect.any(Array) });
      await expect(createBusinessExpense(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "expense-key-0001",
        category: "transport", description: "Livraison", amountXof: "2500" })).resolves.toMatchObject({ replayed: true });
    });

    it("blocks writes once the only subscription in force has ended, and allows them again with a running one", async () => {
      await client.query("insert into business_subscription(id,business_id,plan_id,status,starts_at,ends_at) values ('integrity-sub-old',$1,'integrity-plan','active',now()-interval '40 days',now()-interval '1 day')", [businessA]);
      await expect(createCategory(db, { businessId: businessA, actorUserId: ownerA, name: "Après échéance" })).rejects.toMatchObject({ status: 403 });
      await client.query("insert into business_subscription(id,business_id,plan_id,status,starts_at,ends_at) values ('integrity-sub-new',$1,'integrity-plan','active',now()-interval '1 day',now()+interval '29 days')", [businessA]);
      await expect(createCategory(db, { businessId: businessA, actorUserId: ownerA, name: "Abonnement renouvelé" })).resolves.toMatchObject({ name: "Abonnement renouvelé" });
    });

    it("does not block a business whose only subscription is still pending (policy not decided yet)", async () => {
      await client.query("insert into business_subscription(id,business_id,plan_id,status,starts_at,ends_at) values ('integrity-sub-pending',$1,'integrity-plan','pending',now(),now()+interval '30 days')", [businessA]);
      await expect(createCategory(db, { businessId: businessA, actorUserId: ownerA, name: "En attente" })).resolves.toMatchObject({ name: "En attente" });
    });

    it("does not affect another business when one is suspended", async () => {
      await setStatus("suspended");
      await expect(createCategory(db, { businessId: businessB, actorUserId: ownerB, name: "Commerce B actif" })).resolves.toMatchObject({ name: "Commerce B actif" });
    });
  });
});
