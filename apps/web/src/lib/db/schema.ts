import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey,
  date, text, timestamp, unique, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Better Auth 1.7.7 Organization schema. organization.id is the commerce/business ID.
export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const organization = pgTable("organization", {
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  logo: text("logo"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: text("metadata"),
});
export const member = pgTable("member", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("member_org_user_unique").on(t.organizationId, t.userId), index("member_user_idx").on(t.userId)]);
export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(), role: text("role"), status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invitation_org_status_idx").on(t.organizationId, t.status), check("invitation_status_check", sql`${t.status} in ('pending','accepted','rejected','canceled')`)]);
export const session = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id").references(() => organization.id, { onDelete: "set null" }),
}, (t) => [index("session_user_id_idx").on(t.userId)]);
export const account = pgTable("account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), accessToken: text("access_token"),
  refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }), scope: text("scope"), password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("account_user_id_idx").on(t.userId)]);
export const verification = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

/**
 * Désactivation d'un accès membre. La ligne `member` n'est jamais supprimée : ventes, mouvements et
 * audits la référencent. Un membre présent ici avec `disabled_at` non nul ne peut plus agir sur ce commerce.
 */
export const businessMemberAccess = pgTable("business_member_access", {
  businessId: text("business_id").notNull(), userId: text("user_id").notNull(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }), disabledByUserId: text("disabled_by_user_id").references(() => user.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ name: "business_member_access_pk", columns: [t.businessId, t.userId] }), foreignKey({ columns: [t.businessId, t.userId], foreignColumns: [member.organizationId, member.userId], name: "business_member_access_member_fk" }).onDelete("cascade")]);

export const businessProfile = pgTable("business_profile", {
  businessId: text("business_id").primaryKey().references(() => organization.id, { onDelete: "restrict" }),
  activity: text("activity").notNull(), phone: text("phone"), address: text("address"), businessEmail: text("business_email"),
  currency: text("currency").notNull().default("XOF"), timezone: text("timezone").notNull().default("Africa/Abidjan"),
  primaryColor: text("primary_color").notNull().default("#176B5B"), status: text("status").notNull().default("active"),
  storeFormat: text("store_format"), creationKey: text("creation_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("business_activity_check", sql`${t.activity} in ('hardware','phones','general','clothing')`), check("business_currency_check", sql`${t.currency} = 'XOF'`), check("business_status_check", sql`${t.status} in ('pending','active','suspended','expired')`),
  check("business_store_format_check", sql`${t.storeFormat} is null or ${t.storeFormat} in ('shop','kiosk','wholesale','other')`),
  uniqueIndex("business_creation_key_unique").on(t.creationKey).where(sql`${t.creationKey} is not null`)]);
export const platformAdmin = pgTable("platform_admin", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  grantedByUserId: text("granted_by_user_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
export const receiptSettings = pgTable("receipt_settings", {
  businessId: text("business_id").primaryKey().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  paperWidthMm: integer("paper_width_mm").notNull().default(58), showLogo: boolean("show_logo").notNull().default(true), displayName: text("display_name"),
  footer: text("footer"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("receipt_width_check", sql`${t.paperWidthMm} in (58,80)`)]);

/**
 * Session de caisse (mission 09) : un membre ouvre sa caisse avec un fonds de départ, y rattache ses
 * opérations en espèces, compte l'argent et clôture. Une seule session ouverte par membre et par
 * commerce. La clôture fige le montant théorique, le montant compté et l'écart (justifié s'il n'est
 * pas nul) ; un déclencheur refuse toute modification ultérieure, sauf la validation par un responsable.
 */
export const cashSession = pgTable("cash_session", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  userId: text("user_id").notNull(), status: text("status").notNull().default("open"),
  openingFloatXof: bigint("opening_float_xof", { mode: "bigint" }).notNull(), openingNote: text("opening_note"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }), closedByUserId: text("closed_by_user_id"),
  countedCashXof: bigint("counted_cash_xof", { mode: "bigint" }), expectedCashXof: bigint("expected_cash_xof", { mode: "bigint" }),
  differenceXof: bigint("difference_xof", { mode: "bigint" }), closingNote: text("closing_note"), closingSnapshot: jsonb("closing_snapshot"),
  validatedAt: timestamp("validated_at", { withTimezone: true }), validatedByUserId: text("validated_by_user_id"), validationNote: text("validation_note"),
}, (t) => [unique("cash_session_business_id_unique").on(t.businessId, t.id),
  foreignKey({ columns: [t.businessId, t.userId], foreignColumns: [member.organizationId, member.userId], name: "cash_session_owner_membership_fk" }),
  foreignKey({ columns: [t.businessId, t.closedByUserId], foreignColumns: [member.organizationId, member.userId], name: "cash_session_closer_membership_fk" }),
  foreignKey({ columns: [t.businessId, t.validatedByUserId], foreignColumns: [member.organizationId, member.userId], name: "cash_session_validator_membership_fk" }),
  uniqueIndex("cash_session_one_open_per_member").on(t.businessId, t.userId).where(sql`${t.status} = 'open'`),
  index("cash_session_business_opened_idx").on(t.businessId, t.openedAt),
  check("cash_session_status_check", sql`${t.status} in ('open','closed','validated')`),
  check("cash_session_amounts_check", sql`${t.openingFloatXof} >= 0 and (${t.countedCashXof} is null or ${t.countedCashXof} >= 0)`),
  check("cash_session_closing_check", sql`(${t.status} = 'open' and ${t.closedAt} is null and ${t.countedCashXof} is null and ${t.expectedCashXof} is null and ${t.differenceXof} is null)
    or (${t.status} in ('closed','validated') and ${t.closedAt} is not null and ${t.closedByUserId} is not null and ${t.countedCashXof} is not null and ${t.expectedCashXof} is not null and ${t.differenceXof} = ${t.countedCashXof} - ${t.expectedCashXof})`),
  check("cash_session_difference_justified", sql`${t.differenceXof} is null or ${t.differenceXof} = 0 or length(trim(coalesce(${t.closingNote}, ''))) > 0`),
  check("cash_session_validation_check", sql`(${t.status} = 'validated') = (${t.validatedAt} is not null and ${t.validatedByUserId} is not null)`),
  check("cash_session_notes_length", sql`char_length(coalesce(${t.openingNote}, '')) <= 500 and char_length(coalesce(${t.closingNote}, '')) <= 500 and char_length(coalesce(${t.validationNote}, '')) <= 500`)]);
/** Entrée ou sortie d'espèces justifiée (apport de monnaie, retrait vers le coffre…), en ajout seul. */
export const cashMovement = pgTable("cash_movement", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  sessionId: text("session_id").notNull(), direction: text("direction").notNull(), amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(), createdByUserId: text("created_by_user_id").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.sessionId], foreignColumns: [cashSession.businessId, cashSession.id], name: "cash_movement_session_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "cash_movement_actor_membership_fk" }),
  index("cash_movement_session_idx").on(t.businessId, t.sessionId, t.occurredAt),
  check("cash_movement_direction_check", sql`${t.direction} in ('in','out')`), check("cash_movement_amount_positive", sql`${t.amountXof} > 0`),
  check("cash_movement_reason_length", sql`char_length(trim(${t.reason})) between 1 and 240`)]);

