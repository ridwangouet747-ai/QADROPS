CREATE TABLE "opening_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"party_type" text NOT NULL,
	"customer_id" text,
	"supplier_id" text,
	"amount_xof" bigint NOT NULL,
	"as_of_date" date NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balance_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "opening_balance_party_check" CHECK (("opening_balance"."party_type" = 'customer' and "opening_balance"."customer_id" is not null and "opening_balance"."supplier_id" is null) or ("opening_balance"."party_type" = 'supplier' and "opening_balance"."supplier_id" is not null and "opening_balance"."customer_id" is null)),
	CONSTRAINT "opening_balance_amount_positive" CHECK ("opening_balance"."amount_xof" > 0),
	CONSTRAINT "opening_balance_note_length" CHECK ("opening_balance"."note" is null or char_length("opening_balance"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "opening_balance_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"opening_balance_id" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"method" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_payment_amount_positive" CHECK ("opening_balance_payment"."amount_xof" > 0),
	CONSTRAINT "opening_payment_method_check" CHECK ("opening_balance_payment"."method" in ('cash','wave','orange_money','mtn_momo','other'))
);
--> statement-breakpoint
CREATE TABLE "stock_opening" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"reference_date" date NOT NULL,
	"note" text,
	"posted_by_user_id" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_opening_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "stock_opening_note_length" CHECK ("stock_opening"."note" is null or char_length("stock_opening"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "stock_opening_line" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"opening_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_cost_xof" bigint,
	CONSTRAINT "stock_opening_line_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "stock_opening_line_variant_unique" UNIQUE("business_id","variant_id"),
	CONSTRAINT "stock_opening_line_qty_positive" CHECK ("stock_opening_line"."quantity" > 0),
	CONSTRAINT "stock_opening_line_cost_nonnegative" CHECK ("stock_opening_line"."unit_cost_xof" is null or "stock_opening_line"."unit_cost_xof" >= 0)
);
--> statement-breakpoint
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_operation_check";--> statement-breakpoint
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_source_one_check";--> statement-breakpoint
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_reason_check";--> statement-breakpoint
ALTER TABLE "stock_movement" ADD COLUMN "opening_line_id" text;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_customer_tenant_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customer"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_supplier_tenant_fk" FOREIGN KEY ("business_id","supplier_id") REFERENCES "public"."supplier"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_actor_membership_tenant_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ADD CONSTRAINT "opening_balance_payment_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ADD CONSTRAINT "opening_payment_balance_tenant_fk" FOREIGN KEY ("business_id","opening_balance_id") REFERENCES "public"."opening_balance"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ADD CONSTRAINT "opening_payment_actor_membership_tenant_fk" FOREIGN KEY ("business_id","recorded_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening" ADD CONSTRAINT "stock_opening_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening" ADD CONSTRAINT "stock_opening_actor_membership_tenant_fk" FOREIGN KEY ("business_id","posted_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_opening_tenant_fk" FOREIGN KEY ("business_id","opening_id") REFERENCES "public"."stock_opening"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opening_balance_customer_unique" ON "opening_balance" USING btree ("business_id","customer_id") WHERE "opening_balance"."customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "opening_balance_supplier_unique" ON "opening_balance" USING btree ("business_id","supplier_id") WHERE "opening_balance"."supplier_id" is not null;--> statement-breakpoint
CREATE INDEX "opening_payment_balance_idx" ON "opening_balance_payment" USING btree ("business_id","opening_balance_id");--> statement-breakpoint
CREATE INDEX "stock_opening_business_date_idx" ON "stock_opening" USING btree ("business_id","posted_at");--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_opening_line_tenant_fk" FOREIGN KEY ("business_id","opening_line_id") REFERENCES "public"."stock_opening_line"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movement_opening_line_unique" ON "stock_movement" USING btree ("business_id","opening_line_id") WHERE "stock_movement"."opening_line_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movement_business_date_idx" ON "stock_movement" USING btree ("business_id","occurred_at","id");--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_operation_check" CHECK ("idempotency_record"."operation" in ('purchase.receive','expense.create','receivable.payment','stock.opening','opening_balance.create','opening_balance.payment'));--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_opening_reason_check" CHECK (("stock_movement"."opening_line_id" is null) = ("stock_movement"."reason" <> 'opening_stock'));--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_source_one_check" CHECK (num_nonnulls("stock_movement"."sale_line_id", "stock_movement"."purchase_line_id", "stock_movement"."inventory_line_id", "stock_movement"."opening_line_id") = 1);--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_reason_check" CHECK ("stock_movement"."reason" in ('sale','purchase','inventory_adjustment','manual_adjustment','return','opening_stock'));