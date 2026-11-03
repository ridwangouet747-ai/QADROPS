CREATE INDEX "customer_business_name_idx" ON "customer" USING btree ("business_id","name","id");--> statement-breakpoint
CREATE INDEX "expense_cash_session_idx" ON "expense" USING btree ("business_id","cash_session_id") WHERE "expense"."cash_session_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_delivery_subscription_idx" ON "notification_delivery" USING btree ("subscription_id","status","attempted_at");--> statement-breakpoint
CREATE INDEX "notification_delivery_attempted_idx" ON "notification_delivery" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "opening_payment_cash_session_idx" ON "opening_balance_payment" USING btree ("business_id","cash_session_id") WHERE "opening_balance_payment"."cash_session_id" is not null;--> statement-breakpoint
CREATE INDEX "refund_business_date_idx" ON "payment_refund" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "refund_cash_session_idx" ON "payment_refund" USING btree ("business_id","cash_session_id") WHERE "payment_refund"."cash_session_id" is not null;--> statement-breakpoint
CREATE INDEX "purchase_supplier_idx" ON "purchase" USING btree ("business_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_payment_purchase_idx" ON "purchase_payment" USING btree ("business_id","purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_payment_cash_session_idx" ON "purchase_payment" USING btree ("business_id","cash_session_id") WHERE "purchase_payment"."cash_session_id" is not null;--> statement-breakpoint
CREATE INDEX "sale_customer_idx" ON "sale" USING btree ("business_id","customer_id") WHERE "sale"."customer_id" is not null;