export const productCategory = pgTable("product_category", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  name: text("name").notNull(), archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("category_business_id_unique").on(t.businessId, t.id), unique("category_business_name_unique").on(t.businessId, t.name), index("category_business_idx").on(t.businessId)]);
export const product = pgTable("product", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  categoryId: text("category_id").references(() => productCategory.id, { onDelete: "restrict" }), name: text("name").notNull(),
  description: text("description"), baseUnit: text("base_unit").notNull().default("piece"), trackSerial: boolean("track_serial").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("product_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.categoryId], foreignColumns: [productCategory.businessId, productCategory.id], name: "product_category_tenant_fk" }), index("product_business_name_idx").on(t.businessId, t.name), index("product_category_idx").on(t.businessId, t.categoryId)]);
export const productVariant = pgTable("product_variant", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  productId: text("product_id").notNull(), label: text("label").notNull().default("Standard"), sku: text("sku"), barcode: text("barcode"),
  color: text("color"), size: text("size"), salePriceXof: bigint("sale_price_xof", { mode: "bigint" }).notNull(),
  onHand: numeric("on_hand", { precision: 24, scale: 6 }).notNull().default("0"), averageCostXof: numeric("average_cost_xof", { precision: 30, scale: 12 }).notNull().default("0"),
  costKnown: boolean("cost_known").notNull().default(false),
  stockRevision: bigint("stock_revision", { mode: "bigint" }).notNull().default(sql`0`), lowStockThreshold: numeric("low_stock_threshold", { precision: 24, scale: 6 }).notNull().default("0"),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("variant_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.productId], foreignColumns: [product.businessId, product.id], name: "variant_product_tenant_fk" }), uniqueIndex("variant_business_sku_unique").on(t.businessId, t.sku).where(sql`${t.sku} is not null`), index("variant_business_product_idx").on(t.businessId, t.productId), check("variant_price_nonnegative", sql`${t.salePriceXof} >= 0`), check("variant_on_hand_nonnegative", sql`${t.onHand} >= 0`), check("variant_cost_nonnegative", sql`${t.averageCostXof} >= 0`)]);

export const customer = pgTable("customer", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  name: text("name").notNull(), phone: text("phone"), notes: text("notes"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("customer_business_id_unique").on(t.businessId, t.id), index("customer_business_phone_idx").on(t.businessId, t.phone), index("customer_business_name_idx").on(t.businessId, t.name, t.id)]);
export const sale = pgTable("sale", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  reference: text("reference").notNull(), idempotencyKey: text("idempotency_key").notNull(), cashierUserId: text("cashier_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  customerId: text("customer_id"), status: text("status").notNull().default("completed"), subtotalXof: bigint("subtotal_xof", { mode: "bigint" }).notNull(),
  discountXof: bigint("discount_xof", { mode: "bigint" }).notNull().default(sql`0`), totalXof: bigint("total_xof", { mode: "bigint" }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("sale_business_id_unique").on(t.businessId, t.id), unique("sale_business_reference_unique").on(t.businessId, t.reference), unique("sale_business_idempotency_unique").on(t.businessId, t.idempotencyKey), foreignKey({ columns: [t.businessId, t.customerId], foreignColumns: [customer.businessId, customer.id], name: "sale_customer_tenant_fk" }), foreignKey({ columns: [t.businessId, t.cashierUserId], foreignColumns: [member.organizationId, member.userId], name: "sale_cashier_membership_tenant_fk" }), index("sale_business_occurred_idx").on(t.businessId, t.occurredAt), index("sale_customer_idx").on(t.businessId, t.customerId).where(sql`${t.customerId} is not null`), check("sale_amounts_check", sql`${t.subtotalXof} >= 0 and ${t.discountXof} >= 0 and ${t.totalXof} = ${t.subtotalXof} - ${t.discountXof}`), check("sale_status_check", sql`${t.status} in ('completed','partially_refunded','refunded','voided')`)]);
export const saleLine = pgTable("sale_line", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), saleId: text("sale_id").notNull(),
  variantId: text("variant_id").notNull(), productNameSnapshot: text("product_name_snapshot").notNull(), variantSnapshot: text("variant_snapshot").notNull().default("Standard"),
  quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), unitPriceXof: bigint("unit_price_xof", { mode: "bigint" }).notNull(),
  lineDiscountXof: bigint("line_discount_xof", { mode: "bigint" }).notNull().default(sql`0`), lineTotalXof: bigint("line_total_xof", { mode: "bigint" }).notNull(),
  unitCostSnapshotXof: numeric("unit_cost_snapshot_xof", { precision: 30, scale: 12 }).notNull(), cogsXof: bigint("cogs_xof", { mode: "bigint" }).notNull(),
  costAvailable: boolean("cost_available").notNull().default(false),
}, (t) => [unique("sale_line_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.saleId], foreignColumns: [sale.businessId, sale.id], name: "sale_line_sale_tenant_fk" }), foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "sale_line_variant_tenant_fk" }), index("sale_line_sale_idx").on(t.businessId, t.saleId), check("sale_line_qty_positive", sql`${t.quantity} > 0`), check("sale_line_amounts_nonnegative", sql`${t.unitPriceXof} >= 0 and ${t.lineDiscountXof} >= 0 and ${t.lineTotalXof} >= 0 and ${t.cogsXof} >= 0`)]);
export const payment = pgTable("payment", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), saleId: text("sale_id").notNull(),
  method: text("method").notNull(), amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), status: text("status").notNull().default("confirmed"),
  providerReference: text("provider_reference"), recordedByUserId: text("recorded_by_user_id"), idempotencyKey: text("idempotency_key").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }), providerPayloadHash: text("provider_payload_hash"),
  cashSessionId: text("cash_session_id"),
}, (t) => [foreignKey({ columns: [t.businessId, t.cashSessionId], foreignColumns: [cashSession.businessId, cashSession.id], name: "payment_cash_session_tenant_fk" }), index("payment_cash_session_idx").on(t.businessId, t.cashSessionId).where(sql`${t.cashSessionId} is not null`), index("payment_business_confirmed_idx").on(t.businessId, t.confirmedAt), unique("payment_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.saleId], foreignColumns: [sale.businessId, sale.id], name: "payment_sale_tenant_fk" }), foreignKey({ columns: [t.businessId, t.recordedByUserId], foreignColumns: [member.organizationId, member.userId], name: "payment_recorder_membership_tenant_fk" }), unique("payment_business_idempotency_unique").on(t.businessId, t.idempotencyKey), uniqueIndex("payment_provider_reference_unique").on(t.businessId, t.providerReference).where(sql`${t.providerReference} is not null`), index("payment_sale_status_idx").on(t.businessId, t.saleId, t.status), check("payment_amount_positive", sql`${t.amountXof} > 0`), check("payment_method_check", sql`${t.method} in ('cash','wave','orange_money','mtn_momo','other')`), check("payment_status_check", sql`${t.status} in ('pending','confirmed','failed','refunded','partially_refunded')`)]);
export const paymentRefund = pgTable("payment_refund", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), paymentId: text("payment_id").notNull(),
  amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), status: text("status").notNull().default("confirmed"), reference: text("reference").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  cashSessionId: text("cash_session_id"),
}, (t) => [foreignKey({ columns: [t.businessId, t.cashSessionId], foreignColumns: [cashSession.businessId, cashSession.id], name: "refund_cash_session_tenant_fk" }), unique("refund_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.paymentId], foreignColumns: [payment.businessId, payment.id], name: "refund_payment_tenant_fk" }), foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "refund_actor_membership_tenant_fk" }), unique("refund_business_reference_unique").on(t.businessId, t.reference), index("refund_payment_date_idx").on(t.businessId, t.paymentId, t.occurredAt), index("refund_business_date_idx").on(t.businessId, t.occurredAt), index("refund_cash_session_idx").on(t.businessId, t.cashSessionId).where(sql`${t.cashSessionId} is not null`), check("refund_amount_positive", sql`${t.amountXof} > 0`), check("refund_status_check", sql`${t.status} in ('pending','confirmed','failed')`)]);
export const receivablePayment = pgTable("receivable_payment", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), saleId: text("sale_id").notNull(),
  paymentId: text("payment_id").notNull(), appliedAmountXof: bigint("applied_amount_xof", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.saleId], foreignColumns: [sale.businessId, sale.id], name: "receivable_sale_tenant_fk" }), foreignKey({ columns: [t.businessId, t.paymentId], foreignColumns: [payment.businessId, payment.id], name: "receivable_payment_tenant_fk" }), unique("receivable_payment_sale_unique").on(t.businessId, t.paymentId, t.saleId), check("receivable_applied_positive", sql`${t.appliedAmountXof} > 0`)]);

