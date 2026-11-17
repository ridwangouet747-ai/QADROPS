ALTER TABLE "expense" DROP CONSTRAINT "expense_payment_method_check";--> statement-breakpoint
ALTER TABLE "opening_balance_payment" DROP CONSTRAINT "opening_payment_method_check";--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_method_check";--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "tendered_xof" bigint;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "change_xof" bigint;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_payment_method_check" CHECK ("expense"."payment_method" is null or "expense"."payment_method" in ('cash','wave','orange_money','mtn_momo','moov_money','other'));--> statement-breakpoint
ALTER TABLE "opening_balance_payment" ADD CONSTRAINT "opening_payment_method_check" CHECK ("opening_balance_payment"."method" in ('cash','wave','orange_money','mtn_momo','moov_money','other'));--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cash_tender_check" CHECK (("payment"."tendered_xof" is null and "payment"."change_xof" is null) or ("payment"."method" = 'cash' and "payment"."tendered_xof" >= "payment"."amount_xof" and "payment"."change_xof" = "payment"."tendered_xof" - "payment"."amount_xof"));--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_method_check" CHECK ("payment"."method" in ('cash','wave','orange_money','mtn_momo','moov_money','other'));