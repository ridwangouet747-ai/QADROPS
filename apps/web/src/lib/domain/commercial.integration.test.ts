import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, createSale, listProducts, CommercialError } from "./commercial";
import { databaseSchema } from "../db/schema";

describe("commercial flow on PGlite", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const businessA = "biz-a";
  const businessB = "biz-b";
  const actor = "user-owner";
  let variantId = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, email] of [[actor, "owner-a@example.test"], ["user-b", "owner-b@example.test"]]) {
      await client.query("insert into \"user\" (id,name,email) values ($1,$2,$3)", [id, "Test Owner", email]);
    }
    for (const [id, name, slug] of [[businessA, "Commerce A", "commerce-a"], [businessB, "Commerce B", "commerce-b"]]) {
      await client.query("insert into organization (id,name,slug) values ($1,$2,$3)", [id, name, slug]);
      await client.query("insert into business_profile (business_id,activity) values ($1,'general')", [id]);
    }
    await client.query("insert into member (id,organization_id,user_id,role) values ('member-a',$1,$2,'owner'),('member-b',$3,'user-b','owner')", [businessA, actor, businessB]);
  });

  afterAll(async () => { await client.close(); });

  it("creates and lists tenant-scoped products", async () => {
    const created = await createProduct(db, { businessId: businessA, actorUserId: actor, name: "Clé plate", salePriceXof: "1500" });
    variantId = created.variantId;
    const products = await listProducts(db, { businessId: businessA, actorUserId: actor });
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe("Clé plate");
    expect(products[0]?.onHand).toBe("0.000000");
    await expect(listProducts(db, { businessId: businessB, actorUserId: actor })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a category reference across businesses at the SQL boundary", async () => {
    await client.query("insert into product_category(id,business_id,name) values ('cat-b',$1,'B category')", [businessB]);
    await expect(client.query(
      "insert into product(id,business_id,category_id,name,base_unit) values ('bad-product',$1,'cat-b','Intrusion','piece')",
      [businessA],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("records a sale, mixed payments and stock movement atomically", async () => {
    await client.query("update product_variant set on_hand='5.000000', average_cost_xof='700.000000000000' where business_id=$1 and id=$2", [businessA, variantId]);
    await client.query("insert into customer(id,business_id,name) values ('customer-mixed',$1,'Client paiement mixte')", [businessA]);
    const input = { businessId: businessA, actorUserId: actor, customerId: "customer-mixed", idempotencyKey: "sale-key-0001",
      lines: [{ variantId, quantity: "2" }], payments: [{ method: "cash", amountXof: "1000" }, { method: "wave", amountXof: "2000" }] };
    const first = await createSale(db, input);
    expect(first.totalXof).toBe(3000n);
    expect(first.paidXof).toBe(1000n);
    expect(first.dueXof).toBe(2000n);
    expect(first.replayed).toBe(false);
    const [stock] = await client.query<{ on_hand: string }>("select on_hand from product_variant where business_id=$1 and id=$2", [businessA, variantId]).then((r) => r.rows);
    expect(stock?.on_hand).toBe("3.000000");
    const [counts] = await client.query<{ sales: string; payments: string; movements: string }>(
      "select (select count(*) from sale where business_id=$1)::text as sales, (select count(*) from payment where business_id=$1)::text as payments, (select count(*) from stock_movement where business_id=$1)::text as movements",
      [businessA],
    ).then((r) => r.rows);
    expect(counts).toEqual({ sales: "1", payments: "2", movements: "1" });
    const paymentStates = await client.query<{ method: string; status: string }>("select method,status from payment where sale_id=$1 order by method", [first.id]);
    expect(paymentStates.rows).toEqual([{ method: "cash", status: "confirmed" }, { method: "wave", status: "pending" }]);
    await expect(client.query(
      "insert into payment(id,business_id,sale_id,method,amount_xof,idempotency_key) values ('cross-payment',$1,$2,'cash',1,'cross-payment-key')",
      [businessB, first.id],
    )).rejects.toMatchObject({ code: "23503" });
    await expect(client.query("delete from sale where business_id=$1 and id=$2", [businessA, first.id]))
      .rejects.toMatchObject({ code: "23503" });

    const replay = await createSale(db, input);
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);
    await expect(createSale(db, { ...input, payments: [{ method: "cash", amountXof: "3000" }] })).rejects.toMatchObject({ status: 409 });

    await expect(createSale(db, { businessId: businessA, actorUserId: actor, idempotencyKey: "sale-credit-no-client",
      lines: [{ variantId, quantity: "0.5" }], payments: [] })).rejects.toThrow(/Associez un client/);
    await client.query("insert into customer(id,business_id,name) values ('customer-a',$1,'Client test')", [businessA]);
    const credit = await createSale(db, { businessId: businessA, actorUserId: actor, customerId: "customer-a", idempotencyKey: "sale-credit-0001",
      lines: [{ variantId, quantity: "0.5" }], payments: [] });
    expect(credit.totalXof).toBe(750n);
    expect(credit.dueXof).toBe(750n);
  });

  it("rejects overselling and overpayment without partial writes", async () => {
    const before = await client.query<{ sales: string; movements: string }>(
      "select (select count(*) from sale where business_id=$1)::text as sales, (select count(*) from stock_movement where business_id=$1)::text as movements",
      [businessA],
    );
    const base = { businessId: businessA, actorUserId: actor, lines: [{ variantId, quantity: "4" }], payments: [{ method: "cash", amountXof: "6000" }] };
    await expect(createSale(db, { ...base, idempotencyKey: "sale-key-oversell" })).rejects.toBeInstanceOf(CommercialError);
    await expect(createSale(db, { ...base, lines: [{ variantId, quantity: "1" }], payments: [{ method: "cash", amountXof: "2000" }], idempotencyKey: "sale-key-overpay" })).rejects.toThrow(/dépasse/);
    const after = await client.query<{ sales: string; movements: string }>(
      "select (select count(*) from sale where business_id=$1)::text as sales, (select count(*) from stock_movement where business_id=$1)::text as movements",
      [businessA],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("applies auth-role permissions in addition to tenant scoping", async () => {
    await client.query("update member set role='cashier' where organization_id=$1 and user_id=$2", [businessA, actor]);
    await expect(createProduct(db, { businessId: businessA, actorUserId: actor, name: "Restricted", salePriceXof: "1" })).rejects.toMatchObject({ status: 403 });
    await client.query("update member set role='owner' where organization_id=$1 and user_id=$2", [businessA, actor]);
  });
});