export const supplier = pgTable("supplier", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  name: text("name").notNull(), phone: text("phone"), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [unique("supplier_business_id_unique").on(t.businessId, t.id), index("supplier_business_name_idx").on(t.businessId, t.name)]);
export const purchase = pgTable("purchase", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  supplierId: text("supplier_id").notNull(), reference: text("reference").notNull(), status: text("status").notNull().default("received"),
  totalXof: bigint("total_xof", { mode: "bigint" }).notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("purchase_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.supplierId], foreignColumns: [supplier.businessId, supplier.id], name: "purchase_supplier_tenant_fk" }), unique("purchase_business_reference_unique").on(t.businessId, t.reference), index("purchase_business_date_idx").on(t.businessId, t.occurredAt), index("purchase_supplier_idx").on(t.businessId, t.supplierId), check("purchase_total_nonnegative", sql`${t.totalXof} >= 0`), check("purchase_status_check", sql`${t.status} in ('draft','received','canceled')`)]);
export const purchaseLine = pgTable("purchase_line", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), purchaseId: text("purchase_id").notNull(), variantId: text("variant_id").notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), unitCostXof: bigint("unit_cost_xof", { mode: "bigint" }).notNull(), lineTotalXof: bigint("line_total_xof", { mode: "bigint" }).notNull(),
}, (t) => [unique("purchase_line_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.purchaseId], foreignColumns: [purchase.businessId, purchase.id], name: "purchase_line_purchase_tenant_fk" }), foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "purchase_line_variant_tenant_fk" }), check("purchase_line_qty_positive", sql`${t.quantity} > 0`), check("purchase_line_amount_nonnegative", sql`${t.unitCostXof} >= 0 and ${t.lineTotalXof} >= 0`)]);
export const purchasePayment = pgTable("purchase_payment", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), purchaseId: text("purchase_id").notNull(),
  amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), method: text("method").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  cashSessionId: text("cash_session_id"),
}, (t) => [foreignKey({ columns: [t.businessId, t.purchaseId], foreignColumns: [purchase.businessId, purchase.id], name: "purchase_payment_tenant_fk" }), foreignKey({ columns: [t.businessId, t.cashSessionId], foreignColumns: [cashSession.businessId, cashSession.id], name: "purchase_payment_cash_session_tenant_fk" }), index("purchase_payment_business_date_idx").on(t.businessId, t.occurredAt), index("purchase_payment_purchase_idx").on(t.businessId, t.purchaseId), index("purchase_payment_cash_session_idx").on(t.businessId, t.cashSessionId).where(sql`${t.cashSessionId} is not null`), check("purchase_payment_positive", sql`${t.amountXof} > 0`)]);

/**
 * Solde d'ouverture : dette d'un client envers le commerce, ou du commerce envers un fournisseur,
 * existant avant l'arrivée sur Qadr Ops. Ce n'est ni une vente à crédit ni un achat : aucun chiffre
 * d'affaires, aucun stock. Un seul solde d'ouverture par client ou par fournisseur.
 */
