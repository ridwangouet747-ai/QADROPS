import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey,
  text, timestamp, unique, uniqueIndex,
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

export const businessProfile = pgTable("business_profile", {
  businessId: text("business_id").primaryKey().references(() => organization.id, { onDelete: "restrict" }),
  activity: text("activity").notNull(), phone: text("phone"), address: text("address"), businessEmail: text("business_email"),
  currency: text("currency").notNull().default("XOF"), timezone: text("timezone").notNull().default("Africa/Abidjan"),
  primaryColor: text("primary_color").notNull().default("#176B5B"), status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("business_activity_check", sql`${t.activity} in ('hardware','phones','general','clothing')`), check("business_currency_check", sql`${t.currency} = 'XOF'`), check("business_status_check", sql`${t.status} in ('pending','active','suspended','expired')`)]);
export const platformAdmin = pgTable("platform_admin", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  grantedByUserId: text("granted_by_user_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
export const receiptSettings = pgTable("receipt_settings", {
  businessId: text("business_id").primaryKey().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  paperWidthMm: integer("paper_width_mm").notNull().default(58), showLogo: boolean("show_logo").notNull().default(true),
  footer: text("footer"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("receipt_width_check", sql`${t.paperWidthMm} in (58,80)`)]);

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
}, (t) => [unique("customer_business_id_unique").on(t.businessId, t.id), index("customer_business_phone_idx").on(t.businessId, t.phone)]);
export const sale = pgTable("sale", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  reference: text("reference").notNull(), idempotencyKey: text("idempotency_key").notNull(), cashierUserId: text("cashier_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  customerId: text("customer_id"), status: text("status").notNull().default("completed"), subtotalXof: bigint("subtotal_xof", { mode: "bigint" }).notNull(),
  discountXof: bigint("discount_xof", { mode: "bigint" }).notNull().default(sql`0`), totalXof: bigint("total_xof", { mode: "bigint" }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("sale_business_id_unique").on(t.businessId, t.id), unique("sale_business_reference_unique").on(t.businessId, t.reference), unique("sale_business_idempotency_unique").on(t.businessId, t.idempotencyKey), foreignKey({ columns: [t.businessId, t.customerId], foreignColumns: [customer.businessId, customer.id], name: "sale_customer_tenant_fk" }), foreignKey({ columns: [t.businessId, t.cashierUserId], foreignColumns: [member.organizationId, member.userId], name: "sale_cashier_membership_tenant_fk" }), index("sale_business_occurred_idx").on(t.businessId, t.occurredAt), check("sale_amounts_check", sql`${t.subtotalXof} >= 0 and ${t.discountXof} >= 0 and ${t.totalXof} = ${t.subtotalXof} - ${t.discountXof}`), check("sale_status_check", sql`${t.status} in ('completed','partially_refunded','refunded','voided')`)]);
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
}, (t) => [unique("payment_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.saleId], foreignColumns: [sale.businessId, sale.id], name: "payment_sale_tenant_fk" }), foreignKey({ columns: [t.businessId, t.recordedByUserId], foreignColumns: [member.organizationId, member.userId], name: "payment_recorder_membership_tenant_fk" }), unique("payment_business_idempotency_unique").on(t.businessId, t.idempotencyKey), uniqueIndex("payment_provider_reference_unique").on(t.businessId, t.providerReference).where(sql`${t.providerReference} is not null`), index("payment_sale_status_idx").on(t.businessId, t.saleId, t.status), check("payment_amount_positive", sql`${t.amountXof} > 0`), check("payment_method_check", sql`${t.method} in ('cash','wave','orange_money','mtn_momo','other')`), check("payment_status_check", sql`${t.status} in ('pending','confirmed','failed','refunded','partially_refunded')`)]);
export const paymentRefund = pgTable("payment_refund", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), paymentId: text("payment_id").notNull(),
  amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), status: text("status").notNull().default("confirmed"), reference: text("reference").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("refund_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.paymentId], foreignColumns: [payment.businessId, payment.id], name: "refund_payment_tenant_fk" }), foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "refund_actor_membership_tenant_fk" }), unique("refund_business_reference_unique").on(t.businessId, t.reference), index("refund_payment_date_idx").on(t.businessId, t.paymentId, t.occurredAt), check("refund_amount_positive", sql`${t.amountXof} > 0`), check("refund_status_check", sql`${t.status} in ('pending','confirmed','failed')`)]);
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
}, (t) => [unique("purchase_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.supplierId], foreignColumns: [supplier.businessId, supplier.id], name: "purchase_supplier_tenant_fk" }), unique("purchase_business_reference_unique").on(t.businessId, t.reference), index("purchase_business_date_idx").on(t.businessId, t.occurredAt), check("purchase_total_nonnegative", sql`${t.totalXof} >= 0`), check("purchase_status_check", sql`${t.status} in ('draft','received','canceled')`)]);
export const purchaseLine = pgTable("purchase_line", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), purchaseId: text("purchase_id").notNull(), variantId: text("variant_id").notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), unitCostXof: bigint("unit_cost_xof", { mode: "bigint" }).notNull(), lineTotalXof: bigint("line_total_xof", { mode: "bigint" }).notNull(),
}, (t) => [unique("purchase_line_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.purchaseId], foreignColumns: [purchase.businessId, purchase.id], name: "purchase_line_purchase_tenant_fk" }), foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "purchase_line_variant_tenant_fk" }), check("purchase_line_qty_positive", sql`${t.quantity} > 0`), check("purchase_line_amount_nonnegative", sql`${t.unitCostXof} >= 0 and ${t.lineTotalXof} >= 0`)]);
export const purchasePayment = pgTable("purchase_payment", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), purchaseId: text("purchase_id").notNull(),
  amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(), method: text("method").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.purchaseId], foreignColumns: [purchase.businessId, purchase.id], name: "purchase_payment_tenant_fk" }), check("purchase_payment_positive", sql`${t.amountXof} > 0`)]);

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

