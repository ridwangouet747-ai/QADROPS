CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_id" text,
	"outbox_id" text NOT NULL,
	"template_key" text NOT NULL,
	"category" text NOT NULL,
	"icon" text DEFAULT 'bell' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_outbox_user_unique" UNIQUE("outbox_id","user_id"),
	CONSTRAINT "notification_link_check" CHECK ("notification"."link_path" is null or "notification"."link_path" ~ '^/[A-Za-z0-9/_-]*$')
);
--> statement-breakpoint
CREATE TABLE "notification_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notification_campaign_status_check" CHECK ("notification_campaign"."status" in ('running','paused','done','canceled'))
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"subscription_id" text,
	"status" text NOT NULL,
	"http_status" integer,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_status_check" CHECK ("notification_delivery"."status" in ('sent','failed','retry','expired','skipped_preference','skipped_quiet','skipped_rate','skipped_unconfigured'))
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedup_key" text NOT NULL,
	"campaign_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "notification_outbox_dedup_key_unique" UNIQUE("dedup_key"),
	CONSTRAINT "notification_outbox_status_check" CHECK ("notification_outbox"."status" in ('pending','done','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_start_minute" integer,
	"quiet_end_minute" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_locale_check" CHECK ("notification_preference"."locale" in ('fr','en','ar')),
	CONSTRAINT "notification_preference_quiet_check" CHECK (("notification_preference"."quiet_start_minute" is null) = ("notification_preference"."quiet_end_minute" is null) and coalesce("notification_preference"."quiet_start_minute", 0) between 0 and 1439 and coalesce("notification_preference"."quiet_end_minute", 0) between 0 and 1439)
);
--> statement-breakpoint
CREATE TABLE "notification_template" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"category" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"icon" text DEFAULT 'bell' NOT NULL,
	"link_path" text,
	"title_fr" text NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"body_fr" text NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_template_key_unique" UNIQUE("key"),
	CONSTRAINT "notification_template_kind_check" CHECK ("notification_template"."kind" in ('event','announcement')),
	CONSTRAINT "notification_template_category_check" CHECK ("notification_template"."category" in ('commercial','security','subscription','system','announcement')),
	CONSTRAINT "notification_template_text_length" CHECK (char_length("notification_template"."title_fr") between 1 and 120 and char_length("notification_template"."title_en") between 1 and 120 and char_length("notification_template"."title_ar") between 1 and 120
    and char_length("notification_template"."body_fr") between 1 and 500 and char_length("notification_template"."body_en") between 1 and 500 and char_length("notification_template"."body_ar") between 1 and 500),
	CONSTRAINT "notification_template_link_check" CHECK ("notification_template"."link_path" is null or "notification_template"."link_path" ~ '^/[A-Za-z0-9/_-]*$')
);
--> statement-breakpoint
CREATE TABLE "print_device" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"transport" text NOT NULL,
	"profile" text DEFAULT 'generic' NOT NULL,
	"paper_width_mm" integer DEFAULT 80 NOT NULL,
	"agent_id" text,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" text,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "print_device_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "print_device_transport_check" CHECK ("print_device"."transport" in ('tcp','windows_share','device','simulated')),
	CONSTRAINT "print_device_width_check" CHECK ("print_device"."paper_width_mm" in (58,80)),
	CONSTRAINT "print_device_name_length" CHECK (char_length(trim("print_device"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "print_job" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"device_id" text NOT NULL,
	"sale_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reprint_of_job_id" text,
	"error_code" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_job_kind_check" CHECK ("print_job"."kind" in ('receipt','test')),
	CONSTRAINT "print_job_status_check" CHECK ("print_job"."status" in ('pending','printed','failed','uncertain','canceled')),
	CONSTRAINT "print_job_receipt_sale_check" CHECK (("print_job"."kind" = 'receipt') = ("print_job"."sale_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "printer_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_print" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscription_endpoint_https" CHECK ("push_subscription"."endpoint" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_campaign" ADD CONSTRAINT "notification_campaign_template_id_notification_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_campaign" ADD CONSTRAINT "notification_campaign_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscription"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_campaign_id_notification_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."notification_campaign"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_device" ADD CONSTRAINT "print_device_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_device" ADD CONSTRAINT "print_device_creator_membership_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_device_tenant_fk" FOREIGN KEY ("business_id","device_id") REFERENCES "public"."print_device"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_sale_tenant_fk" FOREIGN KEY ("business_id","sale_id") REFERENCES "public"."sale"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_creator_membership_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_settings" ADD CONSTRAINT "printer_settings_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_settings" ADD CONSTRAINT "printer_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","business_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_notification_idx" ON "notification_delivery" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_retry_idx" ON "notification_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_business_idx" ON "notification_outbox" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "print_job_one_original_receipt" ON "print_job" USING btree ("business_id","sale_id","device_id") WHERE "print_job"."kind" = 'receipt' and "print_job"."reprint_of_job_id" is null;--> statement-breakpoint
CREATE INDEX "print_job_business_idx" ON "print_job" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscription" USING btree ("user_id");