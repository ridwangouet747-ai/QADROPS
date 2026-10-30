CREATE TABLE "inventory_scope_variant" (
	"business_id" text NOT NULL,
	"session_id" text NOT NULL,
	"variant_id" text NOT NULL,
	CONSTRAINT "inventory_scope_variant_pk" PRIMARY KEY("business_id","session_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_session" DROP CONSTRAINT "inventory_status_check";--> statement-breakpoint
ALTER TABLE "inventory_line" ADD COLUMN "counted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "inventory_line" ADD COLUMN "adjustment_reason" text;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD COLUMN "scope_category_id" text;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "inventory_line" AS line SET "counted_by_user_id" = session."started_by_user_id" FROM "inventory_session" AS session WHERE session."business_id" = line."business_id" AND session."id" = line."session_id";--> statement-breakpoint
ALTER TABLE "inventory_line" ALTER COLUMN "counted_by_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "cost_known" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "cost_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_scope_variant" ADD CONSTRAINT "inventory_scope_session_tenant_fk" FOREIGN KEY ("business_id","session_id") REFERENCES "public"."inventory_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scope_variant" ADD CONSTRAINT "inventory_scope_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_line" ADD CONSTRAINT "inventory_line_counter_membership_tenant_fk" FOREIGN KEY ("business_id","counted_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_scope_category_tenant_fk" FOREIGN KEY ("business_id","scope_category_id") REFERENCES "public"."product_category"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_line" ADD CONSTRAINT "inventory_adjustment_reason_nonempty" CHECK ("inventory_line"."adjustment_reason" is null or length(trim("inventory_line"."adjustment_reason")) > 0);--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_status_check" CHECK ("inventory_session"."status" in ('counting','submitted','validated','canceled'));