export const openingBalance = pgTable("opening_balance", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  partyType: text("party_type").notNull(), customerId: text("customer_id"), supplierId: text("supplier_id"),
  amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), asOfDate: date("as_of_date", { mode: "string" }).notNull(), note: text("note"),
  createdByUserId: text("created_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("opening_balance_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.customerId], foreignColumns: [customer.businessId, customer.id], name: "opening_balance_customer_tenant_fk" }), foreignKey({ columns: [t.businessId, t.supplierId], foreignColumns: [supplier.businessId, supplier.id], name: "opening_balance_supplier_tenant_fk" }), foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "opening_balance_actor_membership_tenant_fk" }), uniqueIndex("opening_balance_customer_unique").on(t.businessId, t.customerId).where(sql`${t.customerId} is not null`), uniqueIndex("opening_balance_supplier_unique").on(t.businessId, t.supplierId).where(sql`${t.supplierId} is not null`), check("opening_balance_party_check", sql`(${t.partyType} = 'customer' and ${t.customerId} is not null and ${t.supplierId} is null) or (${t.partyType} = 'supplier' and ${t.supplierId} is not null and ${t.customerId} is null)`), check("opening_balance_amount_positive", sql`${t.amountXof} > 0`), check("opening_balance_note_length", sql`${t.note} is null or char_length(${t.note}) <= 500`)]);
export const openingBalancePayment = pgTable("opening_balance_payment", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  openingBalanceId: text("opening_balance_id").notNull(), amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), method: text("method").notNull(),
  recordedByUserId: text("recorded_by_user_id").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  cashSessionId: text("cash_session_id"),
}, (t) => [foreignKey({ columns: [t.businessId, t.cashSessionId], foreignColumns: [cashSession.businessId, cashSession.id], name: "opening_payment_cash_session_tenant_fk" }), index("opening_payment_business_date_idx").on(t.businessId, t.occurredAt), foreignKey({ columns: [t.businessId, t.openingBalanceId], foreignColumns: [openingBalance.businessId, openingBalance.id], name: "opening_payment_balance_tenant_fk" }), foreignKey({ columns: [t.businessId, t.recordedByUserId], foreignColumns: [member.organizationId, member.userId], name: "opening_payment_actor_membership_tenant_fk" }), index("opening_payment_balance_idx").on(t.businessId, t.openingBalanceId), index("opening_payment_cash_session_idx").on(t.businessId, t.cashSessionId).where(sql`${t.cashSessionId} is not null`), check("opening_payment_amount_positive", sql`${t.amountXof} > 0`), check("opening_payment_method_check", sql`${t.method} in ('cash','wave','orange_money','mtn_momo','other')`)]);

export const inventorySession = pgTable("inventory_session", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  status: text("status").notNull().default("counting"), startedByUserId: text("started_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  scopeCategoryId: text("scope_category_id"), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  validatedByUserId: text("validated_by_user_id").references(() => user.id, { onDelete: "restrict" }), countedAt: timestamp("counted_at", { withTimezone: true }), validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("inventory_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.startedByUserId], foreignColumns: [member.organizationId, member.userId], name: "inventory_started_membership_tenant_fk" }), foreignKey({ columns: [t.businessId, t.validatedByUserId], foreignColumns: [member.organizationId, member.userId], name: "inventory_validator_membership_tenant_fk" }), foreignKey({ columns: [t.businessId, t.scopeCategoryId], foreignColumns: [productCategory.businessId, productCategory.id], name: "inventory_scope_category_tenant_fk" }), index("inventory_business_status_idx").on(t.businessId, t.status, t.createdAt), check("inventory_status_check", sql`${t.status} in ('counting','submitted','validated','canceled')`)]);
export const inventoryScopeVariant = pgTable("inventory_scope_variant", {
  businessId: text("business_id").notNull(), sessionId: text("session_id").notNull(), variantId: text("variant_id").notNull(),
}, (t) => [primaryKey({ columns: [t.businessId, t.sessionId, t.variantId], name: "inventory_scope_variant_pk" }), foreignKey({ columns: [t.businessId, t.sessionId], foreignColumns: [inventorySession.businessId, inventorySession.id], name: "inventory_scope_session_tenant_fk" }), foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "inventory_scope_variant_tenant_fk" })]);
export const inventoryLine = pgTable("inventory_line", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), sessionId: text("session_id").notNull(), variantId: text("variant_id").notNull(),
  countedAt: timestamp("counted_at", { withTimezone: true }).notNull(), theoreticalQty: numeric("theoretical_qty", { precision: 24, scale: 6 }).notNull(), countedQty: numeric("counted_qty", { precision: 24, scale: 6 }).notNull(),
  expectedStockRevision: bigint("expected_stock_revision", { mode: "bigint" }).notNull(), countedByUserId: text("counted_by_user_id").notNull(), adjustmentReason: text("adjustment_reason"),
}, (t) => [unique("inventory_line_business_id_unique").on(t.businessId, t.id), unique("inventory_session_variant_unique").on(t.businessId, t.sessionId, t.variantId), foreignKey({ columns: [t.businessId, t.sessionId], foreignColumns: [inventorySession.businessId, inventorySession.id], name: "inventory_line_session_tenant_fk" }), foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "inventory_line_variant_tenant_fk" }), foreignKey({ columns: [t.businessId, t.countedByUserId], foreignColumns: [member.organizationId, member.userId], name: "inventory_line_counter_membership_tenant_fk" }), check("inventory_quantities_nonnegative", sql`${t.theoreticalQty} >= 0 and ${t.countedQty} >= 0`), check("inventory_adjustment_reason_nonempty", sql`${t.adjustmentReason} is null or length(trim(${t.adjustmentReason})) > 0`)]);

/**
 * Stock d'ouverture : marchandises déjà présentes avant l'arrivée sur Qadr Ops. Ce n'est ni un achat
 * (pas de fournisseur ni de dette) ni une vente. Une variante ne peut recevoir qu'une seule ligne
 * d'ouverture ; les corrections ultérieures passent par un inventaire.
 */
