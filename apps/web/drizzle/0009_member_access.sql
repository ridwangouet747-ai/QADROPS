CREATE TABLE "business_member_access" (
	"business_id" text NOT NULL,
	"user_id" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_member_access_pk" PRIMARY KEY("business_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "business_member_access" ADD CONSTRAINT "business_member_access_disabled_by_user_id_user_id_fk" FOREIGN KEY ("disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_member_access" ADD CONSTRAINT "business_member_access_member_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;