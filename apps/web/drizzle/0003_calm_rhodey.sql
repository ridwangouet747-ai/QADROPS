CREATE TABLE "subscription_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_reference" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "subscription_payment_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "subscription_payment_business_key_unique" UNIQUE("business_id","idempotency_key"),
	CONSTRAINT "subscription_payment_amount_positive" CHECK ("subscription_payment"."amount_xof" > 0),
	CONSTRAINT "subscription_payment_method_check" CHECK ("subscription_payment"."method" in ('wave','orange_money','mtn_momo','other')),
	CONSTRAINT "subscription_payment_status_check" CHECK ("subscription_payment"."status" in ('pending','confirmed','failed','refunded'))
);
--> statement-breakpoint
ALTER TABLE "payment_provider_event" DROP CONSTRAINT "provider_event_idempotency_unique";--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD COLUMN "subscription_payment_id" text;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_tenant_fk" FOREIGN KEY ("business_id","subscription_id") REFERENCES "public"."business_subscription"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_provider_reference_unique" ON "subscription_payment" USING btree ("business_id","provider_reference") WHERE "subscription_payment"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "subscription_payment_status_date_idx" ON "subscription_payment" USING btree ("business_id","status","occurred_at");--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_store_payment_tenant_fk" FOREIGN KEY ("business_id","payment_id") REFERENCES "public"."payment"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_subscription_payment_tenant_fk" FOREIGN KEY ("business_id","subscription_payment_id") REFERENCES "public"."subscription_payment"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_idempotency_unique" UNIQUE("business_id","provider","event_id");--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_single_target_check" CHECK (num_nonnulls("payment_provider_event"."payment_id", "payment_provider_event"."subscription_payment_id") <= 1);
