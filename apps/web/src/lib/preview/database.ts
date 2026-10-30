import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { databaseSchema } from "@/lib/db/schema";
import { createSale } from "@/lib/domain/commercial";
import { recordInventoryCount, startInventory, submitInventory, validateInventory } from "@/lib/domain/inventory";
import { inventoryScopeVariant, productVariant } from "@/lib/db/schema";
import type { PGlite } from "@electric-sql/pglite";

const PREVIEW_BUSINESS_ID = "qadr-preview-commerce";
const PREVIEW_USER_ID = "qadr-preview-owner";
const PREVIEW_PLATFORM_USER_ID = "qadr-preview-platform-admin";

type PreviewDatabase = PgliteDatabase<typeof databaseSchema>;
type PreviewState = { db: PreviewDatabase; ready: Promise<void> };
const PREVIEW_KEY = Symbol.for("qadr-ops.preview-database");
type PreviewGlobal = typeof globalThis & { [PREVIEW_KEY]?: PreviewState };

/** This demo data store is reachable only through the explicit local preview launcher. */
export async function getPreviewDatabase() {
  if (process.env.NODE_ENV !== "development" || process.env.QADR_PREVIEW_MODE !== "true") {
    throw new Error("La base de démonstration est réservée au lancement local explicite.");
  }

  const global = globalThis as PreviewGlobal;
  if (!global[PREVIEW_KEY]) {
    const [{ PGlite }, { drizzle: createPgliteDrizzle }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
    ]);
    const client = new PGlite();
    const db = createPgliteDrizzle(client, { schema: databaseSchema });
    const ready = initializeDemoData(client, db);
    global[PREVIEW_KEY] = { db, ready } as PreviewState;
  }

  await global[PREVIEW_KEY]!.ready;
  return global[PREVIEW_KEY]!.db;
}

