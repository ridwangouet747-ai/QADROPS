CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profile" (
	"business_id" text PRIMARY KEY NOT NULL,
	"activity" text NOT NULL,
	"phone" text,
	"address" text,
	"business_email" text,
	"currency" text DEFAULT 'XOF' NOT NULL,
	"timezone" text DEFAULT 'Africa/Abidjan' NOT NULL,
	"primary_color" text DEFAULT '#176B5B' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_activity_check" CHECK ("business_profile"."activity" in ('hardware','phones','general','clothing')),
	CONSTRAINT "business_currency_check" CHECK ("business_profile"."currency" = 'XOF'),
	CONSTRAINT "business_status_check" CHECK ("business_profile"."status" in ('pending','active','suspended','expired'))
);
--> statement-breakpoint
CREATE TABLE "business_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "subscription_status_check" CHECK ("business_subscription"."status" in ('pending','active','suspended','expired','canceled'))
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_business_id_unique" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"paid_by_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "expense_positive" CHECK ("expense"."amount_xof" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_line" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"session_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"theoretical_qty" numeric(24, 6) NOT NULL,
	"counted_qty" numeric(24, 6) NOT NULL,
	"expected_stock_revision" bigint NOT NULL,
	CONSTRAINT "inventory_line_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "inventory_session_variant_unique" UNIQUE("business_id","session_id","variant_id"),
	CONSTRAINT "inventory_quantities_nonnegative" CHECK ("inventory_line"."theoretical_qty" >= 0 and "inventory_line"."counted_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_session" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"status" text DEFAULT 'counting' NOT NULL,
	"started_by_user_id" text NOT NULL,
	"validated_by_user_id" text,
	"counted_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "inventory_status_check" CHECK ("inventory_session"."status" in ('counting','validated','canceled'))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_status_check" CHECK ("invitation"."status" in ('pending','accepted','rejected','canceled'))
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_org_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"method" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"provider_reference" text,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"provider_payload_hash" text,
	CONSTRAINT "payment_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "payment_business_idempotency_unique" UNIQUE("business_id","idempotency_key"),
	CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount_xof" > 0),
	CONSTRAINT "payment_method_check" CHECK ("payment"."method" in ('cash','wave','orange_money','mtn_momo','other')),
	CONSTRAINT "payment_status_check" CHECK ("payment"."status" in ('pending','confirmed','failed','refunded','partially_refunded'))
);
--> statement-breakpoint
CREATE TABLE "payment_provider_event" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_id" text,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "provider_event_idempotency_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payment_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"reference" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "refund_business_reference_unique" UNIQUE("business_id","reference"),
	CONSTRAINT "refund_amount_positive" CHECK ("payment_refund"."amount_xof" > 0),
	CONSTRAINT "refund_status_check" CHECK ("payment_refund"."status" in ('pending','confirmed','failed'))
);
--> statement-breakpoint
CREATE TABLE "platform_admin" (
	"user_id" text PRIMARY KEY NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"category_id" text,
	"name" text NOT NULL,
	"description" text,
	"base_unit" text DEFAULT 'piece' NOT NULL,
	"track_serial" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_business_id_unique" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_category" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "category_business_name_unique" UNIQUE("business_id","name")
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"label" text DEFAULT 'Standard' NOT NULL,
	"sku" text,
	"barcode" text,
	"color" text,
	"size" text,
	"sale_price_xof" bigint NOT NULL,
	"on_hand" numeric(24, 6) DEFAULT '0' NOT NULL,
	"average_cost_xof" numeric(30, 12) DEFAULT '0' NOT NULL,
	"stock_revision" bigint DEFAULT 0 NOT NULL,
	"low_stock_threshold" numeric(24, 6) DEFAULT '0' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "variant_price_nonnegative" CHECK ("product_variant"."sale_price_xof" >= 0),
	CONSTRAINT "variant_on_hand_nonnegative" CHECK ("product_variant"."on_hand" >= 0),
	CONSTRAINT "variant_cost_nonnegative" CHECK ("product_variant"."average_cost_xof" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotion_code" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"discount_percent" integer,
	"discount_xof" bigint,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "promotion_code_code_unique" UNIQUE("code"),
	CONSTRAINT "promotion_discount_check" CHECK (("promotion_code"."discount_percent" between 1 and 100 and "promotion_code"."discount_xof" is null) or ("promotion_code"."discount_xof" > 0 and "promotion_code"."discount_percent" is null))
);
--> statement-breakpoint
CREATE TABLE "promotion_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"promotion_id" text NOT NULL,
	"business_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_business_once_unique" UNIQUE("promotion_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"total_xof" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "purchase_business_reference_unique" UNIQUE("business_id","reference"),
	CONSTRAINT "purchase_total_nonnegative" CHECK ("purchase"."total_xof" >= 0),
	CONSTRAINT "purchase_status_check" CHECK ("purchase"."status" in ('draft','received','canceled'))
);
--> statement-breakpoint
CREATE TABLE "purchase_line" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"purchase_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_cost_xof" bigint NOT NULL,
	"line_total_xof" bigint NOT NULL,
	CONSTRAINT "purchase_line_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "purchase_line_qty_positive" CHECK ("purchase_line"."quantity" > 0),
	CONSTRAINT "purchase_line_amount_nonnegative" CHECK ("purchase_line"."unit_cost_xof" >= 0 and "purchase_line"."line_total_xof" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"purchase_id" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"method" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_payment_positive" CHECK ("purchase_payment"."amount_xof" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"paper_width_mm" integer DEFAULT 58 NOT NULL,
	"show_logo" boolean DEFAULT true NOT NULL,
	"footer" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_width_check" CHECK ("receipt_settings"."paper_width_mm" in (58,80))
);
--> statement-breakpoint
CREATE TABLE "receivable_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"applied_amount_xof" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivable_payment_sale_unique" UNIQUE("business_id","payment_id","sale_id"),
	CONSTRAINT "receivable_applied_positive" CHECK ("receivable_payment"."applied_amount_xof" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"cashier_user_id" text NOT NULL,
	"customer_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"subtotal_xof" bigint NOT NULL,
	"discount_xof" bigint DEFAULT 0 NOT NULL,
	"total_xof" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "sale_business_reference_unique" UNIQUE("business_id","reference"),
	CONSTRAINT "sale_business_idempotency_unique" UNIQUE("business_id","idempotency_key"),
	CONSTRAINT "sale_amounts_check" CHECK ("sale"."subtotal_xof" >= 0 and "sale"."discount_xof" >= 0 and "sale"."total_xof" = "sale"."subtotal_xof" - "sale"."discount_xof"),
	CONSTRAINT "sale_status_check" CHECK ("sale"."status" in ('completed','partially_refunded','refunded','voided'))
);
--> statement-breakpoint
CREATE TABLE "sale_line" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"variant_snapshot" text DEFAULT 'Standard' NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_price_xof" bigint NOT NULL,
	"line_discount_xof" bigint DEFAULT 0 NOT NULL,
	"line_total_xof" bigint NOT NULL,
	"unit_cost_snapshot_xof" numeric(30, 12) NOT NULL,
	"cogs_xof" bigint NOT NULL,
	CONSTRAINT "sale_line_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "sale_line_qty_positive" CHECK ("sale_line"."quantity" > 0),
	CONSTRAINT "sale_line_amounts_nonnegative" CHECK ("sale_line"."unit_price_xof" >= 0 and "sale_line"."line_discount_xof" >= 0 and "sale_line"."line_total_xof" >= 0 and "sale_line"."cogs_xof" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"quantity_delta" numeric(24, 6) NOT NULL,
	"reason" text NOT NULL,
	"sale_line_id" text,
	"purchase_line_id" text,
	"inventory_line_id" text,
	"unit_cost_xof" numeric(30, 12),
	"created_by_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_source_one_check" CHECK (num_nonnulls("stock_movement"."sale_line_id", "stock_movement"."purchase_line_id", "stock_movement"."inventory_line_id") = 1),
	CONSTRAINT "stock_movement_delta_nonzero" CHECK ("stock_movement"."quantity_delta" <> 0),
	CONSTRAINT "stock_movement_reason_check" CHECK ("stock_movement"."reason" in ('sale','purchase','inventory_adjustment','manual_adjustment','return'))
);
--> statement-breakpoint
CREATE TABLE "subscription_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price_xof" bigint NOT NULL,
	"duration_days" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "subscription_plan_code_unique" UNIQUE("code"),
	CONSTRAINT "plan_amount_duration_check" CHECK ("subscription_plan"."price_xof" >= 0 and "subscription_plan"."duration_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "supplier_business_id_unique" UNIQUE("business_id","id")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile" ADD CONSTRAINT "business_profile_business_id_organization_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD CONSTRAINT "business_subscription_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD CONSTRAINT "business_subscription_plan_id_subscription_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_paid_by_user_id_user_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_line" ADD CONSTRAINT "inventory_line_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_line" ADD CONSTRAINT "inventory_line_session_tenant_fk" FOREIGN KEY ("business_id","session_id") REFERENCES "public"."inventory_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_line" ADD CONSTRAINT "inventory_line_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_session_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_session_started_by_user_id_user_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_session_validated_by_user_id_user_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_started_membership_tenant_fk" FOREIGN KEY ("business_id","started_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_validator_membership_tenant_fk" FOREIGN KEY ("business_id","validated_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_sale_tenant_fk" FOREIGN KEY ("business_id","sale_id") REFERENCES "public"."sale"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "payment_provider_event_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "refund_payment_tenant_fk" FOREIGN KEY ("business_id","payment_id") REFERENCES "public"."payment"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "refund_actor_membership_tenant_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin" ADD CONSTRAINT "platform_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin" ADD CONSTRAINT "platform_admin_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_product_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_tenant_fk" FOREIGN KEY ("business_id","category_id") REFERENCES "public"."product_category"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "variant_product_tenant_fk" FOREIGN KEY ("business_id","product_id") REFERENCES "public"."product"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD CONSTRAINT "promotion_redemption_promotion_id_promotion_code_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD CONSTRAINT "promotion_redemption_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD CONSTRAINT "promotion_subscription_tenant_fk" FOREIGN KEY ("business_id","subscription_id") REFERENCES "public"."business_subscription"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_supplier_tenant_fk" FOREIGN KEY ("business_id","supplier_id") REFERENCES "public"."supplier"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_purchase_tenant_fk" FOREIGN KEY ("business_id","purchase_id") REFERENCES "public"."purchase"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payment" ADD CONSTRAINT "purchase_payment_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payment" ADD CONSTRAINT "purchase_payment_tenant_fk" FOREIGN KEY ("business_id","purchase_id") REFERENCES "public"."purchase"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_settings" ADD CONSTRAINT "receipt_settings_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payment" ADD CONSTRAINT "receivable_payment_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payment" ADD CONSTRAINT "receivable_sale_tenant_fk" FOREIGN KEY ("business_id","sale_id") REFERENCES "public"."sale"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payment" ADD CONSTRAINT "receivable_payment_tenant_fk" FOREIGN KEY ("business_id","payment_id") REFERENCES "public"."payment"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_cashier_user_id_user_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_tenant_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customer"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_cashier_membership_tenant_fk" FOREIGN KEY ("business_id","cashier_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_sale_tenant_fk" FOREIGN KEY ("business_id","sale_id") REFERENCES "public"."sale"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sale_line_tenant_fk" FOREIGN KEY ("business_id","sale_line_id") REFERENCES "public"."sale_line"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_purchase_line_tenant_fk" FOREIGN KEY ("business_id","purchase_line_id") REFERENCES "public"."purchase_line"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_inventory_line_tenant_fk" FOREIGN KEY ("business_id","inventory_line_id") REFERENCES "public"."inventory_line"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_actor_membership_tenant_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_business_date_idx" ON "audit_event" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "subscription_business_status_idx" ON "business_subscription" USING btree ("business_id","status","ends_at");--> statement-breakpoint
CREATE INDEX "customer_business_phone_idx" ON "customer" USING btree ("business_id","phone");--> statement-breakpoint
CREATE INDEX "expense_business_date_idx" ON "expense" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_business_status_idx" ON "inventory_session" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "invitation_org_status_idx" ON "invitation" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_reference_unique" ON "payment" USING btree ("business_id","provider_reference") WHERE "payment"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "payment_sale_status_idx" ON "payment" USING btree ("business_id","sale_id","status");--> statement-breakpoint
CREATE INDEX "provider_event_business_received_idx" ON "payment_provider_event" USING btree ("business_id","received_at");--> statement-breakpoint
CREATE INDEX "refund_payment_date_idx" ON "payment_refund" USING btree ("business_id","payment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "product_business_name_idx" ON "product" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "product" USING btree ("business_id","category_id");--> statement-breakpoint
CREATE INDEX "category_business_idx" ON "product_category" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_business_sku_unique" ON "product_variant" USING btree ("business_id","sku") WHERE "product_variant"."sku" is not null;--> statement-breakpoint
CREATE INDEX "variant_business_product_idx" ON "product_variant" USING btree ("business_id","product_id");--> statement-breakpoint
CREATE INDEX "purchase_business_date_idx" ON "purchase" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_business_occurred_idx" ON "sale" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_line_sale_idx" ON "sale_line" USING btree ("business_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movement_sale_line_unique" ON "stock_movement" USING btree ("business_id","sale_line_id") WHERE "stock_movement"."sale_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movement_purchase_line_unique" ON "stock_movement" USING btree ("business_id","purchase_line_id") WHERE "stock_movement"."purchase_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movement_inventory_line_unique" ON "stock_movement" USING btree ("business_id","inventory_line_id") WHERE "stock_movement"."inventory_line_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movement_variant_date_idx" ON "stock_movement" USING btree ("business_id","variant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "supplier_business_name_idx" ON "supplier" USING btree ("business_id","name");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;