export const stockMovement = pgTable("stock_movement", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), variantId: text("variant_id").notNull(),
  quantityDelta: numeric("quantity_delta", { precision: 24, scale: 6 }).notNull(), reason: text("reason").notNull(),
  saleLineId: text("sale_line_id"), purchaseLineId: text("purchase_line_id"), inventoryLineId: text("inventory_line_id"),
  unitCostXof: numeric("unit_cost_xof", { precision: 30, scale: 12 }), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.businessId, t.variantId], foreignColumns: [productVariant.businessId, productVariant.id], name: "stock_movement_variant_tenant_fk" }), foreignKey({ columns: [t.businessId, t.saleLineId], foreignColumns: [saleLine.businessId, saleLine.id], name: "stock_movement_sale_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.purchaseLineId], foreignColumns: [purchaseLine.businessId, purchaseLine.id], name: "stock_movement_purchase_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.inventoryLineId], foreignColumns: [inventoryLine.businessId, inventoryLine.id], name: "stock_movement_inventory_line_tenant_fk" }), foreignKey({ columns: [t.businessId, t.createdByUserId], foreignColumns: [member.organizationId, member.userId], name: "stock_movement_actor_membership_tenant_fk" }), uniqueIndex("stock_movement_sale_line_unique").on(t.businessId, t.saleLineId).where(sql`${t.saleLineId} is not null`), uniqueIndex("stock_movement_purchase_line_unique").on(t.businessId, t.purchaseLineId).where(sql`${t.purchaseLineId} is not null`), uniqueIndex("stock_movement_inventory_line_unique").on(t.businessId, t.inventoryLineId).where(sql`${t.inventoryLineId} is not null`), index("stock_movement_variant_date_idx").on(t.businessId, t.variantId, t.occurredAt), check("stock_movement_source_one_check", sql`num_nonnulls(${t.saleLineId}, ${t.purchaseLineId}, ${t.inventoryLineId}) = 1`), check("stock_movement_delta_nonzero", sql`${t.quantityDelta} <> 0`), check("stock_movement_reason_check", sql`${t.reason} in ('sale','purchase','inventory_adjustment','manual_adjustment','return')`)]);

