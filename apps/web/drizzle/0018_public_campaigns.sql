CREATE TABLE "promotion_eligible_plan" (
	"promotion_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_eligible_plan_pk" PRIMARY KEY("promotion_id","plan_id")
);
--> statement-breakpoint
ALTER TABLE "promotion_code" DROP CONSTRAINT "promotion_kind_check";--> statement-breakpoint
ALTER TABLE "promotion_code" DROP CONSTRAINT "promotion_discount_check";--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "audience" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "public_description" jsonb;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD COLUMN "redeemed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "promotion_eligible_plan" ADD CONSTRAINT "promotion_eligible_plan_promotion_id_promotion_code_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_eligible_plan" ADD CONSTRAINT "promotion_eligible_plan_plan_id_subscription_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD CONSTRAINT "promotion_redemption_redeemed_by_user_id_user_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_redemption_user_once_unique" ON "promotion_redemption" USING btree ("promotion_id","redeemed_by_user_id") WHERE "promotion_redemption"."redeemed_by_user_id" is not null;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_audience_check" CHECK (("promotion_code"."audience" = 'private' and "promotion_code"."kind" in ('discount','access'))
    or ("promotion_code"."audience" = 'public' and "promotion_code"."kind" = 'campaign' and "promotion_code"."campaign" is not null and "promotion_code"."public_description" is not null));--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_kind_check" CHECK ("promotion_code"."kind" in ('discount','access','campaign'));--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_discount_check" CHECK (("promotion_code"."kind" = 'discount' and (("promotion_code"."discount_percent" between 1 and 100 and "promotion_code"."discount_xof" is null) or ("promotion_code"."discount_xof" > 0 and "promotion_code"."discount_percent" is null)))
    or ("promotion_code"."kind" = 'access' and "promotion_code"."discount_percent" is null and "promotion_code"."discount_xof" is null and "promotion_code"."plan_id" is not null and "promotion_code"."grant_days" between 1 and 3650)
    or ("promotion_code"."kind" = 'campaign' and "promotion_code"."plan_id" is null and ("promotion_code"."grant_days" is null or "promotion_code"."grant_days" between 1 and 3650)
      and ("promotion_code"."discount_percent" is null or "promotion_code"."discount_percent" between 1 and 100) and ("promotion_code"."discount_xof" is null or "promotion_code"."discount_xof" > 0)
      and ("promotion_code"."discount_percent" is null or "promotion_code"."discount_xof" is null) and num_nonnulls("promotion_code"."grant_days", "promotion_code"."discount_percent", "promotion_code"."discount_xof") >= 1));