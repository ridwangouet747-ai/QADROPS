ALTER TABLE "business_subscription" DROP CONSTRAINT "subscription_status_check";--> statement-breakpoint
ALTER TABLE "promotion_code" DROP CONSTRAINT "promotion_discount_check";--> statement-breakpoint
ALTER TABLE "business_profile" ADD COLUMN "store_format" text;--> statement-breakpoint
ALTER TABLE "business_profile" ADD COLUMN "creation_key" text;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD COLUMN "status_before_suspension" text;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "kind" text DEFAULT 'discount' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "grant_days" integer;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "revoked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "receipt_settings" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD COLUMN "currency" text DEFAULT 'XOF' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD COLUMN "storage_mb" integer;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_code_plan_id_subscription_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_code_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_code_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_type_date_idx" ON "audit_event" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_creation_key_unique" ON "business_profile" USING btree ("creation_key") WHERE "business_profile"."creation_key" is not null;--> statement-breakpoint
CREATE INDEX "subscription_status_end_idx" ON "business_subscription" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "promotion_batch_idx" ON "promotion_code" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "business_profile" ADD CONSTRAINT "business_store_format_check" CHECK ("business_profile"."store_format" is null or "business_profile"."store_format" in ('shop','kiosk','wholesale','other'));--> statement-breakpoint
ALTER TABLE "business_subscription" ADD CONSTRAINT "subscription_origin_check" CHECK ("business_subscription"."origin" in ('manual','promotion','payment'));--> statement-breakpoint
ALTER TABLE "business_subscription" ADD CONSTRAINT "subscription_resume_status_check" CHECK ("business_subscription"."status_before_suspension" is null or "business_subscription"."status_before_suspension" in ('trialing','active'));--> statement-breakpoint
ALTER TABLE "business_subscription" ADD CONSTRAINT "subscription_status_check" CHECK ("business_subscription"."status" in ('pending','trialing','active','suspended','expired','canceled'));--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_kind_check" CHECK ("promotion_code"."kind" in ('discount','access'));--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_discount_check" CHECK (("promotion_code"."kind" = 'discount' and (("promotion_code"."discount_percent" between 1 and 100 and "promotion_code"."discount_xof" is null) or ("promotion_code"."discount_xof" > 0 and "promotion_code"."discount_percent" is null)))
    or ("promotion_code"."kind" = 'access' and "promotion_code"."discount_percent" is null and "promotion_code"."discount_xof" is null and "promotion_code"."plan_id" is not null and "promotion_code"."grant_days" between 1 and 3650));--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "plan_currency_check" CHECK ("subscription_plan"."currency" = 'XOF');--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "plan_storage_positive" CHECK ("subscription_plan"."storage_mb" is null or "subscription_plan"."storage_mb" > 0);--> statement-breakpoint
-- Journal d'audit en ajout seul : aucune modification ni suppression par les requêtes ordinaires (mission 08).
CREATE OR REPLACE FUNCTION "audit_event_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event est en ajout seul : % refusé', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_event_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"();
