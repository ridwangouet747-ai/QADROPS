CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text DEFAULT 'catalog' NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"sheet_name" text,
	"header_row_number" integer,
	"column_count" integer NOT NULL,
	"row_count" integer NOT NULL,
	"mapping" jsonb NOT NULL,
	"mapping_confirmed_at" timestamp with time zone,
	"summary" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "import_batch_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "import_batch_kind_check" CHECK ("import_batch"."kind" in ('catalog')),
	CONSTRAINT "import_batch_status_check" CHECK ("import_batch"."status" in ('review','applying','applied','discarded')),
	CONSTRAINT "import_batch_file_type_check" CHECK ("import_batch"."file_type" in ('csv','xlsx')),
	CONSTRAINT "import_batch_file_name_length" CHECK (char_length("import_batch"."file_name") between 1 and 200),
	CONSTRAINT "import_batch_sha_check" CHECK ("import_batch"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batch_counts_check" CHECK ("import_batch"."row_count" between 0 and 1000 and "import_batch"."column_count" between 1 and 30 and "import_batch"."file_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"cells" jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"values" jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" text,
	"decision_source" text,
	"match_variant_id" text,
	"status" text NOT NULL,
	"applied_variant_id" text,
	"applied_at" timestamp with time zone,
	"stock_opening_id" text,
	"stock_note" text,
	CONSTRAINT "import_row_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "import_row_batch_number_unique" UNIQUE("business_id","batch_id","row_number"),
	CONSTRAINT "import_row_decision_check" CHECK ("import_row"."decision" is null or "import_row"."decision" in ('create','match','skip')),
	CONSTRAINT "import_row_decision_source_check" CHECK (("import_row"."decision" is null) = ("import_row"."decision_source" is null) and ("import_row"."decision_source" is null or "import_row"."decision_source" in ('auto','user'))),
	CONSTRAINT "import_row_match_check" CHECK (("import_row"."decision" = 'match') = ("import_row"."match_variant_id" is not null)),
	CONSTRAINT "import_row_status_check" CHECK ("import_row"."status" in ('ready','needs_review','invalid','skipped','applied')),
	CONSTRAINT "import_row_applied_check" CHECK (("import_row"."status" = 'applied') = ("import_row"."applied_at" is not null) and ("import_row"."applied_at" is null) = ("import_row"."applied_variant_id" is null))
);
--> statement-breakpoint
CREATE TABLE "product_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_alias_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "product_alias_length_check" CHECK (char_length("product_alias"."alias") between 1 and 160 and char_length("product_alias"."normalized") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_actor_membership_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_tenant_fk" FOREIGN KEY ("business_id","batch_id") REFERENCES "public"."import_batch"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_match_variant_tenant_fk" FOREIGN KEY ("business_id","match_variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_applied_variant_tenant_fk" FOREIGN KEY ("business_id","applied_variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_stock_opening_tenant_fk" FOREIGN KEY ("business_id","stock_opening_id") REFERENCES "public"."stock_opening"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_variant_tenant_fk" FOREIGN KEY ("business_id","variant_id") REFERENCES "public"."product_variant"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_actor_membership_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_same_file_unique" ON "import_batch" USING btree ("business_id","kind","file_sha256") WHERE "import_batch"."status" <> 'discarded';--> statement-breakpoint
CREATE INDEX "import_batch_business_idx" ON "import_batch" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_alias_normalized_unique" ON "product_alias" USING btree ("business_id","normalized");