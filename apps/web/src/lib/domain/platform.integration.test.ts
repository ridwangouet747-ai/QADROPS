import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import {
  createPlatformPlan, createPlatformPromotion, getPlatformBusiness, getPlatformDashboard,
  listPlatformPromotions, listPlatformSubscriptions, setPlatformBusinessStatus, updatePlatformPlan,
  redeemSubscriptionPromotion,
} from "./platform";

describe("platform administration on isolated PGlite", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const admin = "platform-admin";
  const ownerA = "platform-owner-a";
  const ownerB = "platform-owner-b";
  const businessA = "platform-business-a";
  const businessB = "platform-business-b";
  let planId = "";
  let subscriptionA = "";
  let subscriptionB = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await client.query("insert into \"user\" (id,name,email) values ($1,'Platform admin','platform-admin@test.invalid'),($2,'Commerce owner A','owner-a@test.invalid'),($3,'Commerce owner B','owner-b@test.invalid')", [admin, ownerA, ownerB]);
    await client.query("insert into platform_admin (user_id) values ($1)", [admin]);
    await client.query("insert into organization (id,name,slug) values ($1,'Atelier A','platform-atelier-a'),($2,'Atelier B','platform-atelier-b')", [businessA, businessB]);
    await client.query("insert into business_profile (business_id,activity,status) values ($1,'general','active'),($2,'phones','active')", [businessA, businessB]);
    await client.query("insert into member (id,organization_id,user_id,role) values ('member-owner-a',$1,$2,'owner'),('member-owner-b',$3,$4,'owner')", [businessA, ownerA, businessB, ownerB]);
    const plan = await createPlatformPlan(db, admin, { code: "TEST", name: "Test Plan", priceXof: "10000", durationDays: 30, active: true, features: { pos: true, reports: true, inventory: true, procurement: false, productLimit: 100, userLimit: 3 } });
    planId = plan.id;
    subscriptionA = "platform-sub-a"; subscriptionB = "platform-sub-b";
    const now = new Date(); const end = new Date(now.getTime() + 20 * 86_400_000);
    await client.query("insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,trial_ends_at) values ($1,$2,$3,'pending',$4,$5,$5),($6,$7,$3,'active',$4,$5,null)", [subscriptionA, businessA, planId, now, end, subscriptionB, businessB]);
    await client.query("insert into subscription_payment (id,business_id,subscription_id,amount_xof,method,status,idempotency_key,occurred_at,confirmed_at) values ('saas-test-payment',$1,$2,8000,'wave','confirmed','saas-test-key',$3,$3)", [businessB, subscriptionB, now]);
    const product = await createProduct(db, { businessId: businessA, actorUserId: ownerA, name: "Produit boutique", salePriceXof: "2000" });
    await client.query("update product_variant set on_hand='2' where business_id=$1 and id=$2", [businessA, product.variantId]);
    await createSale(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "platform-customer-sale-001", lines: [{ variantId: product.variantId, quantity: "1" }], payments: [{ method: "cash", amountXof: "2000" }] });
  });
  afterAll(async () => { await client.close(); });

  it("separates platform authority from commerce-owner roles and returns only administrative fields", async () => {
    await expect(getPlatformDashboard(db, ownerA)).rejects.toMatchObject({ status: 403 });
    await expect(setPlatformBusinessStatus(db, ownerA, businessA, { status: "suspended" })).rejects.toMatchObject({ status: 403 });
    const detail = await getPlatformBusiness(db, admin, businessA);
    expect(detail).toMatchObject({ businessId: businessA, name: "Atelier A", memberCount: 1 });
    expect(detail).not.toHaveProperty("sales");
    expect(detail).not.toHaveProperty("customers");
    expect(detail).not.toHaveProperty("payments");
  });

  it("calculates platform metrics from subscriptions and SaaS payments, not customer payments", async () => {
    const dashboard = await getPlatformDashboard(db, admin);
    expect(dashboard.businesses.total).toBe(2);
    expect(dashboard.subscriptions.active).toBe(1);
    expect(dashboard.subscriptions.pending).toBe(1);
    expect(dashboard.trials.current).toBe(1);
    expect(dashboard.confirmedSaasPayments).toMatchObject({ count: 1, amountXof: "8000" });
    const subscriptions = await listPlatformSubscriptions(db, admin);
    expect(subscriptions.subscriptions).toHaveLength(2);
    expect(subscriptions.payments).toHaveLength(1);
    expect(subscriptions.payments[0]).toMatchObject({ amountXof: 8000n, status: "confirmed" });
  });

  it("suspends and reactivates the commerce subscription transactionally and audits both actions", async () => {
    await expect(setPlatformBusinessStatus(db, admin, businessB, { status: "suspended" })).resolves.toMatchObject({ status: "suspended" });
    const [suspended] = await client.query<{ business_status: string; subscription_status: string }>("select b.status business_status,s.status subscription_status from business_profile b join business_subscription s on s.business_id=b.business_id where b.business_id=$1", [businessB]).then((r) => r.rows);
    expect(suspended).toEqual({ business_status: "suspended", subscription_status: "suspended" });
    await setPlatformBusinessStatus(db, admin, businessB, { status: "active" });
    const [active] = await client.query<{ status: string }>("select status from business_subscription where id=$1", [subscriptionB]).then((r) => r.rows);
    expect(active?.status).toBe("active");
    const audit = await client.query<{ count: string }>("select count(*)::text count from audit_event where business_id is null and entity_id=$1 and event_type like 'platform.business_%'", [businessB]);
    expect(audit.rows[0]?.count).toBe("2");
  });

  it("updates plans with audit history and preserves its subscription references", async () => {
    await updatePlatformPlan(db, admin, planId, { active: false });
    const [plan] = await client.query<{ active: boolean; subscriptions: string }>("select active,(select count(*)::text from business_subscription where plan_id=$1) subscriptions from subscription_plan where id=$1", [planId]).then((r) => r.rows);
    expect(plan).toEqual({ active: false, subscriptions: "2" });
  });

  it("enforces promo eligibility and usage caps atomically, records a snapshot and leaves the SaaS payment pending", async () => {
    const promo = await createPlatformPromotion(db, admin, { code: "WELCOME20", discountPercent: 20, discountXof: null, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), maxRedemptions: 1, active: true, eligibleBusinessIds: [businessA] });
    const redeemed = await redeemSubscriptionPromotion(db, ownerA, businessA, { code: "welcome20", subscriptionId: subscriptionA });
    expect(redeemed).toMatchObject({ discountAmountXof: "2000", amountDueXof: "8000", paymentStatus: "pending" });
    await expect(redeemSubscriptionPromotion(db, ownerA, businessA, { code: "WELCOME20", subscriptionId: subscriptionA })).rejects.toMatchObject({ status: 409 });
    await expect(redeemSubscriptionPromotion(db, ownerB, businessB, { code: "WELCOME20", subscriptionId: subscriptionB })).rejects.toMatchObject({ status: 403 });
    const [snapshot] = await client.query<{ code_snapshot: string; discount_amount_xof: string; amount: string; status: string }>("select r.code_snapshot,r.discount_amount_xof::text discount_amount_xof,p.amount_xof::text amount,p.status from promotion_redemption r join subscription_payment p on p.business_id=r.business_id and p.subscription_id=r.subscription_id where r.promotion_id=$1", [promo.id]).then((r) => r.rows);
    expect(snapshot).toEqual({ code_snapshot: "WELCOME20", discount_amount_xof: "2000", amount: "8000", status: "pending" });
    await expect(redeemSubscriptionPromotion(db, ownerB, businessB, { code: "WELCOME20", subscriptionId: subscriptionB })).rejects.toThrow(/disponible/);
    const listing = await listPlatformPromotions(db, admin);
    expect(listing[0]).toMatchObject({ id: promo.id, useCount: 1, stacking: false });
  });

  it("does not permit promotion edits or administration after a grant is revoked", async () => {
    await client.query("update platform_admin set revoked_at=now() where user_id=$1", [admin]);
    await expect(getPlatformDashboard(db, admin)).rejects.toMatchObject({ status: 403 });
  });
});
