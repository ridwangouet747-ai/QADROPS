import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { initializeDemoData } from "./database";

describe("isolated platform and retail preview fixtures", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const previousMode = process.env.QADR_PREVIEW_MODE;

  beforeAll(async () => {
    process.env.QADR_PREVIEW_MODE = "true";
    await initializeDemoData(client, db);
  });
  afterAll(async () => {
    await client.close();
    if (previousMode === undefined) delete process.env.QADR_PREVIEW_MODE;
    else process.env.QADR_PREVIEW_MODE = previousMode;
  });

  it("creates the platform admin separately and seeds connected synthetic commerce activity", async () => {
    const [counts] = await client.query<{ businesses: string; admins: string; platform_memberships: string; sales: string; refunds: string; inventories: string; subscriptions: string; saas_payments: string; promotions: string }>(
      "select (select count(*)::text from business_profile) businesses, (select count(*)::text from platform_admin) admins, (select count(*)::text from member where user_id='qadr-preview-platform-admin') platform_memberships, (select count(*)::text from sale) sales, (select count(*)::text from payment_refund where status='confirmed') refunds, (select count(*)::text from inventory_session where status='validated') inventories, (select count(*)::text from business_subscription) subscriptions, (select count(*)::text from subscription_payment where status='confirmed') saas_payments, (select count(*)::text from promotion_redemption) promotions",
    ).then((result) => result.rows);
    expect(counts).toEqual({ businesses: "5", admins: "1", platform_memberships: "0", sales: "3", refunds: "1", inventories: "1", subscriptions: "5", saas_payments: "1", promotions: "1" });
    const [ranges] = await client.query<{ distinct_dates: string; paid_shop_xof: string; subscription_xof: string }>(
      "select (select count(distinct date_trunc('day',occurred_at))::text from sale) distinct_dates, (select coalesce(sum(amount_xof),0)::text from payment where status='confirmed') paid_shop_xof, (select coalesce(sum(amount_xof),0)::text from subscription_payment where status='confirmed') subscription_xof",
    ).then((result) => result.rows);
    expect(Number(ranges?.distinct_dates)).toBeGreaterThanOrEqual(3);
    expect(ranges?.paid_shop_xof).not.toBe(ranges?.subscription_xof);
  });

  it("is idempotent when the preview initializer runs again", async () => {
    await initializeDemoData(client, db);
    const [counts] = await client.query<{ businesses: string; sales: string; subscriptions: string; redemptions: string }>(
      "select (select count(*)::text from business_profile) businesses, (select count(*)::text from sale) sales, (select count(*)::text from business_subscription) subscriptions, (select count(*)::text from promotion_redemption) redemptions",
    ).then((result) => result.rows);
    expect(counts).toEqual({ businesses: "5", sales: "3", subscriptions: "5", redemptions: "1" });
  });
});