export const stockOpening = pgTable("stock_opening", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  referenceDate: date("reference_date", { mode: "string" }).notNull(), note: text("note"),
  postedByUserId: text("posted_by_user_id").notNull(), postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("stock_opening_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.postedByUserId], foreignColumns: [member.organizationId, member.userId], name: "stock_opening_actor_membership_tenant_fk" }), index("stock_opening_business_date_idx").on(t.businessId, t.postedAt), check("stock_opening_note_length", sql`${t.note} is null or char_length(${t.note}) <= 500`)]);
export const stockOpeningLine = pgTable("stock_opening_line", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  openingId: text("opening_id").notNull(), variantId: text("variant_id").notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), unitCostXof: bigint("unit_cost_xof", { mode: "bigint" }),
}, (t) => [unique("stock_opening_line_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.openingId], foreignColumns: [stockOpening.businessId, stockOpening.id], name: "stock_opening_line_opening_tenant_fk" }), foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "stock_opening_line_variant_tenant_fk" }), unique("stock_opening_line_variant_unique").on(t.businessId, t.variantId), check("stock_opening_line_qty_positive", sql`${t.quantity} > 0`), check("stock_opening_line_cost_nonnegative", sql`${t.unitCostXof} is null or ${t.unitCostXof} >= 0`)]);

export const stockMovement = pgTable("stock_movement", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), variantId: text("variant_id").notNull(),
  quantityDelta: numeric("quantity_delta", { precision: 24, scale: 6 }).notNull(), reason: text("reason").notNull(),
  saleLineId: text("sale_line_id"), purchaseLineId: text("purchase_line_id"), inventoryLineId: text("inventory_line_id"), openingLineId: text("opening_line_id"),
  unitCostXof: numeric("unit_cost_xof", { precision: 30, scale: 12 }), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "stock_movement_variant_tenant_fk" }), foreignKey({ columns: [t.businessId, t.saleLineId], foreignColumns: [saleLine.businessId, saleLine.id], name: "stock_movement_sale_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.purchaseLineId], foreignColumns: [purchaseLine.businessId, purchaseLine.id], name: "stock_movement_purchase_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.inventoryLineId], foreignColumns: [inventoryLine.businessId, inventoryLine.id], name: "stock_movement_inventory_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.openingLineId], foreignColumns: [stockOpeningLine.businessId, stockOpeningLine.id], name: "stock_movement_opening_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "stock_movement_actor_membership_tenant_fk" }), uniqueIndex("stock_movement_sale_line_unique").on(t.businessId, t.saleLineId).where(sql`${t.saleLineId} is not null`), uniqueIndex("stock_movement_purchase_line_unique").on(t.businessId, t.purchaseLineId).where(sql`${t.purchaseLineId} is not null`), uniqueIndex("stock_movement_inventory_line_unique").on(t.businessId, t.inventoryLineId).where(sql`${t.inventoryLineId} is not null`), uniqueIndex("stock_movement_opening_line_unique").on(t.businessId, t.openingLineId).where(sql`${t.openingLineId} is not null`), index("stock_movement_business_date_idx").on(t.businessId, t.occurredAt, t.id), index("stock_movement_variant_date_idx").on(t.businessId, t.variantId, t.occurredAt), check("stock_movement_source_one_check", sql`num_nonnulls(${t.saleLineId}, ${t.purchaseLineId}, ${t.inventoryLineId}, ${t.openingLineId}) = 1`), check("stock_movement_delta_nonzero", sql`${t.quantityDelta} <> 0`), check("stock_movement_reason_check", sql`${t.reason} in ('sale','purchase','inventory_adjustment','manual_adjustment','return','opening_stock')`), check("stock_movement_opening_reason_check", sql`(${t.openingLineId} is null) = (${t.reason} <> 'opening_stock')`)]);

export const expense = pgTable("expense", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  category: text("category").notNull(), description: text("description").notNull(), amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(),
  paidByUserId: text("paid_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  // Moyen de paiement : nul pour les dépenses saisies avant la mission 09 (« non précisé »).
  paymentMethod: text("payment_method"), cashSessionId: text("cash_session_id"),
}, (t) => [check("expense_payment_method_check", sql`${t.paymentMethod} is null or ${t.paymentMethod} in ('cash','wave','orange_money','mtn_momo','other')`), foreignKey({ columns: [t.businessId, t.cashSessionId], foreignColumns: [cashSession.businessId, cashSession.id], name: "expense_cash_session_tenant_fk" }), unique("expense_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.paidByUserId], foreignColumns: [member.organizationId, member.userId], name: "expense_actor_membership_tenant_fk" }), index("expense_business_date_idx").on(t.businessId, t.occurredAt), index("expense_cash_session_idx").on(t.businessId, t.cashSessionId).where(sql`${t.cashSessionId} is not null`), check("expense_positive", sql`${t.amountXof} > 0`)]);

export const subscriptionPlan = pgTable("subscription_plan", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), name: text("name").notNull(), priceXof: bigint("price_xof", { mode: "bigint" }).notNull(),
  durationDays: integer("duration_days").notNull(), active: boolean("active").notNull().default(true), features: jsonb("features").notNull().default({}),
  description: text("description"), currency: text("currency").notNull().default("XOF"), storageMb: integer("storage_mb"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("plan_amount_duration_check", sql`${t.priceXof} >= 0 and ${t.durationDays} > 0`), check("plan_currency_check", sql`${t.currency} = 'XOF'`),
  check("plan_storage_positive", sql`${t.storageMb} is null or ${t.storageMb} > 0`)]);
export const promotionCode = pgTable("promotion_code", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), discountPercent: integer("discount_percent"), discountXof: bigint("discount_xof", { mode: "bigint" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }), maxRedemptions: integer("max_redemptions"), active: boolean("active").notNull().default(true),
  kind: text("kind").notNull().default("discount"), planId: text("plan_id").references(() => subscriptionPlan.id, { onDelete: "restrict" }), grantDays: integer("grant_days"),
  campaign: text("campaign"), batchId: text("batch_id"), createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: text("revoked_by_user_id").references(() => user.id, { onDelete: "restrict" }), revokeReason: text("revoke_reason"),
}, (t) => [
  check("promotion_kind_check", sql`${t.kind} in ('discount','access')`),
  check("promotion_discount_check", sql`(${t.kind} = 'discount' and ((${t.discountPercent} between 1 and 100 and ${t.discountXof} is null) or (${t.discountXof} > 0 and ${t.discountPercent} is null)))
    or (${t.kind} = 'access' and ${t.discountPercent} is null and ${t.discountXof} is null and ${t.planId} is not null and ${t.grantDays} between 1 and 3650)`),
  check("promotion_limit_positive", sql`${t.maxRedemptions} is null or ${t.maxRedemptions} > 0`), check("promotion_validity_order", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  index("promotion_batch_idx").on(t.batchId),
]);
export const promotionEligibleBusiness = pgTable("promotion_eligible_business", {
  promotionId: text("promotion_id").notNull().references(() => promotionCode.id, { onDelete: "restrict" }),
  businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.promotionId, t.businessId], name: "promotion_eligible_business_pk" })]);
export const businessSubscription = pgTable("business_subscription", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), planId: text("plan_id").notNull().references(() => subscriptionPlan.id, { onDelete: "restrict" }),
  status: text("status").notNull(), startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(), trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  providerReference: text("provider_reference"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  origin: text("origin").notNull().default("manual"), statusBeforeSuspension: text("status_before_suspension"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("subscription_business_id_unique").on(t.businessId, t.id), index("subscription_business_status_idx").on(t.businessId, t.status, t.endsAt),
  check("subscription_status_check", sql`${t.status} in ('pending','trialing','active','suspended','expired','canceled')`),
  check("subscription_origin_check", sql`${t.origin} in ('manual','promotion','payment')`),
  check("subscription_resume_status_check", sql`${t.statusBeforeSuspension} is null or ${t.statusBeforeSuspension} in ('trialing','active')`),
  index("subscription_status_end_idx").on(t.status, t.endsAt)]);
