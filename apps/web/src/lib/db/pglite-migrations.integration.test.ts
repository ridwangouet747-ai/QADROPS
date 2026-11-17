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

  it("applies every committed migration (0000-0027) and creates the expected tables", async () => {
    const applied = await client.query<{ count: string }>(
      'select count(*)::text as count from drizzle."__drizzle_migrations"',
    );
    const tables = await client.query<{ count: string }>(
      "select count(*)::text as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );

    expect(applied.rows[0]?.count).toBe("28");
    expect(tables.rows[0]?.count).toBe("65");
    const names = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
    );
    expect(names.rows.map((row) => row.table_name)).toEqual([
      "account", "audit_event", "business_invite_code", "business_member_access", "business_profile", "business_subscription", "cash_movement", "cash_session", "commercial_access_code", "customer", "expense", "idempotency_record", "import_batch", "import_row",
      "inventory_line", "inventory_scope_variant", "inventory_session", "invitation", "member", "notification", "notification_campaign", "notification_delivery", "notification_outbox",
      "notification_preference", "notification_template", "opening_balance", "opening_balance_payment", "organization", "payment",
      "payment_provider_event", "payment_refund", "platform_admin", "platform_session", "print_device", "print_job", "printer_settings", "product", "product_alias", "product_category",
      "product_variant", "promotion_code", "promotion_eligible_business", "promotion_eligible_plan", "promotion_redemption", "purchase", "purchase_line",
      "purchase_payment", "push_subscription", "rate_limit_bucket", "receipt_settings", "receivable_payment", "sale", "sale_line", "session",
      "stock_movement", "stock_opening", "stock_opening_line", "stored_file", "subscription_invoice", "subscription_payment", "subscription_plan", "supplier", "two_factor", "user", "verification",
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
    // Migration 0016 : profil d'imprimante (page de codes, mode d'écriture) avec valeurs par défaut sûres.
    const printerProfile = await client.query<{ column_name: string; column_default: string }>(
      "select column_name,column_default from information_schema.columns where table_schema='public' and table_name='print_device' and column_name in ('code_page','render_mode') order by column_name",
    );
    expect(printerProfile.rows).toEqual([
      { column_name: "code_page", column_default: "'pc858'::text" },
      { column_name: "render_mode", column_default: "'auto'::text" },
    ]);
    // Migration 0017 (mission 11, phase 6) : index des requêtes réelles, tous préfixés par business_id sauf
    // notification_delivery (table plateforme, sans commerce).
    const performanceIndexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname='public' and indexname in ('customer_business_name_idx','sale_customer_idx','purchase_supplier_idx','purchase_payment_purchase_idx','purchase_payment_cash_session_idx','expense_cash_session_idx','refund_business_date_idx','refund_cash_session_idx','opening_payment_cash_session_idx','notification_delivery_subscription_idx','notification_delivery_attempted_idx') order by indexname",
    );
    expect(performanceIndexes.rows).toHaveLength(11);
    // Migration 0018 (mission 12, L1b) : un événement prestataire inconnu reste sans commerce, dédupliqué
    // globalement ; une seule facture d'abonnement ouverte par commerce.
    const billing = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname='public' and indexname in ('provider_event_provider_event_unique','subscription_invoice_one_open_unique','subscription_payment_provider_global_reference_unique') order by indexname",
    );
    expect(billing.rows.map((row) => row.indexname)).toEqual(["provider_event_provider_event_unique", "subscription_invoice_one_open_unique", "subscription_payment_provider_global_reference_unique"]);
    const nullable = await client.query<{ is_nullable: string }>("select is_nullable from information_schema.columns where table_name='payment_provider_event' and column_name='business_id'");
    expect(nullable.rows[0]?.is_nullable).toBe("YES");
    // Migration 0020 (mission 12, L1a) : tout code existant reste privé ; une campagne publique est un autre type.
    const audience = await client.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_schema='public' and table_name='promotion_code' and column_name='audience'",
    );
    expect(audience.rows[0]?.column_default).toBe("'private'::text");
    // Migration 0026 (2026-11-16) : employés sans adresse e-mail ; codes stockés en empreinte unique ; RLS sur les codes d'équipe.
    const email = await client.query<{ is_nullable: string }>("select is_nullable from information_schema.columns where table_schema='public' and table_name='user' and column_name='email'");
    expect(email.rows[0]?.is_nullable).toBe("YES");
    const codeUniques = await client.query<{ conname: string }>("select conname from pg_constraint where contype='u' and conname in ('commercial_access_code_code_hash_unique','business_invite_code_code_hash_unique') order by conname");
    expect(codeUniques.rows.map((row) => row.conname)).toEqual(["business_invite_code_code_hash_unique", "commercial_access_code_code_hash_unique"]);
    const inviteRls = await client.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname='business_invite_code'");
    expect(inviteRls.rows[0]?.relrowsecurity).toBe(true);
    // Migration 0027 (2026-11-17) : Moov Money parmi les moyens déclaratifs ; espèces remises et monnaie rendue sur le paiement.
    const tender = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='public' and table_name='payment' and column_name in ('tendered_xof','change_xof') order by column_name");
    expect(tender.rows.map((row) => row.column_name)).toEqual(["change_xof", "tendered_xof"]);
    const moov = await client.query<{ conname: string }>("select conname from pg_constraint where conname in ('payment_method_check','opening_payment_method_check','expense_payment_method_check') and pg_get_constraintdef(oid) like '%moov_money%' order by conname");
    expect(moov.rows).toHaveLength(3);
  });

  it("does not reapply migrations on a second migrate() call", async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    const applied = await client.query<{ count: string }>(
      'select count(*)::text as count from drizzle."__drizzle_migrations"',
    );
    expect(applied.rows[0]?.count).toBe("28");
  });
});