export const expense = pgTable("expense", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  category: text("category").notNull(), description: text("description").notNull(), amountXof: bigint("amount_xof", { mode: "bigint" }).notNull(),
  paidByUserId: text("paid_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("expense_business_id_unique").on(t.businessId, t.id), foreignKey({ columns: [t.businessId, t.paidByUserId], foreignColumns: [member.organizationId, member.userId], name: "expense_actor_membership_tenant_fk" }), index("expense_business_date_idx").on(t.businessId, t.occurredAt), check("expense_positive", sql`${t.amountXof} > 0`)]);

export const subscriptionPlan = pgTable("subscription_plan", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), name: text("name").notNull(), priceXof: bigint("price_xof", { mode: "bigint" }).notNull(),
  durationDays: integer("duration_days").notNull(), active: boolean("active").notNull().default(true), features: jsonb("features").notNull().default({}),
}, (t) => [check("plan_amount_duration_check", sql`${t.priceXof} >= 0 and ${t.durationDays} > 0`)]);
export const promotionCode = pgTable("promotion_code", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), discountPercent: integer("discount_percent"), discountXof: bigint("discount_xof", { mode: "bigint" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }), maxRedemptions: integer("max_redemptions"), active: boolean("active").notNull().default(true),
}, (t) => [check("promotion_discount_check", sql`(${t.discountPercent} between 1 and 100 and ${t.discountXof} is null) or (${t.discountXof} > 0 and ${t.discountPercent} is null)`), check("promotion_limit_positive", sql`${t.maxRedemptions} is null or ${t.maxRedemptions} > 0`), check("promotion_validity_order", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`)]);
export const promotionEligibleBusiness = pgTable("promotion_eligible_business", {
  promotionId: text("promotion_id").notNull().references(() => promotionCode.id, { onDelete: "restrict" }),
  businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.promotionId, t.businessId], name: "promotion_eligible_business_pk" })]);
export const businessSubscription = pgTable("business_subscription", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), planId: text("plan_id").notNull().references(() => subscriptionPlan.id, { onDelete: "restrict" }),
  status: text("status").notNull(), startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(), trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  providerReference: text("provider_reference"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("subscription_business_id_unique").on(t.businessId, t.id), index("subscription_business_status_idx").on(t.businessId, t.status, t.endsAt), check("subscription_status_check", sql`${t.status} in ('pending','active','suspended','expired','canceled')`)]);
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
}, (t) => [index("audit_business_date_idx").on(t.businessId, t.occurredAt), index("audit_entity_idx").on(t.entityType, t.entityId)]);
export const paymentProviderEvent = pgTable("payment_provider_event", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), provider: text("provider").notNull(), eventId: text("event_id").notNull(),
  paymentId: text("payment_id"), subscriptionPaymentId: text("subscription_payment_id"), payloadHash: text("payload_hash").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [unique("provider_event_idempotency_unique").on(t.businessId, t.provider, t.eventId), foreignKey({ columns: [t.businessId, t.paymentId], foreignColumns: [payment.businessId, payment.id], name: "provider_event_store_payment_tenant_fk" }), foreignKey({ columns: [t.businessId, t.subscriptionPaymentId], foreignColumns: [subscriptionPayment.businessId, subscriptionPayment.id], name: "provider_event_subscription_payment_tenant_fk" }), index("provider_event_business_received_idx").on(t.businessId, t.receivedAt), check("provider_event_single_target_check", sql`num_nonnulls(${t.paymentId}, ${t.subscriptionPaymentId}) <= 1`)]);
// Client-generated operation keys, scoped per business: a retried command returns its first result instead of running twice.
export const idempotencyRecord = pgTable("idempotency_record", {
  businessId: text("business_id").notNull().references(() => businessProfile.businessId, { onDelete: "restrict" }), idempotencyKey: text("idempotency_key").notNull(),
  operation: text("operation").notNull(), requestHash: text("request_hash").notNull(), actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  result: jsonb("result").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ name: "idempotency_record_pk", columns: [t.businessId, t.idempotencyKey] }), check("idempotency_key_length_check", sql`char_length(${t.idempotencyKey}) between 8 and 128`), check("idempotency_operation_check", sql`${t.operation} in ('purchase.receive','expense.create','receivable.payment')`)]);

export const authSchema = { user, session, account, verification, organization, member, invitation };
export const databaseSchema = {
  ...authSchema, businessProfile, platformAdmin, receiptSettings, productCategory, product, productVariant,
  customer, sale, saleLine, payment, paymentRefund, receivablePayment, supplier, purchase, purchaseLine,
  purchasePayment, inventorySession, inventoryScopeVariant, inventoryLine, stockMovement, expense, subscriptionPlan,
  promotionCode, promotionEligibleBusiness, businessSubscription, subscriptionPayment, promotionRedemption, auditEvent, paymentProviderEvent, idempotencyRecord,
};
