-- 2026-11-16 : codes d'accès commerciaux (plateforme) et codes d'invitation des employés (par commerce).
-- Strictement additive : deux tables, deux contraintes élargies (origine access_code, résultat paused),
-- adresse e-mail facultative (employés connectés par nom d'utilisateur). Aucune donnée modifiée ni supprimée.
CREATE TABLE "business_invite_code" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_hint" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" text,
	CONSTRAINT "business_invite_code_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "invite_code_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "invite_code_role_check" CHECK ("business_invite_code"."role" in ('admin','cashier','stock_manager','accountant','member')),
	CONSTRAINT "invite_code_expiry_check" CHECK ("business_invite_code"."expires_at" > "business_invite_code"."created_at"),
	CONSTRAINT "invite_code_single_end_check" CHECK (num_nonnulls("business_invite_code"."revoked_at", "business_invite_code"."consumed_at") <= 1),
	CONSTRAINT "invite_code_revoked_check" CHECK (("business_invite_code"."revoked_at" is null) = ("business_invite_code"."revoked_by_user_id" is null)),
	CONSTRAINT "invite_code_consumed_check" CHECK (("business_invite_code"."consumed_at" is null) = ("business_invite_code"."consumed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commercial_access_code" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"code_hint" text NOT NULL,
	"plan_id" text NOT NULL,
	"duration_unit" text NOT NULL,
	"duration_value" integer NOT NULL,
	"activation_deadline" timestamp with time zone NOT NULL,
	"payment_verified_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoke_reason" text,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" text,
	"consumed_business_id" text,
	"subscription_id" text,
	CONSTRAINT "commercial_access_code_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "commercial_code_duration_check" CHECK (("commercial_access_code"."duration_unit" = 'day' and "commercial_access_code"."duration_value" between 1 and 365) or ("commercial_access_code"."duration_unit" = 'month' and "commercial_access_code"."duration_value" between 1 and 12)),
	CONSTRAINT "commercial_code_deadline_check" CHECK ("commercial_access_code"."activation_deadline" > "commercial_access_code"."created_at"),
	CONSTRAINT "commercial_code_single_end_check" CHECK (num_nonnulls("commercial_access_code"."revoked_at", "commercial_access_code"."consumed_at") <= 1),
	CONSTRAINT "commercial_code_revoked_check" CHECK (("commercial_access_code"."revoked_at" is null) = ("commercial_access_code"."revoked_by_user_id" is null)),
	CONSTRAINT "commercial_code_consumed_check" CHECK (("commercial_access_code"."consumed_at" is null and "commercial_access_code"."consumed_by_user_id" is null and "commercial_access_code"."consumed_business_id" is null and "commercial_access_code"."subscription_id" is null)
    or ("commercial_access_code"."consumed_at" is not null and "commercial_access_code"."consumed_by_user_id" is not null and "commercial_access_code"."consumed_business_id" is not null and "commercial_access_code"."subscription_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "business_subscription" DROP CONSTRAINT "subscription_origin_check";--> statement-breakpoint
ALTER TABLE "payment_provider_event" DROP CONSTRAINT "provider_event_outcome_check";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "business_invite_code" ADD CONSTRAINT "business_invite_code_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invite_code" ADD CONSTRAINT "business_invite_code_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invite_code" ADD CONSTRAINT "business_invite_code_consumed_by_user_id_user_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invite_code" ADD CONSTRAINT "invite_code_creator_membership_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_access_code" ADD CONSTRAINT "commercial_access_code_plan_id_subscription_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_access_code" ADD CONSTRAINT "commercial_access_code_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_access_code" ADD CONSTRAINT "commercial_access_code_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_access_code" ADD CONSTRAINT "commercial_access_code_consumed_by_user_id_user_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_access_code" ADD CONSTRAINT "commercial_access_code_consumed_business_id_business_profile_business_id_fk" FOREIGN KEY ("consumed_business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_access_code" ADD CONSTRAINT "commercial_code_subscription_tenant_fk" FOREIGN KEY ("consumed_business_id","subscription_id") REFERENCES "public"."business_subscription"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_code_business_created_idx" ON "business_invite_code" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "commercial_code_created_idx" ON "commercial_access_code" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "commercial_code_business_idx" ON "commercial_access_code" USING btree ("consumed_business_id") WHERE "commercial_access_code"."consumed_business_id" is not null;--> statement-breakpoint
ALTER TABLE "business_subscription" ADD CONSTRAINT "subscription_origin_check" CHECK ("business_subscription"."origin" in ('manual','promotion','payment','access_code'));--> statement-breakpoint
ALTER TABLE "payment_provider_event" ADD CONSTRAINT "provider_event_outcome_check" CHECK ("payment_provider_event"."outcome" in ('received','applied','unchanged','ignored','unmatched','amount_mismatch','currency_mismatch','reference_mismatch','environment_mismatch','metadata_mismatch','provider_error','paused'));--> statement-breakpoint
ALTER TABLE "business_invite_code" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS qadr_tenant_isolation ON "business_invite_code";
--> statement-breakpoint
CREATE POLICY qadr_tenant_isolation ON "business_invite_code" AS PERMISSIVE FOR ALL TO qadr_tenant
  USING (business_id = qadr_current_business_id()) WITH CHECK (business_id = qadr_current_business_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "business_invite_code" TO qadr_tenant;
