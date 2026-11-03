CREATE TABLE "stored_file" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"object_key" text NOT NULL,
	"file_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"display_name" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_at" timestamp with time zone,
	"retention_until" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	CONSTRAINT "stored_file_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "stored_file_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "stored_file_purpose_check" CHECK ("stored_file"."purpose" in ('import_source','export')),
	CONSTRAINT "stored_file_status_check" CHECK ("stored_file"."status" in ('pending','stored','deleted')),
	CONSTRAINT "stored_file_type_check" CHECK ("stored_file"."file_type" in ('csv','xlsx','pdf','jpeg','png')),
	CONSTRAINT "stored_file_key_check" CHECK ("stored_file"."object_key" ~ '^[a-z_]{1,32}/[0-9a-f]{64}$'),
	CONSTRAINT "stored_file_sha_check" CHECK ("stored_file"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "stored_file_size_check" CHECK ("stored_file"."size_bytes" > 0),
	CONSTRAINT "stored_file_name_length" CHECK (char_length("stored_file"."display_name") between 1 and 200),
	CONSTRAINT "stored_file_stored_check" CHECK (("stored_file"."status" = 'pending') = ("stored_file"."stored_at" is null) or "stored_file"."status" = 'deleted'),
	CONSTRAINT "stored_file_deleted_check" CHECK (("stored_file"."status" = 'deleted') = ("stored_file"."deleted_at" is not null) and ("stored_file"."deleted_at" is null) = ("stored_file"."deletion_reason" is null)),
	CONSTRAINT "stored_file_deletion_reason_check" CHECK ("stored_file"."deletion_reason" is null or "stored_file"."deletion_reason" in ('retention','orphan','import_discarded'))
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "source_file_id" text;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_uploader_membership_fk" FOREIGN KEY ("business_id","uploaded_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_file_retention_idx" ON "stored_file" USING btree ("retention_until") WHERE "stored_file"."status" = 'stored';--> statement-breakpoint
CREATE INDEX "stored_file_pending_idx" ON "stored_file" USING btree ("received_at") WHERE "stored_file"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_source_file_tenant_fk" FOREIGN KEY ("business_id","source_file_id") REFERENCES "public"."stored_file"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_source_file_unique" ON "import_batch" USING btree ("business_id","source_file_id");