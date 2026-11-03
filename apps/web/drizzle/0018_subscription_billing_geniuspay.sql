CREATE TABLE "subscription_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"plan_name" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"currency" text DEFAULT 'XOF' NOT NULL,
	"duration_days" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subscription_id" text,
	"period_starts_at" timestamp with time zone,
	"period_ends_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	CONSTRAINT "subscription_invoice_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "subscription_invoice_status_check" CHECK ("subscription_invoice"."status" in ('open','paid','void')),
	CONSTRAINT "subscription_invoice_amount_positive" CHECK ("subscription_invoice"."amount_xof" > 0 and "subscription_invoice"."duration_days" > 0),
	CONSTRAINT "subscription_invoice_currency_check" CHECK ("subscription_invoice"."currency" = 'XOF'),
	CONSTRAINT "subscription_invoice_paid_check" CHECK ("subscription_invoice"."status" <> 'paid' or ("subscription_invoice"."paid_at" is not null and "subscription_invoice"."subscription_id" is not null and "subscription_invoice"."period_starts_at" is not null and "subscription_invoice"."period_ends_at" > "subscription_invoice"."period_starts_at"))
);
--> statement-breakpoint
ALTER TABLE "subscription_payment" DROP CONSTRAINT "subscription_payment_method_check";--> statement-breakpoint
ALTER TABLE "subscription_payment" DROP CONSTRAINT "subscription_payment_status_check";--> statement-breakpoint
ALTER TABLE "payment_provider_event" ALTER COLUMN "business_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payment" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD COLUMN "provider_reference" text;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD COLUMN "outcome" text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "checkout_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD COLUMN "initiated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_plan_id_subscription_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_subscription_tenant_fk" FOREIGN KEY ("business_id","subscription_id") REFERENCES "public"."business_subscription"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoice_one_open_unique" ON "subscription_invoice" USING btree ("business_id") WHERE "subscription_invoice"."status" = 'open';--> statement-breakpoint
CREATE INDEX "subscription_invoice_business_date_idx" ON "subscription_invoice" USING btree ("business_id","created_at");--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_initiated_by_user_id_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_invoice_tenant_fk" FOREIGN KEY ("business_id","invoice_id") REFERENCES "public"."subscription_invoice"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_provider_event_unique" ON "payment_provider_event" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "provider_event_reference_idx" ON "payment_provider_event" USING btree ("provider","provider_reference") WHERE "payment_provider_event"."provider_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_provider_global_reference_unique" ON "subscription_payment" USING btree ("provider","provider_reference") WHERE "subscription_payment"."provider" is not null and "subscription_payment"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "subscription_payment_provider_pending_idx" ON "subscription_payment" USING btree ("provider","status","occurred_at") WHERE "subscription_payment"."provider" is not null;--> statement-breakpoint
CREATE INDEX "subscription_payment_invoice_idx" ON "subscription_payment" USING btree ("business_id","invoice_id") WHERE "subscription_payment"."invoice_id" is not null;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_unattached_check" CHECK ("payment_provider_event"."business_id" is not null or ("payment_provider_event"."payment_id" is null and "payment_provider_event"."subscription_payment_id" is null));--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_outcome_check" CHECK ("payment_provider_event"."outcome" in ('received','applied','unchanged','ignored','unmatched','amount_mismatch','currency_mismatch','reference_mismatch','environment_mismatch','metadata_mismatch','provider_error'));--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_target_check" CHECK ("subscription_payment"."subscription_id" is not null or "subscription_payment"."invoice_id" is not null);--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_provider_check" CHECK ("subscription_payment"."provider" is null or ("subscription_payment"."provider" = 'geniuspay' and "subscription_payment"."invoice_id" is not null));--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_environment_check" CHECK ("subscription_payment"."environment" is null or "subscription_payment"."environment" in ('sandbox','live'));--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_method_check" CHECK ("subscription_payment"."method" in ('wave','orange_money','mtn_momo','moov_money','card','other','unknown'));--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_status_check" CHECK ("subscription_payment"."status" in ('pending','confirmed','failed','refunded','canceled','expired'));