export const subscriptionPayment = pgTable("subscription_payment", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), subscriptionId: text("subscription_id").notNull(),
  amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), method: text("method").notNull(), status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(), providerReference: text("provider_reference"), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (t) => [unique("subscription_payment_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.subscriptionId], foreignColumns: [businessSubscription.businessId, businessSubscription.id], name: "subscription_payment_tenant_fk" }), unique("subscription_payment_business_key_unique").on(t.businessId, t.idempotencyKey), uniqueIndex("subscription_payment_provider_reference_unique").on(t.businessId, t.providerReference).where(sql`${t.providerReference} is not null`), index("subscription_payment_status_date_idx").on(t.businessId, t.status, t.occurredAt), check("subscription_payment_amount_positive", sql`${t.amountXof} > 0`), check("subscription_payment_method_check", sql`${t.method} in ('wave','orange_money','mtn_momo','other')`), check("subscription_payment_status_check", sql`${t.status} in ('pending','confirmed','failed','refunded')`)]);
export const promotionRedemption = pgTable("promotion_redemption", {
  id: text("id").primaryKey(), promotionId: text("promotion_id").notNull().references(() => promotionCode.id, { onDelete: "restrict" }),
  businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), subscriptionId: text("subscription_id").notNull(),
  codeSnapshot: text("code_snapshot").notNull(), discountAmountXof: bigint("discount_amount_xof", { mode: "bigint" }).notNull().default(sql`0`),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.subscriptionId], foreignColumns: [businessSubscription.businessId, businessSubscription.id], name: "promotion_subscription_tenant_fk" }), unique("promotion_business_once_unique").on(t.promotionId, t.businessId), check("promotion_redemption_discount_nonnegative", sql`${t.discountAmountXof} >= 0`)]);

export const auditEvent = pgTable("audit_event", {
  id: text("id").primaryKey(), businessId: text("business_id").references(() => businessProfile.businessId, { onDelete: "restrict" }), actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_business_date_idx").on(t.businessId, t.occurredAt), index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_type_date_idx").on(t.eventType, t.occurredAt)]);
export const paymentProviderEvent = pgTable("payment_provider_event", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), provider: text("provider").notNull(), eventId: text("event_id").notNull(),
  paymentId: text("payment_id"), subscriptionPaymentId: text("subscription_payment_id"), payloadHash: text("payload_hash").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [unique("provider_event_idempotency_unique").on(t.businessId, t.provider, t.eventId), foreignKey({ columns: [t.businessId, t.paymentId], foreignColumns: [payment.businessId, payment.id], name: "provider_event_store_payment_tenant_fk" }), foreignKey({ columns: [t.businessId, t.subscriptionPaymentId], foreignColumns: [subscriptionPayment.businessId, subscriptionPayment.id], name: "provider_event_subscription_payment_tenant_fk" }), index("provider_event_business_received_idx").on(t.businessId, t.receivedAt), check("provider_event_single_target_check", sql`num_nonnulls(${t.paymentId}, ${t.subscriptionPaymentId}) <= 1`)]);
// Client-generated operation keys, scoped per business: a retried command returns its first result instead of running twice.
export const idempotencyRecord = pgTable("idempotency_record", {
  businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), idempotencyKey: text("idempotency_key").notNull(),
  operation: text("operation").notNull(), requestHash: text("request_hash").notNull(), actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  result: jsonb("result").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ name: "idempotency_record_pk", columns: [t.businessId, t.idempotencyKey] }), check("idempotency_key_length_check", sql`char_length(${t.idempotencyKey}) between 8 and 128`), check("idempotency_operation_check", sql`${t.operation} in ('purchase.receive','expense.create','receivable.payment','stock.opening','opening_balance.create','opening_balance.payment','cash_session.open','cash_session.movement','cash_session.close','cash_session.validate','import.apply','print.reprint')`)]);

/* ------------------------------------------------------------------ Notifications (mission 10) */

/**
 * Modèle de notification administré par Qadr Agency. Textes en trois langues, variables limitées à une
 * liste blanche (aucun code exécuté), lien interne seulement. `kind = 'event'` : déclenché par un événement
 * métier (`key` = type d'événement) ; `kind = 'announcement'` : envoyé par une campagne.
 */
export const notificationTemplate = pgTable("notification_template", {
  id: text("id").primaryKey(), key: text("key").notNull().unique(), kind: text("kind").notNull().default("event"), category: text("category").notNull(),
  active: boolean("active").notNull().default(true), icon: text("icon").notNull().default("bell"), linkPath: text("link_path"),
  titleFr: text("title_fr").notNull(), titleEn: text("title_en").notNull(), titleAr: text("title_ar").notNull(),
  bodyFr: text("body_fr").notNull(), bodyEn: text("body_en").notNull(), bodyAr: text("body_ar").notNull(),
  version: integer("version").notNull().default(1), updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("notification_template_kind_check", sql`${t.kind} in ('event','announcement')`),
  check("notification_template_category_check", sql`${t.category} in ('commercial','security','subscription','system','announcement')`),
  check("notification_template_text_length", sql`char_length(${t.titleFr}) between 1 and 120 and char_length(${t.titleEn}) between 1 and 120 and char_length(${t.titleAr}) between 1 and 120
    and char_length(${t.bodyFr}) between 1 and 500 and char_length(${t.bodyEn}) between 1 and 500 and char_length(${t.bodyAr}) between 1 and 500`),
  check("notification_template_link_check", sql`${t.linkPath} is null or ${t.linkPath} ~ '^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$'`)]);
/** Annonce envoyée à tous les commerces ou à un segment décidé par le serveur ; pausable. */
export const notificationCampaign = pgTable("notification_campaign", {
  id: text("id").primaryKey(), templateId: text("template_id").notNull().references(() => notificationTemplate.id, { onDelete: "restrict" }),
  segment: jsonb("segment").notNull().default({}), status: text("status").notNull().default("running"),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  recipientCount: integer("recipient_count").notNull().default(0),
}, (t) => [check("notification_campaign_status_check", sql`${t.status} in ('running','paused','done','canceled')`)]);
/**
 * Boîte d'envoi transactionnelle : écrite dans la même transaction que l'opération métier, traitée plus tard
 * par un processus indépendant. `dedup_key` empêche deux événements identiques. Aucune donnée confidentielle :
 * seulement des identifiants et des variables autorisées.
 */
