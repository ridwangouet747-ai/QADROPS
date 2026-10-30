CREATE TABLE "idempotency_record" (
	"business_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_record_pk" PRIMARY KEY("business_id","idempotency_key"),
	CONSTRAINT "idempotency_key_length_check" CHECK (char_length("idempotency_record"."idempotency_key") between 8 and 128),
	CONSTRAINT "idempotency_operation_check" CHECK ("idempotency_record"."operation" in ('purchase.receive','expense.create','receivable.payment'))
);
--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;