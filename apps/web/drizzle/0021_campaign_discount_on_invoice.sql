ALTER TABLE "subscription_invoice" ADD COLUMN "discount_xof" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD COLUMN "promotion_redemption_id" text;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD CONSTRAINT "promotion_redemption_business_id_unique" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_redemption_tenant_fk" FOREIGN KEY ("business_id","promotion_redemption_id") REFERENCES "public"."promotion_redemption"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoice_redemption_once_unique" ON "subscription_invoice" USING btree ("promotion_redemption_id") WHERE "subscription_invoice"."promotion_redemption_id" is not null and "subscription_invoice"."status" in ('open','paid');--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_discount_check" CHECK ("subscription_invoice"."discount_xof" >= 0 and ("subscription_invoice"."promotion_redemption_id" is null) = ("subscription_invoice"."discount_xof" = 0));