export async function initializeDemoData(client: PGlite, db: PreviewDatabase) {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const { rows } = await client.query<{ count: string }>("select count(*)::text as count from organization where id=$1", [PREVIEW_BUSINESS_ID]);
  if (rows[0]?.count !== "0") return;

  await client.query("insert into \"user\" (id,name,email) values ($1,$2,$3),($4,$5,$6),($7,$8,$9)", [
    PREVIEW_USER_ID, "Équipe Démo QADR", "preview@qadr.local",
    PREVIEW_PLATFORM_USER_ID, "Administration Démo QADR", "platform-preview@qadr.local",
    "qadr-preview-stock-manager", "Responsable stock démo", "stock-preview@qadr.local",
  ]);
  await client.query("insert into platform_admin (user_id) values ($1)", [PREVIEW_PLATFORM_USER_ID]);
  await client.query("insert into organization (id,name,slug,metadata,logo) values ($1,$2,$3,$4,$5)", [PREVIEW_BUSINESS_ID, "Commerce Démo QADR", "qadr-preview-commerce", JSON.stringify({ preview: true }), "/qadr-preview-mark.svg"]);
  await client.query("insert into business_profile (business_id,activity,phone,address,currency,timezone,status,primary_color) values ($1,'general','+225 00 00 00 00','Espace de démonstration','XOF','Africa/Abidjan','active','#2563EB')", [PREVIEW_BUSINESS_ID]);
  await client.query("insert into member (id,organization_id,user_id,role) values ($1,$2,$3,'owner')", ["qadr-preview-member", PREVIEW_BUSINESS_ID, PREVIEW_USER_ID]);
  await client.query("insert into member (id,organization_id,user_id,role) values ($1,$2,$3,'stock_manager')", ["qadr-preview-stock-member", PREVIEW_BUSINESS_ID, "qadr-preview-stock-manager"]);
  await client.query("insert into receipt_settings (business_id,paper_width_mm,show_logo,footer) values ($1,58,true,'Merci de votre visite — Démonstration')", [PREVIEW_BUSINESS_ID]);

  const now = new Date();
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);
  const tenantFixtures = [
    { id: "qadr-preview-phones", name: "Atelier Mobile Démo", slug: "demo-at-mobile", activity: "phones", status: "active", user: "qadr-preview-phones-owner", email: "phones@preview.qadr.local", plan: "qadr-preview-plan-pro", subStatus: "active", start: -12, end: 18, trial: null },
    { id: "qadr-preview-textile", name: "Maison Textile Démo", slug: "demo-maison-textile", activity: "clothing", status: "suspended", user: "qadr-preview-textile-owner", email: "textile@preview.qadr.local", plan: "qadr-preview-plan-starter", subStatus: "suspended", start: -38, end: -8, trial: null },
    { id: "qadr-preview-hardware", name: "Comptoir Bricolage Démo", slug: "demo-comptoir-bricolage", activity: "hardware", status: "active", user: "qadr-preview-hardware-owner", email: "hardware@preview.qadr.local", plan: "qadr-preview-plan-starter", subStatus: "active", start: -2, end: 28, trial: 5 },
    { id: "qadr-preview-general", name: "Épicerie des Saisons Démo", slug: "demo-epicerie-saisons", activity: "general", status: "expired", user: "qadr-preview-general-owner", email: "general@preview.qadr.local", plan: "qadr-preview-plan-starter", subStatus: "expired", start: -45, end: -15, trial: -6 },
  ];
  for (const tenant of tenantFixtures) {
    await client.query("insert into \"user\" (id,name,email) values ($1,$2,$3)", [tenant.user, `Compte ${tenant.name}`, tenant.email]);
    await client.query("insert into organization (id,name,slug,metadata) values ($1,$2,$3,$4)", [tenant.id, tenant.name, tenant.slug, JSON.stringify({ preview: true })]);
    await client.query("insert into business_profile (business_id,activity,phone,address,currency,timezone,status,primary_color) values ($1,$2,'+225 00 00 00 00','Espace de démonstration','XOF','Africa/Abidjan',$3,'#2563EB')", [tenant.id, tenant.activity, tenant.status]);
    await client.query("insert into member (id,organization_id,user_id,role) values ($1,$2,$3,'owner')", [`member-${tenant.id}`, tenant.id, tenant.user]);
  }

  const planFeatures = JSON.stringify({ pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null });
  const starterFeatures = JSON.stringify({ pos: true, reports: true, inventory: true, procurement: false, productLimit: 250, userLimit: 5 });
  await client.query("insert into subscription_plan (id,code,name,price_xof,duration_days,active,features) values ($1,'STARTER','Essentiel',5000,30,true,$2),($3,'PRO','Équipe',15000,30,true,$4)", [
    "qadr-preview-plan-starter", starterFeatures, "qadr-preview-plan-pro", planFeatures,
  ]);
  const tenantsWithPlans = [
    { id: PREVIEW_BUSINESS_ID, plan: "qadr-preview-plan-starter", status: "active", start: -6, end: 24, trial: 8 },
    ...tenantFixtures.map((tenant) => ({ id: tenant.id, plan: tenant.plan, status: tenant.subStatus, start: tenant.start, end: tenant.end, trial: tenant.trial })),
  ];
  const subscriptionIds = new Map<string, string>();
  for (const tenant of tenantsWithPlans) {
    const subscriptionId = `sub-${tenant.id}`;
    subscriptionIds.set(tenant.id, subscriptionId);
    await client.query("insert into business_subscription (id,business_id,plan_id,status,starts_at,ends_at,trial_ends_at) values ($1,$2,$3,$4,$5,$6,$7)", [
      subscriptionId, tenant.id, tenant.plan, tenant.status, day(tenant.start), day(tenant.end), tenant.trial === null ? null : day(tenant.trial),
    ]);
  }
  await client.query("insert into subscription_payment (id,business_id,subscription_id,amount_xof,method,status,idempotency_key,provider_reference,occurred_at,confirmed_at) values ($1,$2,$3,15000,'wave','confirmed','preview-paid-001','DEMO-SUB-001',$4,$4)", [
    "qadr-preview-subscription-payment", "qadr-preview-phones", subscriptionIds.get("qadr-preview-phones"), day(-11),
  ]);
  await client.query("insert into promotion_code (id,code,discount_percent,discount_xof,starts_at,ends_at,max_redemptions,active) values ($1,'BIENVENUE10',10,null,$2,$3,12,true),($4,'LANCEMENT5000',null,5000,$2,$3,4,true)", [
    "qadr-preview-promo-percent", day(-30), day(30), "qadr-preview-promo-fixed",
  ]);
  await client.query("insert into promotion_eligible_business (promotion_id,business_id) values ($1,$2),($3,$2)", [
    "qadr-preview-promo-percent", "qadr-preview-phones", "qadr-preview-promo-fixed",
  ]);
  await client.query("insert into promotion_redemption (id,promotion_id,business_id,subscription_id,code_snapshot,discount_amount_xof,redeemed_at) values ($1,$2,$3,$4,'BIENVENUE10',1500,$5)", [
    "qadr-preview-redemption", "qadr-preview-promo-percent", "qadr-preview-phones", subscriptionIds.get("qadr-preview-phones"), day(-10),
  ]);
  await client.query("insert into audit_event (id,business_id,actor_user_id,event_type,entity_type,entity_id,metadata,occurred_at) values ($1,null,$2,'platform.business_suspended','business',$3,$4,$5),($6,null,$2,'platform.plan_created','subscription_plan',$7,$8,$5)", [
    "qadr-preview-audit-suspend", PREVIEW_PLATFORM_USER_ID, "qadr-preview-textile", JSON.stringify({ previousStatus: "active", newStatus: "suspended" }), day(-1),
    "qadr-preview-audit-plan", "qadr-preview-plan-starter", JSON.stringify({ code: "STARTER" }),
  ]);

  const categories = [
    ["qadr-cat-hardware", "Quincaillerie"],
    ["qadr-cat-phones", "Téléphonie"],
    ["qadr-cat-clothing", "Vêtements"],
    ["qadr-cat-general", "Boutique générale"],
  ];
  for (const [id, name] of categories) {
    await client.query("insert into product_category (id,business_id,name) values ($1,$2,$3)", [id, PREVIEW_BUSINESS_ID, name]);
  }

  const items = [
    { id: "qadr-prod-paint", variant: "qadr-var-paint", category: categories[0][0], name: "Peinture blanche 20 L", label: "Pot", sku: "PEI-020", price: 28000, qty: "8", cost: "19000", threshold: "3" },
    { id: "qadr-prod-cement", variant: "qadr-var-cement", category: categories[0][0], name: "Ciment 50 kg", label: "Sac", sku: "CIM-050", price: 6500, qty: "36", cost: "4800", threshold: "12" },
    { id: "qadr-prod-screws", variant: "qadr-var-screws", category: categories[0][0], name: "Vis bois 6 cm", label: "Boîte", sku: "VIS-060", price: 1800, qty: "4", cost: "900", threshold: "8" },
    { id: "qadr-prod-phone", variant: "qadr-var-phone", category: categories[1][0], name: "Téléphone Android 128 Go", label: "Noir", sku: "TEL-128-N", price: 95000, qty: "5", cost: "72000", threshold: "2" },
    { id: "qadr-prod-cable", variant: "qadr-var-cable", category: categories[1][0], name: "Câble USB-C renforcé", label: "1 m", sku: "ACC-USBC-1", price: 3500, qty: "17", cost: "1600", threshold: "5" },
    { id: "qadr-prod-shirt", variant: "qadr-var-shirt", category: categories[2][0], name: "Polo classique", label: "M · Bleu", sku: "POL-M-BL", price: 12000, qty: "7", cost: "6500", threshold: "3" },
    { id: "qadr-prod-jeans", variant: "qadr-var-jeans", category: categories[2][0], name: "Jean coupe droite", label: "L · Indigo", sku: "JEA-L-IN", price: 18000, qty: "2", cost: "9800", threshold: "4" },
    { id: "qadr-prod-rice", variant: "qadr-var-rice", category: categories[3][0], name: "Riz parfumé 5 kg", label: "Sac", sku: "ALI-RIZ-5", price: 4500, qty: "21", cost: "3200", threshold: "6" },
  ];
  for (const item of items) {
    await client.query("insert into product (id,business_id,category_id,name,base_unit) values ($1,$2,$3,$4,$5)", [item.id, PREVIEW_BUSINESS_ID, item.category, item.name, item.label]);
    await client.query("insert into product_variant (id,business_id,product_id,label,sku,sale_price_xof,on_hand,average_cost_xof,cost_known,low_stock_threshold) values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)", [item.variant, PREVIEW_BUSINESS_ID, item.id, item.label, item.sku, item.price, item.qty, item.cost, item.threshold]);
  }

  await client.query("insert into customer (id,business_id,name,phone,notes) values ('qadr-preview-customer-1',$1,'Client Démo A','+225 01 00 00 01','Compte fictif pour la prévisualisation'),('qadr-preview-customer-2',$1,'Client Démo B','+225 01 00 00 02','Compte fictif pour la prévisualisation')", [PREVIEW_BUSINESS_ID]);
  await client.query("insert into supplier (id,business_id,name,phone) values ('qadr-preview-supplier-1',$1,'Fournisseur Démo','+225 01 00 00 10')", [PREVIEW_BUSINESS_ID]);
  await client.query("insert into expense (id,business_id,category,description,amount_xof,paid_by_user_id) values ('qadr-preview-expense-1',$1,'transport','Transport du jour',2500,$2)", [PREVIEW_BUSINESS_ID, PREVIEW_USER_ID]);

  // Synthetic opening stock is represented as received purchase lines and traceable movements.
  const purchaseId = randomUUID();
  await client.query("insert into purchase (id,business_id,supplier_id,reference,status,total_xof) values ($1,$2,$3,$4,'received',$5)", [purchaseId, PREVIEW_BUSINESS_ID, "qadr-preview-supplier-1", "DEMO-OPENING-001", 0]);
  for (const item of items) {
    const lineId = randomUUID();
    const lineTotal = (BigInt(item.qty) * BigInt(item.cost)).toString();
    await client.query("insert into purchase_line (id,business_id,purchase_id,variant_id,quantity,unit_cost_xof,line_total_xof) values ($1,$2,$3,$4,$5,$6,$7)", [lineId, PREVIEW_BUSINESS_ID, purchaseId, item.variant, item.qty, item.cost, lineTotal]);
    await client.query("insert into stock_movement (id,business_id,variant_id,quantity_delta,reason,purchase_line_id,unit_cost_xof,created_by_user_id) values ($1,$2,$3,$4,'purchase',$5,$6,$7)", [randomUUID(), PREVIEW_BUSINESS_ID, item.variant, item.qty, lineId, item.cost, PREVIEW_USER_ID]);
  }
  await client.query("update purchase set total_xof=(select sum(line_total_xof) from purchase_line where purchase_id=$1) where id=$1", [purchaseId]);

  // Exercise the same atomic sale path used by the cashier; these records are explicitly fictitious.
  const firstSale = await createSale(db as never, {
    businessId: PREVIEW_BUSINESS_ID,
    actorUserId: PREVIEW_USER_ID,
    idempotencyKey: "qadr-preview-seed-sale-001",
    lines: [{ variantId: "qadr-var-cement", quantity: "2" }, { variantId: "qadr-var-rice", quantity: "1" }],
    payments: [{ method: "cash", amountXof: "17500" }],
  });
  const secondSale = await createSale(db as never, {
    businessId: PREVIEW_BUSINESS_ID,
    actorUserId: PREVIEW_USER_ID,
    customerId: "qadr-preview-customer-1",
    idempotencyKey: "qadr-preview-seed-sale-002",
    lines: [{ variantId: "qadr-var-cable", quantity: "2" }, { variantId: "qadr-var-shirt", quantity: "1" }],
    payments: [{ method: "cash", amountXof: "5000" }, { method: "wave", amountXof: "3500" }],
  });
  const thirdSale = await createSale(db as never, {
    businessId: PREVIEW_BUSINESS_ID, actorUserId: PREVIEW_USER_ID, customerId: "qadr-preview-customer-2",
    idempotencyKey: "qadr-preview-seed-sale-003", lines: [{ variantId: "qadr-var-phone", quantity: "1" }],
    payments: [{ method: "cash", amountXof: "20000" }],
  });
  const demoSales = [
    { id: firstSale.id, date: day(0) }, { id: secondSale.id, date: day(-3) }, { id: thirdSale.id, date: day(-9) },
  ];
  for (const item of demoSales) {
    await client.query("update sale set occurred_at=$1 where id=$2", [item.date, item.id]);
    await client.query("update payment set occurred_at=$1, confirmed_at=case when status='confirmed' then $1 else confirmed_at end where sale_id=$2", [item.date, item.id]);
    await client.query("update stock_movement set occurred_at=$1 where sale_line_id in (select id from sale_line where sale_id=$2)", [item.date, item.id]);
  }
  const { rows: salePayments } = await client.query<{ id: string }>("select id from payment where sale_id=$1 and status='confirmed' limit 1", [secondSale.id]);
  if (salePayments[0]) {
    await client.query("update payment set status='partially_refunded' where id=$1", [salePayments[0].id]);
    await client.query("update sale set status='partially_refunded' where id=$1", [secondSale.id]);
    await client.query("insert into payment_refund (id,business_id,payment_id,amount_xof,status,reference,created_by_user_id,occurred_at) values ($1,$2,$3,2500,'confirmed','DEMO-REFUND-001',$4,$5)", [
      "qadr-preview-refund", PREVIEW_BUSINESS_ID, salePayments[0].id, PREVIEW_USER_ID, day(-2),
    ]);
  }

  // A full, validated synthetic count is generated through the real inventory workflow.
  const inventory = await startInventory(db as never, { businessId: PREVIEW_BUSINESS_ID, actorUserId: PREVIEW_USER_ID });
  const scope = await db.select({ variantId: inventoryScopeVariant.variantId }).from(inventoryScopeVariant)
    .where(sql`business_id = ${PREVIEW_BUSINESS_ID} and session_id = ${inventory.id}`);
  const variants = await db.select({ id: productVariant.id, onHand: productVariant.onHand }).from(productVariant)
    .where(sql`business_id = ${PREVIEW_BUSINESS_ID}`);
  for (const variant of variants) {
    if (!scope.some((entry) => entry.variantId === variant.id)) continue;
    const countedQty = variant.id === "qadr-var-screws" ? "3" : variant.onHand;
    await recordInventoryCount(db as never, { businessId: PREVIEW_BUSINESS_ID, actorUserId: PREVIEW_USER_ID, sessionId: inventory.id,
      variantId: variant.id, countedQty, ...(variant.id === "qadr-var-screws" ? { adjustmentReason: "Écart constaté lors du contrôle de démonstration" } : {}) });
  }
  await submitInventory(db as never, { businessId: PREVIEW_BUSINESS_ID, actorUserId: PREVIEW_USER_ID, sessionId: inventory.id });
  await validateInventory(db as never, { businessId: PREVIEW_BUSINESS_ID, actorUserId: "qadr-preview-stock-manager", sessionId: inventory.id });
}

export const previewIdentity = { businessId: PREVIEW_BUSINESS_ID, userId: PREVIEW_USER_ID, platformUserId: PREVIEW_PLATFORM_USER_ID } as const;
