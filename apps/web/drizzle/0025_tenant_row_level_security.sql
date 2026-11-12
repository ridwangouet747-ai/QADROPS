-- Mission 18 (2026-11-12) : sécurité au niveau des lignes (RLS) pour les 44 tables qui portent business_id.
--
-- Principe (docs/security/production-security-audit.md § 4) :
-- * le rôle qadr_tenant (NOLOGIN, sans BYPASSRLS) ne voit et n'écrit que les lignes du commerce désigné par le
--   paramètre de transaction qadr.business_id ; sans ce paramètre, il ne voit RIEN et ne peut rien écrire ;
-- * il n'a aucun droit sur les tables globales (user, session, account, platform_*, rate_limit_bucket...) ;
-- * il ne fait que LIRE les tables d'abonnement et de facturation de la plateforme (business_subscription,
--   subscription_invoice, subscription_payment, payment_provider_event, promotion_redemption,
--   promotion_eligible_business) ;
-- * le code n'entre dans ce rôle que par SET LOCAL ROLE + set_config(..., true) À L'INTÉRIEUR d'une transaction
--   (src/lib/db/tenant-scope.ts) : à la fin de la transaction, la connexion rendue au pool redevient neutre ;
-- * RLS est activée SANS FORCE : le propriétaire des tables (rôle de connexion de l'application) n'est pas
--   concerné. Les accès qui ne passent pas encore par withTenantScope gardent leur comportement actuel.
--
-- Migration idempotente. Jamais appliquée à la branche principale Neon sans essai préalable sur la préproduction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qadr_tenant') THEN
    CREATE ROLE qadr_tenant NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  -- Le rôle de connexion doit pouvoir faire SET ROLE qadr_tenant (toujours vrai pour un superutilisateur).
  IF NOT pg_has_role(current_user, 'qadr_tenant', 'SET') THEN
    EXECUTE format('GRANT qadr_tenant TO %I WITH SET TRUE', current_user);
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO qadr_tenant;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION qadr_current_business_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('qadr.business_id', true), '') $$;
--> statement-breakpoint
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "audit_event";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "audit_event" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_event" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "business_member_access" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "business_member_access";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "business_member_access" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "business_member_access" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "business_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "business_profile";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "business_profile" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "business_profile" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "business_subscription" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "business_subscription";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "business_subscription" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT ON "business_subscription" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "cash_movement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "cash_movement";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "cash_movement" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_movement" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "cash_session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "cash_session";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "cash_session" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_session" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "customer";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "customer" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "expense" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "expense";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "expense" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "expense" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "idempotency_record" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "idempotency_record";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "idempotency_record" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_record" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "import_batch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "import_batch";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "import_batch" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_batch" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "import_row" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "import_row";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "import_row" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_row" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "inventory_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "inventory_line";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "inventory_line" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_line" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "inventory_scope_variant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "inventory_scope_variant";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "inventory_scope_variant" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_scope_variant" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "inventory_session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "inventory_session";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "inventory_session" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_session" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "notification";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "notification" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "notification_outbox";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "notification_outbox" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_outbox" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "opening_balance" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "opening_balance";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "opening_balance" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "opening_balance" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "opening_balance_payment";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "opening_balance_payment" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "opening_balance_payment" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "payment";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "payment" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "payment_provider_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "payment_provider_event";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "payment_provider_event" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT ON "payment_provider_event" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "payment_refund" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "payment_refund";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "payment_refund" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_refund" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "print_device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "print_device";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "print_device" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "print_device" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "print_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "print_job";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "print_job" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "print_job" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "printer_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "printer_settings";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "printer_settings" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "printer_settings" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "product";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "product" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "product_alias" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "product_alias";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "product_alias" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_alias" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "product_category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "product_category";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "product_category" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_category" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "product_variant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "product_variant";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "product_variant" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_variant" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "promotion_eligible_business" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "promotion_eligible_business";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "promotion_eligible_business" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT ON "promotion_eligible_business" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "promotion_redemption" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "promotion_redemption";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "promotion_redemption" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT ON "promotion_redemption" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "purchase" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "purchase";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "purchase" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "purchase_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "purchase_line";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "purchase_line" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_line" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "purchase_payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "purchase_payment";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "purchase_payment" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_payment" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "receipt_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "receipt_settings";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "receipt_settings" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "receipt_settings" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "receivable_payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "receivable_payment";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "receivable_payment" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "receivable_payment" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "sale" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "sale";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "sale" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sale" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "sale_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "sale_line";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "sale_line" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sale_line" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "stock_movement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "stock_movement";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "stock_movement" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_movement" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "stock_opening" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "stock_opening";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "stock_opening" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_opening" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "stock_opening_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "stock_opening_line";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "stock_opening_line" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_opening_line" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "stored_file" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "stored_file";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "stored_file" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stored_file" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "subscription_invoice" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "subscription_invoice";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "subscription_invoice" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT ON "subscription_invoice" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "subscription_payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "subscription_payment";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "subscription_payment" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT ON "subscription_payment" TO qadr_tenant;
--> statement-breakpoint
ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "supplier";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "supplier" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier" TO qadr_tenant;
