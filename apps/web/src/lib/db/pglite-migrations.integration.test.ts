import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";

describe("versioned migrations on isolated PGlite", () => {
  const client = new PGlite();
  const db = drizzle(client);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  });

  afterAll(async () => {
    await client.close();
  });

  it("applies the eight committed migrations and creates the expected tables", async () => {
    const applied = await client.query<{ count: string }>(
      'select count(*)::text as count from drizzle."__drizzle_migrations"',
    );
    const tables = await client.query<{ count: string }>(
      "select count(*)::text as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );

    expect(applied.rows[0]?.count).toBe("8");
    expect(tables.rows[0]?.count).toBe("37");
    const names = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
    );
    expect(names.rows.map((row) => row.table_name)).toEqual([
      "account", "audit_event", "business_profile", "business_subscription", "customer", "expense", "idempotency_record",
      "inventory_line", "inventory_scope_variant", "inventory_session", "invitation", "member", "organization", "payment",
      "payment_provider_event", "payment_refund", "platform_admin", "product", "product_category",
      "product_variant", "promotion_code", "promotion_eligible_business", "promotion_redemption", "purchase", "purchase_line",
      "purchase_payment", "receipt_settings", "receivable_payment", "sale", "sale_line", "session",
      "stock_movement", "subscription_payment", "subscription_plan", "supplier", "user", "verification",
    ]);
  });

  it("preserves the required PostgreSQL types, tenant keys, and protected history", async () => {
    const columns = await client.query<{ table_name: string; column_name: string; data_type: string; numeric_precision: number | null; numeric_scale: number | null }>(
      "select table_name,column_name,data_type,numeric_precision,numeric_scale from information_schema.columns where table_schema='public' and ((table_name='sale' and column_name='total_xof') or (table_name='product_variant' and column_name in ('on_hand','average_cost_xof')) or (table_name='sale_line' and column_name='unit_cost_snapshot_xof')) order by table_name,column_name",
    );
    expect(columns.rows).toEqual([
      { table_name: "product_variant", column_name: "average_cost_xof", data_type: "numeric", numeric_precision: 30, numeric_scale: 12 },
      { table_name: "product_variant", column_name: "on_hand", data_type: "numeric", numeric_precision: 24, numeric_scale: 6 },
      { table_name: "sale", column_name: "total_xof", data_type: "bigint", numeric_precision: 64, numeric_scale: 0 },
      { table_name: "sale_line", column_name: "unit_cost_snapshot_xof", data_type: "numeric", numeric_precision: 30, numeric_scale: 12 },
    ]);
    const compositeTenantFks = await client.query<{ count: string }>(
      "select count(*)::text as count from pg_constraint where contype='f' and cardinality(conkey) > 1",
    );
    expect(Number(compositeTenantFks.rows[0]?.count)).toBeGreaterThan(15);
    const protectedFk = await client.query<{ delete_rule: string }>(
      "select rc.delete_rule from information_schema.referential_constraints rc where rc.constraint_name='sale_line_sale_tenant_fk'",
    );
    expect(protectedFk.rows[0]?.delete_rule).toBe("NO ACTION");
    const uniqueTarget = await client.query<{ count: string }>(
      "select count(*)::text as count from pg_constraint where conrelid='subscription_payment'::regclass and contype='u' and conname='subscription_payment_business_id_unique'",
    );
    expect(uniqueTarget.rows[0]?.count).toBe("1");
  });

  it("does not reapply migrations on a second migrate() call", async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    const applied = await client.query<{ count: string }>(
      'select count(*)::text as count from drizzle."__drizzle_migrations"',
    );
    expect(applied.rows[0]?.count).toBe("8");
  });
});