export const notificationOutbox = pgTable("notification_outbox", {
  id: text("id").primaryKey(), businessId: text("business_id").references(() => businessProfile.businessId, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(), payload: jsonb("payload").notNull().default({}), dedupKey: text("dedup_key").notNull().unique(),
  campaignId: text("campaign_id").references(() => notificationCampaign.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(), lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastError: text("last_error"), recipientCount: integer("recipient_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [check("notification_outbox_status_check", sql`${t.status} in ('pending','done','failed','skipped')`),
  index("notification_outbox_pending_idx").on(t.status, t.nextAttemptAt), index("notification_outbox_business_idx").on(t.businessId, t.createdAt)]);
/** Notification interne d'un utilisateur, rendue dans sa langue à la création. Une seule par (événement, destinataire). */
export const notification = pgTable("notification", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  businessId: text("business_id").references(() => businessProfile.businessId, { onDelete: "restrict" }),
  outboxId: text("outbox_id").notNull().references(() => notificationOutbox.id, { onDelete: "restrict" }),
  templateKey: text("template_key").notNull(), category: text("category").notNull(), icon: text("icon").notNull().default("bell"),
  title: text("title").notNull(), body: text("body").notNull(), linkPath: text("link_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [unique("notification_outbox_user_unique").on(t.outboxId, t.userId), index("notification_user_idx").on(t.userId, t.businessId, t.createdAt),
  index("notification_unread_idx").on(t.userId, t.readAt), check("notification_link_check", sql`${t.linkPath} is null or ${t.linkPath} ~ '^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$'`)]);
/** Abonnement Web Push d'un appareil (navigateur) ; désactivé quand le service push répond 404/410. */
export const pushSubscription = pgTable("push_subscription", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  endpoint: text("endpoint").notNull().unique(), p256dh: text("p256dh").notNull(), auth: text("auth").notNull(), deviceLabel: text("device_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0), disabledAt: timestamp("disabled_at", { withTimezone: true }), disabledReason: text("disabled_reason"),
}, (t) => [index("push_subscription_user_idx").on(t.userId), check("push_subscription_endpoint_https", sql`${t.endpoint} like 'https://%'`)]);
/** Préférences d'un utilisateur : langue des notifications, push, catégories, plage de tranquillité (minutes, fuseau du commerce). */
export const notificationPreference = pgTable("notification_preference", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }), locale: text("locale").notNull().default("fr"),
  pushEnabled: boolean("push_enabled").notNull().default(false), categories: jsonb("categories").notNull().default({}),
  quietStartMinute: integer("quiet_start_minute"), quietEndMinute: integer("quiet_end_minute"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("notification_preference_locale_check", sql`${t.locale} in ('fr','en','ar')`),
  check("notification_preference_quiet_check", sql`(${t.quietStartMinute} is null) = (${t.quietEndMinute} is null) and coalesce(${t.quietStartMinute}, 0) between 0 and 1439 and coalesce(${t.quietEndMinute}, 0) between 0 and 1439`)]);
/** Suivi de chaque tentative push : envoyée, échouée, appareil expiré, ou volontairement sautée (préférences, nuit, limite). */
export const notificationDelivery = pgTable("notification_delivery", {
  id: text("id").primaryKey(), notificationId: text("notification_id").notNull().references(() => notification.id, { onDelete: "restrict" }),
  subscriptionId: text("subscription_id").references(() => pushSubscription.id, { onDelete: "restrict" }), status: text("status").notNull(),
  httpStatus: integer("http_status"), error: text("error"), attempts: integer("attempts").notNull().default(1),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }), attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("notification_delivery_status_check", sql`${t.status} in ('sent','failed','retry','expired','skipped_preference','skipped_quiet','skipped_rate','skipped_unconfigured')`),
  index("notification_delivery_notification_idx").on(t.notificationId), index("notification_delivery_retry_idx").on(t.status, t.nextAttemptAt),
  index("notification_delivery_subscription_idx").on(t.subscriptionId, t.status, t.attemptedAt), index("notification_delivery_attempted_idx").on(t.attemptedAt)]);

/* ------------------------------------------------------------------ Impression thermique (mission 10) */

/** Module facultatif : désactivé par défaut, un commerce sans imprimante n'a rien à configurer. */
export const printerSettings = pgTable("printer_settings", {
  businessId: text("business_id").primaryKey().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  enabled: boolean("enabled").notNull().default(false), autoPrint: boolean("auto_print").notNull().default(false),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "restrict" }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/**
 * Imprimante déclarée par le commerce (le secret d'appairage reste dans le navigateur et le service local, jamais ici).
 * Profil (mission 11, phase 5) : largeur du papier, page de codes du mode texte, mode d'écriture (auto : texte,
 * ou image dès que le ticket est en arabe ou contient un caractère hors de la page de codes).
 */
export const printDevice = pgTable("print_device", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  name: text("name").notNull(), transport: text("transport").notNull(), profile: text("profile").notNull().default("generic"), paperWidthMm: integer("paper_width_mm").notNull().default(80),
  codePage: text("code_page").notNull().default("pc858"), renderMode: text("render_mode").notNull().default("auto"),
  agentId: text("agent_id"), createdByUserId: text("created_by_user_id").notNull(), archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), lastStatus: text("last_status"), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => [unique("print_device_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "print_device_creator_membership_fk" }),
  check("print_device_transport_check", sql`${t.transport} in ('tcp','windows_share','device','simulated')`), check("print_device_width_check", sql`${t.paperWidthMm} in (58,80)`),
  check("print_device_name_length", sql`char_length(trim(${t.name})) between 1 and 80`),
  check("print_device_code_page_check", sql`${t.codePage} in ('pc858','pc850','wpc1252')`), check("print_device_render_mode_check", sql`${t.renderMode} in ('auto','text','raster')`)]);
/**
 * Tâche d'impression : identifiant unique transmis au service local (qui refuse d'imprimer deux fois la même tâche).
 * Une seule impression automatique d'origine par (vente, imprimante) ; une réimpression est une nouvelle tâche.
 * `uncertain` : résultat inconnu (coupure) ; c'est à la personne de dire si le ticket est sorti.
 */
export const printJob = pgTable("print_job", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  deviceId: text("device_id").notNull(), saleId: text("sale_id"), kind: text("kind").notNull(), status: text("status").notNull().default("pending"),
  reprintOfJobId: text("reprint_of_job_id"), errorCode: text("error_code"), createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.deviceId], foreignColumns: [printDevice.businessId, printDevice.id], name: "print_job_device_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.saleId], foreignColumns: [sale.businessId, sale.id], name: "print_job_sale_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "print_job_creator_membership_fk" }),
  uniqueIndex("print_job_one_original_receipt").on(t.businessId, t.saleId, t.deviceId).where(sql`${t.kind} = 'receipt' and ${t.reprintOfJobId} is null`),
  index("print_job_business_idx").on(t.businessId, t.createdAt),
  check("print_job_kind_check", sql`${t.kind} in ('receipt','test')`), check("print_job_status_check", sql`${t.status} in ('pending','printed','failed','uncertain','canceled')`),
  check("print_job_receipt_sale_check", sql`(${t.kind} = 'receipt') = (${t.saleId} is not null)`)]);

