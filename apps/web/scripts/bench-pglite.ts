/**
 * Mesure locale des lectures et écritures les plus sollicitées, sur PGlite en mémoire (mission 11, phase 6).
 *
 *   npx tsx scripts/bench-pglite.ts            (depuis apps/web ; aucune base distante n'est contactée)
 *   BENCH_RUNS=7 npx tsx scripts/bench-pglite.ts
 *
 * Jeu de données synthétique, chargé par SQL (generate_series) : 2 commerces, chacun avec 5 000 produits,
 * 1 500 clients, 150 fournisseurs, 20 000 ventes de 2 lignes réparties sur 400 jours, leurs paiements et
 * sorties de stock, 3 000 dépenses, 600 achats et 100 anciennes dettes. Les noms sont fictifs.
 *
 * Pour chaque opération : nombre de requêtes SQL envoyées (compté par le logger Drizzle, donc hors
 * BEGIN/COMMIT) et durée médiane sur BENCH_RUNS passages après un passage de chauffe.
 * PGlite tourne dans le processus, sans réseau : les durées ne sont PAS représentatives de Neon, où chaque
 * aller-retour coûte la latence réseau. Le nombre de requêtes est l'indicateur transposable.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { databaseSchema } from "../src/lib/db/schema";
import type { CommercialDatabase } from "../src/lib/domain/commercial";
import * as businessData from "../src/lib/domain/business-data";
import { createSale } from "../src/lib/domain/commercial";
import { getCommercialReport } from "../src/lib/domain/reports";

const PRODUCTS = 5_000;
const CUSTOMERS = 1_500;
const SUPPLIERS = 150;
const SALES = 20_000;
const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 5));

const counter = { queries: 0 };
const client = new PGlite();
const db = drizzle(client, { schema: databaseSchema, logger: { logQuery: () => { counter.queries += 1; } } }) as unknown as CommercialDatabase;

async function seedBusiness(businessId: string, ownerId: string) {
  const run = (text: string) => client.query(text, text.includes("$2") ? [businessId, ownerId] : [businessId]);
  await run(`insert into product_category(id,business_id,name) select $1||'-c-'||g, $1, 'Catégorie '||g from generate_series(1,20) g`);
  await run(`insert into product(id,business_id,category_id,name) select $1||'-p-'||g, $1, $1||'-c-'||(1+g%20), 'Article '||lpad(g::text,5,'0') from generate_series(1,${PRODUCTS}) g`);
  // Seuil d'alerte au-dessus du stock pour un produit sur dix : la carte « stock faible » n'est pas vide.
  await run(`insert into product_variant(id,business_id,product_id,label,sku,sale_price_xof,on_hand,average_cost_xof,cost_known,low_stock_threshold)
    select $1||'-v-'||g, $1, $1||'-p-'||g, 'Standard', $1||'-SKU-'||g, 1000+(g%50)*100, 100000, 600+(g%50)*50, true, case when g%10=0 then 200000 else 5 end
    from generate_series(1,${PRODUCTS}) g`);
  await run(`insert into customer(id,business_id,name,phone) select $1||'-cu-'||g, $1, 'Client '||lpad(g::text,4,'0'), '07'||lpad(g::text,8,'0') from generate_series(1,${CUSTOMERS}) g`);
  await run(`insert into supplier(id,business_id,name) select $1||'-su-'||g, $1, 'Fournisseur '||lpad(g::text,3,'0') from generate_series(1,${SUPPLIERS}) g`);
  // Un tiers des ventes est rattaché à un client (crédit possible) ; total = somme de deux lignes d'une unité.
  await run(`insert into sale(id,business_id,reference,idempotency_key,cashier_user_id,customer_id,status,subtotal_xof,discount_xof,total_xof,occurred_at)
    select $1||'-s-'||g, $1, 'V-'||g, 'bench-'||g, $2, case when g%3=0 then $1||'-cu-'||(1+g%${CUSTOMERS}) end, 'completed', t.total, 0, t.total,
      now() - ((g%400)||' days')::interval - ((g%1440)||' minutes')::interval
    from generate_series(1,${SALES}) g, lateral (select (1000+((1+(g*7)%${PRODUCTS})%50)*100) + (1000+((1+(g*13)%${PRODUCTS})%50)*100) as total) t`);
  await run(`insert into sale_line(id,business_id,sale_id,variant_id,product_name_snapshot,quantity,unit_price_xof,line_total_xof,unit_cost_snapshot_xof,cogs_xof,cost_available)
    select $1||'-sl-'||g||'-'||k, $1, $1||'-s-'||g, $1||'-v-'||v, 'Article '||lpad(v::text,5,'0'), 1, 1000+(v%50)*100, 1000+(v%50)*100, 600+(v%50)*50, 600+(v%50)*50, true
    from generate_series(1,${SALES}) g, (values (1,7),(2,13)) m(k,f), lateral (select 1+(g*f)%${PRODUCTS} as v) x`);
  await run(`insert into stock_movement(id,business_id,variant_id,quantity_delta,reason,sale_line_id,unit_cost_xof,created_by_user_id,occurred_at)
    select 'm-'||l.id, l.business_id, l.variant_id, -l.quantity, 'sale', l.id, l.unit_cost_snapshot_xof, $2, s.occurred_at
    from sale_line l join sale s on s.business_id=l.business_id and s.id=l.sale_id where l.business_id=$1`);
  // Comptant payé en totalité ; ventes à crédit : la moitié payée au comptoir une fois sur deux.
  await run(`insert into payment(id,business_id,sale_id,method,amount_xof,status,recorded_by_user_id,idempotency_key,occurred_at,confirmed_at)
    select $1||'-pay-'||s.g, $1, s.id, case when s.g%5=0 then 'wave' else 'cash' end, case when s.g%3=0 then s.total_xof/2 else s.total_xof end, 'confirmed', $2, 'bench-pay-'||s.g, s.occurred_at, s.occurred_at
    from (select id, total_xof, occurred_at, split_part(id,'-s-',2)::int as g from sale where business_id=$1) s where s.g%3<>0 or s.g%2=0`);
  // Règlements ultérieurs d'une partie des créances (paiement + receivable_payment).
  await run(`insert into payment(id,business_id,sale_id,method,amount_xof,status,recorded_by_user_id,idempotency_key,occurred_at,confirmed_at)
    select $1||'-rec-'||s.g, $1, s.id, 'cash', s.total_xof/4, 'confirmed', $2, 'bench-rec-'||s.g, s.occurred_at + interval '5 days', s.occurred_at + interval '5 days'
    from (select id, total_xof, occurred_at, split_part(id,'-s-',2)::int as g from sale where business_id=$1) s where s.g%12=0`);
  await run(`insert into receivable_payment(id,business_id,sale_id,payment_id,applied_amount_xof)
    select 'rp-'||p.id, p.business_id, p.sale_id, p.id, p.amount_xof from payment p where p.business_id=$1 and p.id like $1||'-rec-%'`);
  await run(`insert into expense(id,business_id,category,description,amount_xof,paid_by_user_id,occurred_at,payment_method)
    select $1||'-e-'||g, $1, (array['transport','rent','utilities','supplies','other'])[1+g%5], 'Dépense '||g, 500+(g%40)*250, $2, now() - ((g%400)||' days')::interval, 'cash'
    from generate_series(1,3000) g`);
  await run(`insert into purchase(id,business_id,supplier_id,reference,status,total_xof,occurred_at)
    select $1||'-pu-'||g, $1, $1||'-su-'||(1+g%${SUPPLIERS}), 'ACH-'||g, 'received', 60000, now() - ((g%400)||' days')::interval from generate_series(1,600) g`);
  await run(`insert into purchase_line(id,business_id,purchase_id,variant_id,quantity,unit_cost_xof,line_total_xof)
    select $1||'-pl-'||g, $1, $1||'-pu-'||g, $1||'-v-'||(1+(g*11)%${PRODUCTS}), 100, 600, 60000 from generate_series(1,600) g`);
  await run(`insert into purchase_payment(id,business_id,purchase_id,amount_xof,method,occurred_at)
    select $1||'-pp-'||g, $1, $1||'-pu-'||g, 30000, 'cash', now() - ((g%400)||' days')::interval from generate_series(1,600) g`);
  await run(`insert into opening_balance(id,business_id,party_type,customer_id,amount_xof,as_of_date,created_by_user_id)
    select $1||'-ob-'||g, $1, 'customer', $1||'-cu-'||g, 25000, current_date - 400, $2 from generate_series(1,100) g`);
  await run(`insert into audit_event(id,business_id,actor_user_id,event_type,entity_type,entity_id,occurred_at)
    select $1||'-a-'||g, $1, $2, 'sale.created', 'sale', $1||'-s-'||g, now() - ((g%400)||' days')::interval from generate_series(1,5000) g`);
}

async function measure<T>(label: string, operation: (run: number) => Promise<T>, runs = RUNS) {
  await operation(-1);
  const durations: number[] = [];
  let queries = 0;
  for (let run = 0; run < runs; run += 1) {
    counter.queries = 0;
    const started = performance.now();
    await operation(run);
    durations.push(performance.now() - started);
    queries = counter.queries;
  }
  durations.sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)]!;
  return { label, queries, medianMs: Math.round(median * 10) / 10, minMs: Math.round(durations[0]! * 10) / 10, maxMs: Math.round(durations.at(-1)! * 10) / 10 };
}

async function main() {
  const started = performance.now();
  await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
  await client.query(`insert into "user"(id,name,email) values ('bench-owner-a','Gérant A','a@bench.local'),('bench-owner-b','Gérant B','b@bench.local')`);
  for (const id of ["bench-a", "bench-b"]) {
    await client.query("insert into organization(id,name,slug) values ($1,$1,$1)", [id]);
    await client.query("insert into business_profile(business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
  }
  await client.query("insert into member(id,organization_id,user_id,role) values ('bm-a','bench-a','bench-owner-a','owner'),('bm-b','bench-b','bench-owner-b','owner')");
  await seedBusiness("bench-a", "bench-owner-a");
  await seedBusiness("bench-b", "bench-owner-b");
  await client.exec("analyze");
  const seeded = Math.round(performance.now() - started);

  const context = { businessId: "bench-a", actorUserId: "bench-owner-a" };
  const month = new Date().toISOString().slice(0, 10);
  const prices = await client.query<{ id: string; price: string }>(`select id, sale_price_xof::text as price from product_variant where business_id='bench-a' order by id limit 400`);
  const results = [
    await measure("Tableau de bord (getBusinessOverview)", () => businessData.getBusinessOverview(db, context)),
    await measure("Rapport mensuel complet (getCommercialReport)", () => getCommercialReport(db, { ...context, period: "monthly", date: month })),
    await measure("Liste clients complète (GET /api/business/customers)", () => businessData.listBusinessCustomers(db, context)),
  ];
  // Page de 50 clients, seulement si la pagination existe dans le code mesuré.
  const paged = (businessData as Record<string, unknown>).listBusinessCustomersPage as undefined | ((d: CommercialDatabase, c: typeof context, raw: unknown) => Promise<unknown>);
  if (paged) results.push(await measure("Liste clients, page de 50 (?limit=50)", () => paged(db, context, { limit: "50" })));
  // Vente de 20 lignes distinctes payée comptant : un jeu de variantes différent à chaque passage.
  results.push(await measure("Vente de 20 lignes (createSale)", async (run) => {
    const lines = prices.rows.slice((run + 1) * 20, (run + 2) * 20);
    const total = lines.reduce((sum, row) => sum + BigInt(row.price), 0n);
    await createSale(db, { ...context, idempotencyKey: `bench-sale-${run + 1}-${Date.now()}`, lines: lines.map((row) => ({ variantId: row.id, quantity: "1" })),
      payments: [{ method: "cash", amountXof: total.toString() }] });
  }));

  console.log(`Jeu de données chargé en ${seeded} ms (2 commerces × ${PRODUCTS} produits, ${SALES} ventes, ${CUSTOMERS} clients). Passages mesurés : ${RUNS}.`);
  console.log("| Opération | Requêtes SQL | Médiane (ms) | Min (ms) | Max (ms) |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of results) console.log(`| ${row.label} | ${row.queries} | ${row.medianMs} | ${row.minMs} | ${row.maxMs} |`);
  await client.close();
}

main().catch(async (error) => {
  console.error(error);
  await client.close().catch(() => undefined);
  process.exit(1);
});
