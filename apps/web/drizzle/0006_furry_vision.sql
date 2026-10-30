CREATE TABLE "promotion_eligible_business" (
	"promotion_id" text NOT NULL,
	"business_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_eligible_business_pk" PRIMARY KEY("promotion_id","business_id")
);
--> statement-breakpoint
ALTER TABLE "business_subscription" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD COLUMN "code_snapshot" text;--> statement-breakpoint
UPDATE "promotion_redemption" AS redemption SET "code_snapshot" = promotion."code" FROM "promotion_code" AS promotion WHERE redemption."promotion_id" = promotion."id";--> statement-breakpoint
ALTER TABLE "promotion_redemption" ALTER COLUMN "code_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD COLUMN "discount_amount_xof" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_eligible_business" ADD CONSTRAINT "promotion_eligible_business_promotion_id_promotion_code_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotion_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_eligible_business" ADD CONSTRAINT "promotion_eligible_business_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_limit_positive" CHECK ("promotion_code"."max_redemptions" is null or "promotion_code"."max_redemptions" > 0);--> statement-breakpoint
ALTER TABLE "promotion_code" ADD CONSTRAINT "promotion_validity_order" CHECK ("promotion_code"."ends_at" is null or "promotion_code"."ends_at" > "promotion_code"."starts_at");--> statement-breakpoint
ALTER TABLE "promotion_redemption" ADD CONSTRAINT "promotion_redemption_discount_nonnegative" CHECK ("promotion_redemption"."discount_amount_xof" >= 0);