/* ------------------------------------------------------------------ Qadr Capture / Adapt (mission 11, phase 3) */

// Un import = un fichier lu (CSV ou XLSX), relu ligne par ligne, puis appliqué par les services métier.
// Les cellules d'origine restent sur chaque ligne (provenance) ; le fichier lui-même n'est pas conservé.
export const importBatch = pgTable("import_batch", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  kind: text("kind").notNull().default("catalog"), status: text("status").notNull().default("review"),
  fileName: text("file_name").notNull(), fileType: text("file_type").notNull(), fileSha256: text("file_sha256").notNull(), fileSize: integer("file_size").notNull(),
  sheetName: text("sheet_name"), headerRowNumber: integer("header_row_number"), columnCount: integer("column_count").notNull(), rowCount: integer("row_count").notNull(),
  mapping: jsonb("mapping").notNull(), mappingConfirmedAt: timestamp("mapping_confirmed_at", { withTimezone: true }), summary: jsonb("summary"),
  createdByUserId: text("created_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), appliedAt: timestamp("applied_at", { withTimezone: true }),
}, (t) => [unique("import_batch_business_id_unique").on(t.businessId, t.id),
  foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "import_batch_actor_membership_fk" }),
  // Le même fichier envoyé deux fois rouvre l'import existant au lieu d'en créer un second.
  uniqueIndex("import_batch_same_file_unique").on(t.businessId, t.kind, t.fileSha256).where(sql`${t.status} <> 'discarded'`),
  index("import_batch_business_idx").on(t.businessId, t.createdAt),
  check("import_batch_kind_check", sql`${t.kind} in ('catalog')`), check("import_batch_status_check", sql`${t.status} in ('review','applying','applied','discarded')`),
  check("import_batch_file_type_check", sql`${t.fileType} in ('csv','xlsx')`), check("import_batch_file_name_length", sql`char_length(${t.fileName}) between 1 and 200`),
  check("import_batch_sha_check", sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`), check("import_batch_counts_check", sql`${t.rowCount} between 0 and 1000 and ${t.columnCount} between 1 and 30 and ${t.fileSize} > 0`)]);

export const importRow = pgTable("import_row", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  batchId: text("batch_id").notNull(), rowNumber: integer("row_number").notNull(), cells: jsonb("cells").notNull(), edits: jsonb("edits").notNull().default({}),
  values: jsonb("values").notNull(), issues: jsonb("issues").notNull().default([]), candidates: jsonb("candidates").notNull().default([]),
  decision: text("decision"), decisionSource: text("decision_source"), matchVariantId: text("match_variant_id"), status: text("status").notNull(),
  appliedVariantId: text("applied_variant_id"), appliedAt: timestamp("applied_at", { withTimezone: true }), stockOpeningId: text("stock_opening_id"), stockNote: text("stock_note"),
}, (t) => [unique("import_row_business_id_unique").on(t.businessId, t.id),
  foreignKey({ columns: [t.businessId, t.batchId], foreignColumns: [importBatch.businessId, importBatch.id], name: "import_row_batch_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.matchVariantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "import_row_match_variant_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.appliedVariantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "import_row_applied_variant_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.stockOpeningId], foreignColumns: [stockOpening.businessId, stockOpening.id], name: "import_row_stock_opening_tenant_fk" }),
  unique("import_row_batch_number_unique").on(t.businessId, t.batchId, t.rowNumber),
  check("import_row_decision_check", sql`${t.decision} is null or ${t.decision} in ('create','match','skip')`),
  check("import_row_decision_source_check", sql`(${t.decision} is null) = (${t.decisionSource} is null) and (${t.decisionSource} is null or ${t.decisionSource} in ('auto','user'))`),
  check("import_row_match_check", sql`(${t.decision} = 'match') = (${t.matchVariantId} is not null)`),
  check("import_row_status_check", sql`${t.status} in ('ready','needs_review','invalid','skipped','applied')`),
  check("import_row_applied_check", sql`(${t.status} = 'applied') = (${t.appliedAt} is not null) and (${t.appliedAt} is null) = (${t.appliedVariantId} is null)`)]);

// Mots du commerçant confirmés pour un produit (« ciment cimaf » → « Ciment CIMAF 50 kg »), propres à ce commerce.
export const productAlias = pgTable("product_alias", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  variantId: text("variant_id").notNull(), alias: text("alias").notNull(), normalized: text("normalized").notNull(),
  createdByUserId: text("created_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("product_alias_business_id_unique").on(t.businessId, t.id),
  foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "product_alias_variant_tenant_fk" }),
  foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "product_alias_actor_membership_fk" }),
  uniqueIndex("product_alias_normalized_unique").on(t.businessId, t.normalized),
  check("product_alias_length_check", sql`char_length(${t.alias}) between 1 and 160 and char_length(${t.normalized}) between 1 and 160`)]);

export const authSchema = { user, session, account, verification, organization, member, invitation };
export const databaseSchema = {
  ...authSchema, businessProfile, businessMemberAccess, platformAdmin, receiptSettings, cashSession, cashMovement, productCategory, product, productVariant,
  customer, sale, saleLine, payment, paymentRefund, receivablePayment, supplier, purchase, purchaseLine,
  purchasePayment, openingBalance, openingBalancePayment, inventorySession, inventoryScopeVariant, inventoryLine, stockOpening, stockOpeningLine, stockMovement, expense, subscriptionPlan,
  promotionCode, promotionEligibleBusiness, businessSubscription, subscriptionPayment, promotionRedemption, auditEvent, paymentProviderEvent, idempotencyRecord,
  importBatch, importRow, productAlias,
};
