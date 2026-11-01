CREATE TABLE "cash_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"session_id" text NOT NULL,
	"direction" text NOT NULL,
	"amount_xof" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movement_direction_check" CHECK ("cash_movement"."direction" in ('in','out')),
	CONSTRAINT "cash_movement_amount_positive" CHECK ("cash_movement"."amount_xof" > 0),
	CONSTRAINT "cash_movement_reason_length" CHECK (char_length(trim("cash_movement"."reason")) between 1 and 240)
);
--> statement-breakpoint
CREATE TABLE "cash_session" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_float_xof" bigint NOT NULL,
	"opening_note" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"counted_cash_xof" bigint,
	"expected_cash_xof" bigint,
	"difference_xof" bigint,
	"closing_note" text,
	"closing_snapshot" jsonb,
	"validated_at" timestamp with time zone,
	"validated_by_user_id" text,
	"validation_note" text,
	CONSTRAINT "cash_session_business_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "cash_session_status_check" CHECK ("cash_session"."status" in ('open','closed','validated')),
	CONSTRAINT "cash_session_amounts_check" CHECK ("cash_session"."opening_float_xof" >= 0 and ("cash_session"."counted_cash_xof" is null or "cash_session"."counted_cash_xof" >= 0)),
	CONSTRAINT "cash_session_closing_check" CHECK (("cash_session"."status" = 'open' and "cash_session"."closed_at" is null and "cash_session"."counted_cash_xof" is null and "cash_session"."expected_cash_xof" is null and "cash_session"."difference_xof" is null)
    or ("cash_session"."status" in ('closed','validated') and "cash_session"."closed_at" is not null and "cash_session"."closed_by_user_id" is not null and "cash_session"."counted_cash_xof" is not null and "cash_session"."expected_cash_xof" is not null and "cash_session"."difference_xof" = "cash_session"."counted_cash_xof" - "cash_session"."expected_cash_xof")),
	CONSTRAINT "cash_session_difference_justified" CHECK ("cash_session"."difference_xof" is null or "cash_session"."difference_xof" = 0 or length(trim(coalesce("cash_session"."closing_note", ''))) > 0),
	CONSTRAINT "cash_session_validation_check" CHECK (("cash_session"."status" = 'validated') = ("cash_session"."validated_at" is not null and "cash_session"."validated_by_user_id" is not null)),
	CONSTRAINT "cash_session_notes_length" CHECK (char_length(coalesce("cash_session"."opening_note", '')) <= 500 and char_length(coalesce("cash_session"."closing_note", '')) <= 500 and char_length(coalesce("cash_session"."validation_note", '')) <= 500)
);
--> statement-breakpoint
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_operation_check";--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "cash_session_id" text;--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ADD COLUMN "cash_session_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "cash_session_id" text;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD COLUMN "cash_session_id" text;--> statement-breakpoint
ALTER TABLE "purchase_payment" ADD COLUMN "cash_session_id" text;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_session_tenant_fk" FOREIGN KEY ("business_id","session_id") REFERENCES "public"."cash_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_actor_membership_fk" FOREIGN KEY ("business_id","created_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_business_id_business_profile_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business_profile"("business_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_owner_membership_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_closer_membership_fk" FOREIGN KEY ("business_id","closed_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_validator_membership_fk" FOREIGN KEY ("business_id","validated_by_user_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movement_session_idx" ON "cash_movement" USING btree ("business_id","session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_session_one_open_per_member" ON "cash_session" USING btree ("business_id","user_id") WHERE "cash_session"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cash_session_business_opened_idx" ON "cash_session" USING btree ("business_id","opened_at");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_cash_session_tenant_fk" FOREIGN KEY ("business_id","cash_session_id") REFERENCES "public"."cash_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ADD CONSTRAINT "opening_payment_cash_session_tenant_fk" FOREIGN KEY ("business_id","cash_session_id") REFERENCES "public"."cash_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cash_session_tenant_fk" FOREIGN KEY ("business_id","cash_session_id") REFERENCES "public"."cash_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "refund_cash_session_tenant_fk" FOREIGN KEY ("business_id","cash_session_id") REFERENCES "public"."cash_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payment" ADD CONSTRAINT "purchase_payment_cash_session_tenant_fk" FOREIGN KEY ("business_id","cash_session_id") REFERENCES "public"."cash_session"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_payment_business_date_idx" ON "opening_balance_payment" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_cash_session_idx" ON "payment" USING btree ("business_id","cash_session_id") WHERE "payment"."cash_session_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_business_confirmed_idx" ON "payment" USING btree ("business_id","confirmed_at");--> statement-breakpoint
CREATE INDEX "purchase_payment_business_date_idx" ON "purchase_payment" USING btree ("business_id","occurred_at");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_payment_method_check" CHECK ("expense"."payment_method" is null or "expense"."payment_method" in ('cash','wave','orange_money','mtn_momo','other'));--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_operation_check" CHECK ("idempotency_record"."operation" in ('purchase.receive','expense.create','receivable.payment','stock.opening','opening_balance.create','opening_balance.payment','cash_session.open','cash_session.movement','cash_session.close','cash_session.validate'));--> statement-breakpoint
-- Clôture de caisse irréversible (mission 09) : une session clôturée ne change plus, sauf pour passer à « validée »
-- (champs de validation seulement) ; une session validée ne change plus du tout ; aucune session n'est supprimée.
CREATE OR REPLACE FUNCTION "cash_session_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_session : suppression refusée' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.business_id, NEW.user_id, NEW.opening_float_xof, NEW.opening_note, NEW.opened_at)
     IS DISTINCT FROM (OLD.id, OLD.business_id, OLD.user_id, OLD.opening_float_xof, OLD.opening_note, OLD.opened_at) THEN
    RAISE EXCEPTION 'cash_session : l''ouverture ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'validated' THEN
    RAISE EXCEPTION 'cash_session : session validée, modification refusée' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'closed' AND (NEW.status <> 'validated'
     OR (NEW.closed_at, NEW.closed_by_user_id, NEW.counted_cash_xof, NEW.expected_cash_xof, NEW.difference_xof, NEW.closing_note, NEW.closing_snapshot)
        IS DISTINCT FROM (OLD.closed_at, OLD.closed_by_user_id, OLD.counted_cash_xof, OLD.expected_cash_xof, OLD.difference_xof, OLD.closing_note, OLD.closing_snapshot)) THEN
    RAISE EXCEPTION 'cash_session : session clôturée, modification refusée' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "cash_session_immutable_after_close" BEFORE UPDATE OR DELETE ON "cash_session" FOR EACH ROW EXECUTE FUNCTION "cash_session_guard"();--> statement-breakpoint
-- Mouvements de caisse en ajout seul, et seulement dans une session ouverte.
CREATE OR REPLACE FUNCTION "cash_movement_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cash_movement est en ajout seul : % refusé', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "cash_session" s WHERE s.business_id = NEW.business_id AND s.id = NEW.session_id AND s.status = 'open') THEN
    RAISE EXCEPTION 'cash_movement : la session de caisse n''est pas ouverte' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "cash_movement_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "cash_movement" FOR EACH ROW EXECUTE FUNCTION "cash_movement_guard"();
