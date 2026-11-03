import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { businessProfile, member } from "../db/schema";
import { csvDocument } from "../exports/csv";
import { CommercialError, type CommercialDatabase } from "./commercial";

/*
 * Rapports commerciaux (missions 05 et 09). Tous les montants sont des entiers XOF calculés par
 * PostgreSQL et renvoyés en chaînes ; aucun total de référence n'est calculé dans le navigateur.
 * Définitions (docs/reports.md) :
 * - chiffre d'affaires : total des ventes non annulées, daté à l'enregistrement de la vente ;
 * - encaissements : paiements confirmés, datés à leur confirmation (un paiement en attente n'en est pas un) ;
 * - crédit accordé : part d'une vente qu'un client n'a pas réglée au comptoir ;
 * - anciennes dettes : soldes d'ouverture, jamais du chiffre d'affaires ni un achat ;
 * - marge brute estimée : chiffre d'affaires − coût des marchandises vendues, complète seulement si chaque coût est connu.
 */

const reportInputSchema = z.object({
  businessId: z.string().min(1), actorUserId: z.string().min(1), period: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]).default("monthly"),
  date: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(),
  // « summary » (tableau de bord) saute les sections détaillées.
  detail: z.enum(["full", "summary"]).default("full"),
});
type ReportInput = z.infer<typeof reportInputSchema>;

type LocalDate = { year: number; month: number; day: number };
const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(value: string): LocalDate {
  const match = dateRegex.exec(value);
  if (!match) throw new CommercialError("La date doit respecter le format AAAA-MM-JJ.", 400, "invalid_date");
  const [year, month, day] = match.slice(1).map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month || normalized.getUTCDate() !== day) throw new CommercialError("Date invalide.", 400, "invalid_date");
  return { year, month, day };
}

function dateKey(date: LocalDate) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
function addDays(date: LocalDate, amount: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}
function localToday(timeZone: string, now: Date): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return { year: Number(parts.find((part) => part.type === "year")?.value), month: Number(parts.find((part) => part.type === "month")?.value), day: Number(parts.find((part) => part.type === "day")?.value) };
}
function localMidnightUtc(date: LocalDate, timeZone: string): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const get = (part: string) => Number(parts.find((entry) => entry.type === part)?.value);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const next = guess + target - represented;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/**
 * Bornes [début, fin) dans le fuseau du commerce. Semaine du lundi au dimanche ; mois et année civils ;
 * période personnalisée de 1 à 366 jours comparée à la période de même durée qui la précède.
 */
export function reportRange(input: Pick<ReportInput, "period" | "date" | "startDate" | "endDate">, timeZone: string, now: Date) {
  let startDate: LocalDate;
  let endDate: LocalDate;
  let previousStartDate: LocalDate;
  let previousEndDate: LocalDate;
  if (input.period === "custom") {
    if (!input.startDate || !input.endDate) throw new CommercialError("Choisissez les dates de début et de fin.", 400, "missing_dates");
    startDate = parseLocalDate(input.startDate);
    const lastDay = parseLocalDate(input.endDate);
    const dayCount = (Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day) - Date.UTC(startDate.year, startDate.month - 1, startDate.day)) / 86_400_000 + 1;
    if (dayCount < 1 || dayCount > 366) throw new CommercialError("La période personnalisée doit couvrir entre 1 et 366 jours.", 400, "invalid_range");
    endDate = addDays(lastDay, 1);
    previousEndDate = startDate;
    previousStartDate = addDays(startDate, -dayCount);
  } else {
    const selected = input.date ? parseLocalDate(input.date) : localToday(timeZone, now);
    if (input.period === "daily") {
      startDate = selected; endDate = addDays(selected, 1); previousStartDate = addDays(startDate, -1); previousEndDate = startDate;
    } else if (input.period === "weekly") {
      const weekday = new Date(Date.UTC(selected.year, selected.month - 1, selected.day)).getUTCDay();
      startDate = addDays(selected, -((weekday + 6) % 7)); endDate = addDays(startDate, 7);
      previousStartDate = addDays(startDate, -7); previousEndDate = startDate;
    } else if (input.period === "yearly") {
      startDate = { year: selected.year, month: 1, day: 1 }; endDate = { year: selected.year + 1, month: 1, day: 1 };
      previousStartDate = { year: selected.year - 1, month: 1, day: 1 }; previousEndDate = startDate;
    } else {
      startDate = { year: selected.year, month: selected.month, day: 1 };
      endDate = selected.month === 12 ? { year: selected.year + 1, month: 1, day: 1 } : { year: selected.year, month: selected.month + 1, day: 1 };
      previousStartDate = selected.month === 1 ? { year: selected.year - 1, month: 12, day: 1 } : { year: selected.year, month: selected.month - 1, day: 1 };
      previousEndDate = startDate;
    }
  }
  const buckets: string[] = [];
  if (input.period === "yearly") for (let month = 1; month <= 12; month += 1) buckets.push(dateKey({ year: startDate.year, month, day: 1 }));
  else for (let day = startDate; dateKey(day) < dateKey(endDate); day = addDays(day, 1)) buckets.push(dateKey(day));
  return {
    startDate: dateKey(startDate), endDate: dateKey(addDays(endDate, -1)),
    previousStartDate: dateKey(previousStartDate), previousEndDate: dateKey(addDays(previousEndDate, -1)),
    start: localMidnightUtc(startDate, timeZone), end: localMidnightUtc(endDate, timeZone),
    previousStart: localMidnightUtc(previousStartDate, timeZone), previousEnd: localMidnightUtc(previousEndDate, timeZone),
    buckets,
  };
}

const amount = (value: string | number | bigint | null | undefined) => BigInt(value ?? 0);
const decimal = (value: string | number | null | undefined) => String(value ?? "0");
function roundedAverage(total: bigint, count: bigint) { return count === 0n ? null : ((total + count / 2n) / count).toString(); }

/** Variation en points de base (1 % = 100), arrondie ; null sans base de comparaison. */
export function changeBasisPoints(current: bigint, previous: bigint) {
  if (previous === 0n) return null;
  const delta = (current - previous) * 10_000n;
  const half = (previous < 0n ? -previous : previous) / 2n;
  return ((delta >= 0n ? delta + half : delta - half) / previous).toString();
}
function comparison(current: bigint, previous: bigint) {
  return { currentXof: current.toString(), previousXof: previous.toString(), changeXof: (current - previous).toString(), changePercent: changeBasisPoints(current, previous) };
}

const soldStatuses = sql.raw(`('completed','partially_refunded','refunded')`);
const collectedStatuses = sql.raw(`('confirmed','partially_refunded','refunded')`);

type Rows<T> = { rows: T[] };
async function rows<T>(db: CommercialDatabase, query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as unknown as Rows<T>).rows;
}

/** Horodatage passé en texte ISO et typé par PostgreSQL : même comportement avec PGlite et Neon. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** Valeur produite par json_agg / row_to_json : déjà décodée par le pilote, ou texte selon le pilote. */
function fromJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

type Range = { start: Date; end: Date };

/**
 * Chiffres de base de plusieurs périodes en une seule requête (période et comparaison ; pour le tableau
 * de bord, jour et semaine). Chaque période est une ligne de VALUES ; chaque famille de chiffres est un
 * agrégat LATERAL qui ne parcourt sa table qu'une fois (FILTER plutôt qu'une sous-requête par chiffre).
 * Les définitions sont celles de docs/reports.md, identiques pour une période et sa comparaison.
 */
async function coreTotals(db: CommercialDatabase, businessId: string, ranges: Range[]) {
  const periods = sql.join(ranges.map((range, index) => sql`(${index}::int, ${at(range.start)}, ${at(range.end)})`), sql`, `);
  const result = await rows<Record<string, string>>(db, sql`select per.k,
      sa.revenue::text as revenue, sa.sale_count::text as sale_count, sa.discounts::text as discounts,
      li.items::text as items, li.cogs_known::text as cogs_known, li.known_revenue::text as known_revenue, li.unknown_lines::text as unknown_lines,
      pa.collected::text as collected, pa.settlements::text as settlements,
      ob.recovered::text as opening_recovered, ob.recovered_count::text as opening_recovered_count,
      ex.total::text as expenses, ex.count::text as expense_count, cg.total::text as credit_granted,
      rf.total::text as refunds, rf.count::text as refund_count
    from (values ${periods}) as per(k, starts, ends)
    cross join lateral (select coalesce(sum(s.total_xof), 0) as revenue, count(*) as sale_count, coalesce(sum(s.discount_xof), 0) as discounts
      from sale s where s.business_id = ${businessId} and s.occurred_at >= per.starts and s.occurred_at < per.ends and s.status in ${soldStatuses}) sa
    cross join lateral (select coalesce(sum(l.quantity), 0) as items, coalesce(sum(l.cogs_xof) filter (where l.cost_available), 0) as cogs_known,
        coalesce(sum(l.line_total_xof) filter (where l.cost_available), 0) as known_revenue, count(*) filter (where not l.cost_available) as unknown_lines
      from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${businessId} and s.occurred_at >= per.starts and s.occurred_at < per.ends and s.status in ${soldStatuses}) li
    cross join lateral (select coalesce(sum(p.amount_xof), 0) as collected, coalesce(sum(p.amount_xof) filter (where rp.hit), 0) as settlements
      from payment p left join lateral (select true as hit from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id limit 1) rp on true
      where p.business_id = ${businessId} and p.status in ${collectedStatuses} and p.confirmed_at >= per.starts and p.confirmed_at < per.ends) pa
    cross join lateral (select coalesce(sum(op.amount_xof), 0) as recovered, count(*) as recovered_count
      from opening_balance_payment op join opening_balance b on b.business_id = op.business_id and b.id = op.opening_balance_id
      where op.business_id = ${businessId} and b.party_type = 'customer' and op.occurred_at >= per.starts and op.occurred_at < per.ends) ob
    cross join lateral (select coalesce(sum(e.amount_xof), 0) as total, count(*) as count
      from expense e where e.business_id = ${businessId} and e.occurred_at >= per.starts and e.occurred_at < per.ends) ex
    cross join lateral (select coalesce(sum(greatest(s.total_xof - coalesce((select sum(p.amount_xof) from payment p where p.business_id = s.business_id and p.sale_id = s.id and p.status <> 'failed'
        and not exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id)), 0), 0)), 0) as total
      from sale s where s.business_id = ${businessId} and s.customer_id is not null and s.occurred_at >= per.starts and s.occurred_at < per.ends and s.status in ${soldStatuses}) cg
    cross join lateral (select coalesce(sum(rf.amount_xof), 0) as total, count(*) as count
      from payment_refund rf where rf.business_id = ${businessId} and rf.status = 'confirmed' and rf.occurred_at >= per.starts and rf.occurred_at < per.ends) rf
    order by per.k`);
  return ranges.map((_, index) => toCoreTotals(result.find((row) => Number(row.k) === index)));
}

function toCoreTotals(row: Record<string, string> | undefined) {
  const n = (key: string) => amount(row?.[key]);
  const revenue = n("revenue");
  const cogsKnown = n("cogs_known");
  const knownRevenue = n("known_revenue");
  const unknownLines = n("unknown_lines");
  return {
    revenue, saleCount: n("sale_count"), discounts: n("discounts"), items: decimal(row?.items), cogsKnown, knownRevenue, unknownLines,
    marginComplete: unknownLines === 0n, margin: unknownLines === 0n ? revenue - cogsKnown : null, marginOnKnown: knownRevenue - cogsKnown,
    collected: n("collected"), settlements: n("settlements"), openingRecovered: n("opening_recovered"), openingRecoveredCount: n("opening_recovered_count"),
    expenses: n("expenses"), expenseCount: n("expense_count"), creditGranted: n("credit_granted"), refunds: n("refunds"), refundCount: n("refund_count"),
  };
}
type CoreTotals = ReturnType<typeof toCoreTotals>;

/** Liste JSON ordonnée d'une sous-requête (`ord` : rang calculé par la sous-requête elle-même). */
const jsonList = (query: ReturnType<typeof sql>, order: ReturnType<typeof sql>) => sql`(select coalesce(json_agg(x order by ${order}), '[]'::json) from (${query}) x)`;
const jsonRow = (query: ReturnType<typeof sql>) => sql`(select row_to_json(x) from (${query}) x)`;
const emptyList = sql`'[]'::json`;

type ReportPlan = { input: ReportInput; timezone: string; range: ReturnType<typeof reportRange> };

type Snapshot = {
  pending: { method: string; total: string; count: string }[];
  methods: { method: string; total: string }[];
  settlement: { paid: string; partial: string; credit: string; mixed: string } | null;
  receivables: { count: string; total: string } | null;
  openingCustomers: { remaining: string } | null;
  purchases: { total: string; count: string; paid: string } | null;
  top: { name: string; quantity: string; total: string }[];
  trend: { bucket: string; total: string; count: string }[];
  collectionTrend: { bucket: string; total: string }[];
  expenseTrend: { bucket: string; total: string }[];
  inventory: { gain: string; loss: string; sessions: string } | null;
  details: Awaited<ReturnType<typeof detailsFrom>> | null;
};

/**
 * Tout ce qu'un rapport affiche en plus des chiffres de base, en une seule requête : chaque section est une
 * sous-requête scalaire qui renvoie sa ligne (row_to_json) ou sa liste ordonnée (json_agg). Les montants
 * restent des chaînes (`::text`), jamais des nombres JSON. Les paiements ne sont lus que pour les ventes
 * concernées (LATERAL), jamais agrégés sur tout l'historique du commerce.
 */
async function reportSnapshot(db: CommercialDatabase, b: string, plan: ReportPlan): Promise<Snapshot> {
  const start = at(plan.range.start);
  const end = at(plan.range.end);
  const { timezone } = plan;
  const bucketUnit = plan.input.period === "yearly" ? "month" : "day";
  const full = plan.input.detail === "full";
  const [row] = await rows<Record<string, unknown>>(db, sql`select
    ${jsonList(sql`select p.method, sum(p.amount_xof)::text as total, count(*)::text as count from payment p
      where p.business_id = ${b} and p.status = 'pending' and p.occurred_at >= ${start} and p.occurred_at < ${end} group by p.method`, sql`x.method`)} as pending,
    ${jsonList(sql`select p.method, sum(p.amount_xof)::text as total from payment p
      where p.business_id = ${b} and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end} group by p.method`, sql`x.method`)} as methods,
    ${jsonRow(sql`select count(*) filter (where coalesce(p.paid, 0) >= s.total_xof)::text as paid,
      count(*) filter (where coalesce(p.paid, 0) > 0 and coalesce(p.paid, 0) < s.total_xof)::text as partial,
      count(*) filter (where coalesce(p.paid, 0) = 0 and s.customer_id is not null)::text as credit,
      count(*) filter (where coalesce(p.methods, 0) >= 2)::text as mixed
      from sale s left join lateral (select sum(pp.amount_xof) filter (where pp.status in ${collectedStatuses} and pp.confirmed_at < ${end}) as paid,
        count(distinct pp.method) filter (where pp.status <> 'failed') as methods from payment pp where pp.business_id = s.business_id and pp.sale_id = s.id) p on true
      where s.business_id = ${b} and s.status <> 'voided' and s.occurred_at >= ${start} and s.occurred_at < ${end}`)} as settlement,
    ${jsonRow(sql`select count(*)::text as count, coalesce(sum(s.total_xof - coalesce(p.paid, 0)), 0)::text as total
      from sale s left join lateral (select sum(pp.amount_xof) as paid from payment pp where pp.business_id = s.business_id and pp.sale_id = s.id
        and pp.status in ${collectedStatuses} and pp.confirmed_at < ${end}) p on true
      where s.business_id = ${b} and s.customer_id is not null and s.status <> 'voided' and s.occurred_at < ${end} and s.total_xof > coalesce(p.paid, 0)`)} as receivables,
    ${jsonRow(sql`select coalesce(sum(greatest(b.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op
        where op.business_id = b.business_id and op.opening_balance_id = b.id and op.occurred_at < ${end}), 0), 0)), 0)::text as remaining
      from opening_balance b where b.business_id = ${b} and b.party_type = 'customer' and b.created_at < ${end}`)} as opening_customers,
    ${jsonRow(sql`select coalesce(sum(total_xof), 0)::text as total, count(*)::text as count,
      (select coalesce(sum(pp.amount_xof), 0) from purchase_payment pp where pp.business_id = ${b} and pp.occurred_at >= ${start} and pp.occurred_at < ${end})::text as paid
      from purchase where business_id = ${b} and status = 'received' and occurred_at >= ${start} and occurred_at < ${end}`)} as purchases,
    ${jsonList(sql`select l.product_name_snapshot as name, sum(l.quantity)::text as quantity, sum(l.line_total_xof)::text as total,
        row_number() over (order by sum(l.line_total_xof) desc, l.product_name_snapshot) as ord
      from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses}
      group by l.product_name_snapshot order by ord limit 10`, sql`x.ord`)} as top,
    ${jsonList(sql`select to_char(date_trunc(${bucketUnit}, s.occurred_at at time zone ${timezone}), 'YYYY-MM-DD') as bucket,
      sum(s.total_xof)::text as total, count(*)::text as count from sale s
      where s.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses} group by 1`, sql`x.bucket`)} as trend,
    ${full ? jsonList(sql`select to_char(date_trunc(${bucketUnit}, p.confirmed_at at time zone ${timezone}), 'YYYY-MM-DD') as bucket, sum(p.amount_xof)::text as total
      from payment p where p.business_id = ${b} and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end} group by 1`, sql`x.bucket`) : emptyList} as collection_trend,
    ${full ? jsonList(sql`select to_char(date_trunc(${bucketUnit}, e.occurred_at at time zone ${timezone}), 'YYYY-MM-DD') as bucket, sum(e.amount_xof)::text as total
      from expense e where e.business_id = ${b} and e.occurred_at >= ${start} and e.occurred_at < ${end} group by 1`, sql`x.bucket`) : emptyList} as expense_trend,
    ${jsonRow(sql`select coalesce(sum(greatest(l.counted_qty - l.theoretical_qty, 0)), 0)::text as gain,
      coalesce(sum(greatest(l.theoretical_qty - l.counted_qty, 0)), 0)::text as loss, count(distinct s.id)::text as sessions
      from inventory_line l join inventory_session s on s.business_id = l.business_id and s.id = l.session_id
      where l.business_id = ${b} and s.status = 'validated' and s.validated_at >= ${start} and s.validated_at < ${end}`)} as inventory
    ${full ? sql`, ${detailColumns(b, start, end)}` : sql``}`);
  return {
    pending: fromJson(row?.pending, []), methods: fromJson(row?.methods, []), settlement: fromJson(row?.settlement, null),
    receivables: fromJson(row?.receivables, null), openingCustomers: fromJson(row?.opening_customers, null), purchases: fromJson(row?.purchases, null),
    top: fromJson(row?.top, []), trend: fromJson(row?.trend, []), collectionTrend: fromJson(row?.collection_trend, []), expenseTrend: fromJson(row?.expense_trend, []),
    inventory: fromJson(row?.inventory, null), details: full && row ? detailsFrom(row) : null,
  };
}

/** Colonnes des sections détaillées : catégories, dépenses ventilées, stock, produits peu vendus, employés, dettes fournisseurs. */
function detailColumns(b: string, start: ReturnType<typeof sql>, end: ReturnType<typeof sql>) {
  return sql`${jsonList(sql`select c.name as category, sum(l.quantity)::text as quantity, sum(l.line_total_xof)::text as total,
        row_number() over (order by sum(l.line_total_xof) desc, c.name nulls last) as ord
      from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      join product_variant v on v.business_id = l.business_id and v.id = l.variant_id
      join product p on p.business_id = v.business_id and p.id = v.product_id
      left join product_category c on c.business_id = p.business_id and c.id = p.category_id
      where l.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses}
      group by c.name order by ord limit 20`, sql`x.ord`)} as d_categories,
    ${jsonList(sql`select category, sum(amount_xof)::text as total, count(*)::text as count, row_number() over (order by sum(amount_xof) desc, category) as ord from expense
      where business_id = ${b} and occurred_at >= ${start} and occurred_at < ${end} group by category order by ord limit 20`, sql`x.ord`)} as d_expense_categories,
    ${jsonList(sql`select payment_method as method, sum(amount_xof)::text as total from expense
      where business_id = ${b} and occurred_at >= ${start} and occurred_at < ${end} group by payment_method`, sql`x.method nulls last`)} as d_expense_methods,
    ${jsonList(sql`select reason,
      coalesce(sum(quantity_delta) filter (where quantity_delta > 0), 0)::text as incoming, coalesce(-sum(quantity_delta) filter (where quantity_delta < 0), 0)::text as outgoing,
      count(*)::text as count, round(sum(quantity_delta * unit_cost_xof))::bigint::text as value
      from stock_movement where business_id = ${b} and occurred_at >= ${start} and occurred_at < ${end} group by reason`, sql`x.reason`)} as d_stock_reasons,
    ${jsonList(sql`select p.name as product, v.label as variant, m.reason, m.quantity_delta::text as delta,
        to_char(m.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt",
        row_number() over (order by abs(m.quantity_delta) desc, m.occurred_at desc) as ord
      from stock_movement m join product_variant v on v.business_id = m.business_id and v.id = m.variant_id join product p on p.business_id = v.business_id and p.id = v.product_id
      where m.business_id = ${b} and m.reason <> 'sale' and m.occurred_at >= ${start} and m.occurred_at < ${end} order by ord limit 5`, sql`x.ord`)} as d_notable,
    ${jsonList(sql`select p.name, v.label as variant, v.on_hand::text as "onHand", coalesce(sold.quantity, 0)::text as quantity,
        row_number() over (order by coalesce(sold.quantity, 0) asc, v.on_hand desc, p.name) as ord
      from product_variant v join product p on p.business_id = v.business_id and p.id = v.product_id
      left join (select l.variant_id, sum(l.quantity) as quantity from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
        where l.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses} group by l.variant_id) sold on sold.variant_id = v.id
      where v.business_id = ${b} and v.archived_at is null and p.archived_at is null and v.on_hand > 0
      order by ord limit 5`, sql`x.ord`)} as d_slow,
    ${jsonList(sql`select m.user_id as "userId", u.name, row_number() over (order by u.name) as ord,
      (select count(*) from sale s where s.business_id = m.organization_id and s.cashier_user_id = m.user_id and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as sales,
      (select coalesce(sum(s.total_xof), 0) from sale s where s.business_id = m.organization_id and s.cashier_user_id = m.user_id and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as revenue,
      (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = m.organization_id and p.recorded_by_user_id = m.user_id and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end})::text as collected,
      (select coalesce(sum(e.amount_xof), 0) from expense e where e.business_id = m.organization_id and e.paid_by_user_id = m.user_id and e.occurred_at >= ${start} and e.occurred_at < ${end})::text as expenses
      from member m join "user" u on u.id = m.user_id where m.organization_id = ${b}`, sql`x.ord`)} as d_employees,
    ${jsonRow(sql`select
      (select coalesce(sum(total_xof), 0) from purchase where business_id = ${b} and status = 'received' and occurred_at < ${end})::text as purchases,
      (select coalesce(sum(pp.amount_xof), 0) from purchase_payment pp join purchase pu on pu.business_id = pp.business_id and pu.id = pp.purchase_id
        where pp.business_id = ${b} and pu.status = 'received' and pp.occurred_at < ${end})::text as paid,
      (select coalesce(sum(greatest(ob.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op where op.business_id = ob.business_id and op.opening_balance_id = ob.id and op.occurred_at < ${end}), 0), 0)), 0)
        from opening_balance ob where ob.business_id = ${b} and ob.party_type = 'supplier' and ob.created_at < ${end})::text as opening`)} as d_supplier_debt,
    ${jsonRow(sql`select coalesce(sum(op.amount_xof), 0)::text as total from opening_balance_payment op join opening_balance ob on ob.business_id = op.business_id and ob.id = op.opening_balance_id
      where op.business_id = ${b} and ob.party_type = 'supplier' and op.occurred_at >= ${start} and op.occurred_at < ${end}`)} as d_supplier_opening_paid`;
}

function detailsFrom(row: Record<string, unknown>) {
  const categories = fromJson<{ category: string | null; quantity: string; total: string }[]>(row.d_categories, []);
  const expenseCategories = fromJson<{ category: string; total: string; count: string }[]>(row.d_expense_categories, []);
  const expenseMethods = fromJson<{ method: string | null; total: string }[]>(row.d_expense_methods, []);
  const stockReasons = fromJson<{ reason: string; incoming: string; outgoing: string; count: string; value: string | null }[]>(row.d_stock_reasons, []);
  const notable = fromJson<{ product: string; variant: string; reason: string; delta: string; occurredAt: string }[]>(row.d_notable, []);
  const slow = fromJson<{ name: string; variant: string; onHand: string; quantity: string }[]>(row.d_slow, []);
  const employees = fromJson<{ userId: string; name: string; sales: string; revenue: string; collected: string; expenses: string }[]>(row.d_employees, []);
  const debt = fromJson<{ purchases: string; paid: string; opening: string } | null>(row.d_supplier_debt, null);
  const supplierOpeningPaid = fromJson<{ total: string } | null>(row.d_supplier_opening_paid, null);
  const purchasesDue = amount(debt?.purchases) - amount(debt?.paid);
  return {
    categories: categories.map((item) => ({ category: item.category, quantity: decimal(item.quantity), revenueXof: item.total })),
    expenseCategories: expenseCategories.map((item) => ({ category: item.category, amountXof: item.total, count: item.count })),
    expenseMethods: expenseMethods.map((item) => ({ method: item.method, amountXof: item.total })),
    stock: {
      byReason: stockReasons.map((item) => ({ reason: item.reason, incomingQty: decimal(item.incoming), outgoingQty: decimal(item.outgoing), count: item.count, valueAtCostXof: item.value })),
      notable: notable.map((item) => ({ product: item.product, variant: item.variant, reason: item.reason, quantityDelta: item.delta, occurredAt: new Date(item.occurredAt).toISOString() })),
    },
    slowProducts: slow.map((item) => ({ name: item.name, variant: item.variant, onHand: decimal(item.onHand), quantitySold: decimal(item.quantity) })),
    employees: employees.filter((item) => item.sales !== "0" || item.collected !== "0" || item.expenses !== "0")
      .map((item) => ({ userId: item.userId, name: item.name, saleCount: item.sales, revenueXof: item.revenue, collectedXof: item.collected, expensesXof: item.expenses })),
    supplierDebt: { purchasesDueXof: purchasesDue.toString(), openingDueXof: amount(debt?.opening).toString(), totalXof: (purchasesDue + amount(debt?.opening)).toString() },
    supplierOpeningPaid: amount(supplierOpeningPaid?.total),
  };
}

/**
 * Appartenance, permission `report:read` et fuseau du commerce en une seule lecture.
 * Ordre des refus inchangé : 403 sans droit, 404 sans profil, 422 si le fuseau enregistré est invalide.
 */
async function reportTimezone(db: CommercialDatabase, businessId: string, actorUserId: string) {
  const [access] = await db.select({ role: member.role, timezone: businessProfile.timezone }).from(member)
    .leftJoin(businessProfile, eq(businessProfile.businessId, member.organizationId))
    .where(and(eq(member.organizationId, businessId), eq(member.userId, actorUserId))).limit(1);
  if (!access || !hasBusinessPermission(access.role, "report", "read")) throw new CommercialError("Vous n’avez pas l’autorisation de consulter les rapports.", 403, "forbidden");
  if (!access.timezone) throw new CommercialError("Commerce introuvable.", 404);
  return assertValidTimezone(access.timezone);
}

export function assertValidTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new CommercialError("Le fuseau horaire du commerce est invalide.", 422); }
  return timezone;
}

function planReport(raw: unknown, timezone: string, now: Date): ReportPlan {
  const input = reportInputSchema.parse(raw);
  return { input, timezone, range: reportRange(input, timezone, now) };
}

const rangesOf = (plan: ReportPlan): Range[] => [{ start: plan.range.start, end: plan.range.end }, { start: plan.range.previousStart, end: plan.range.previousEnd }];

/**
 * Rapport d'une période : 3 requêtes au total (accès et fuseau, chiffres de base des deux périodes,
 * sections), dont 2 en parallèle, au lieu d'une vingtaine lancées en même temps auparavant.
 */
export async function getCommercialReport(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = reportInputSchema.parse(raw);
  const timezone = await reportTimezone(db, input.businessId, input.actorUserId);
  const plan = planReport(input, timezone, now);
  const [[current, previous], snapshot] = await Promise.all([coreTotals(db, input.businessId, rangesOf(plan)), reportSnapshot(db, input.businessId, plan)]);
  return buildReport(plan, current!, previous!, snapshot, now);
}

/**
 * Résumés du jour et de la semaine du tableau de bord (detail « summary ») : une requête pour les chiffres
 * de base des quatre périodes, une par résumé pour le reste. L'appelant a déjà vérifié `report:read`
 * et lu le fuseau du commerce (validé ici).
 */
export async function getDashboardReports(db: CommercialDatabase, context: { businessId: string; actorUserId: string; timezone: string; date: string }, now = new Date()) {
  const timezone = assertValidTimezone(context.timezone);
  const base = { businessId: context.businessId, actorUserId: context.actorUserId, date: context.date, detail: "summary" as const };
  const plans = [planReport({ ...base, period: "daily" }, timezone, now), planReport({ ...base, period: "weekly" }, timezone, now)];
  const [totals, ...snapshots] = await Promise.all([coreTotals(db, context.businessId, plans.flatMap(rangesOf)), ...plans.map((plan) => reportSnapshot(db, context.businessId, plan))]);
  const [today, week] = plans.map((plan, index) => buildReport(plan, totals[2 * index]!, totals[2 * index + 1]!, snapshots[index]!, now));
  return { today: today!, week: week! };
}

function buildReport(plan: ReportPlan, current: CoreTotals, previous: CoreTotals, snapshot: Snapshot, now: Date) {
  const { input, range, timezone } = plan;
  const { end } = range;
  const details = snapshot.details;
  const trendMap = new Map(snapshot.trend.map((row) => [row.bucket, row]));
  const collectionMap = new Map(snapshot.collectionTrend.map((row) => [row.bucket, row.total]));
  const expenseMap = new Map(snapshot.expenseTrend.map((row) => [row.bucket, row.total]));
  const supplierPaid = amount(snapshot.purchases?.paid);
  const settlement = snapshot.settlement;
  const pendingRows = snapshot.pending;
  const pendingTotal = pendingRows.reduce((sum, row) => sum + amount(row.total), 0n);
  const openingOutstanding = amount(snapshot.openingCustomers?.remaining);
  const receivables = amount(snapshot.receivables?.total);
  const cashIn = current.collected + current.openingRecovered;
  const cashOut = current.expenses + supplierPaid + current.refunds + (details?.supplierOpeningPaid ?? 0n);

  return {
    timezone, period: input.period, startDate: range.startDate, endDate: range.endDate,
    previousStartDate: range.previousStartDate, previousEndDate: range.previousEndDate, generatedAt: now.toISOString(), detail: input.detail,
    sales: {
      revenueXof: current.revenue.toString(), count: current.saleCount.toString(), averageBasketXof: roundedAverage(current.revenue, current.saleCount),
      discountXof: current.discounts.toString(), itemsSold: current.items, previousRevenueXof: previous.revenue.toString(), previousCount: previous.saleCount.toString(),
      changeXof: (current.revenue - previous.revenue).toString(), changePercent: changeBasisPoints(current.revenue, previous.revenue),
      byCategory: details?.categories ?? [],
    },
    settlement: { paid: settlement?.paid ?? "0", partial: settlement?.partial ?? "0", credit: settlement?.credit ?? "0", mixed: settlement?.mixed ?? "0" },
    collections: {
      totalXof: current.collected.toString(), atSaleXof: (current.collected - current.settlements).toString(), settlementsXof: current.settlements.toString(),
      byMethod: snapshot.methods.map((row) => ({ method: row.method, amountXof: row.total })),
      pending: { totalXof: pendingTotal.toString(), count: pendingRows.reduce((sum, row) => sum + amount(row.count), 0n).toString(), byMethod: pendingRows.map((row) => ({ method: row.method, amountXof: row.total, count: row.count })) },
      openingRecoveries: { totalXof: current.openingRecovered.toString(), count: current.openingRecoveredCount.toString() },
    },
    receivablesAsOf: { asOf: end.toISOString(), totalXof: receivables.toString(), count: snapshot.receivables?.count ?? "0" },
    credit: {
      grantedXof: current.creditGranted.toString(), settlementsXof: current.settlements.toString(), outstandingSalesXof: receivables.toString(),
      openingRecoveredXof: current.openingRecovered.toString(), openingOutstandingXof: openingOutstanding.toString(), totalOutstandingXof: (receivables + openingOutstanding).toString(),
    },
    refunds: { totalXof: current.refunds.toString(), count: current.refundCount.toString() },
    expenses: {
      totalXof: current.expenses.toString(), count: current.expenseCount.toString(),
      // Une dépense est saisie au moment où elle est payée : il n'existe pas encore de dépense « engagée non payée ».
      paidXof: current.expenses.toString(),
      byCategory: details?.expenseCategories ?? [], byMethod: details?.expenseMethods ?? [],
    },
    purchases: { totalXof: snapshot.purchases?.total ?? "0", count: snapshot.purchases?.count ?? "0", paidXof: supplierPaid.toString() },
    grossMarginEstimate: current.marginComplete
      ? { available: true, amountXof: current.margin!.toString(), note: "Estimation avant remboursements; ce n’est pas un bénéfice net." }
      : { available: false, amountXof: null, note: "Coût d’achat manquant pour au moins une ligne vendue." },
    margin: {
      complete: current.marginComplete, amountXof: current.margin?.toString() ?? null, unknownCostLines: current.unknownLines.toString(),
      knownCostRevenueXof: current.knownRevenue.toString(), cogsKnownXof: current.cogsKnown.toString(), marginOnKnownXof: current.marginOnKnown.toString(),
      previousAmountXof: previous.margin?.toString() ?? null,
    },
    // Résultat estimé = marge brute complète − dépenses de la période ; ce n'est pas un bénéfice net comptable (ni amortissements, ni impôts).
    operatingEstimate: current.margin === null ? { available: false, amountXof: null } : { available: true, amountXof: (current.margin - current.expenses).toString() },
    cashFlow: { inXof: cashIn.toString(), outXof: cashOut.toString(), netXof: (cashIn - cashOut).toString() },
    supplierDebt: details?.supplierDebt ?? null,
    comparison: {
      revenue: comparison(current.revenue, previous.revenue), saleCount: comparison(current.saleCount, previous.saleCount),
      collections: comparison(current.collected, previous.collected), expenses: comparison(current.expenses, previous.expenses),
      creditGranted: comparison(current.creditGranted, previous.creditGranted), settlements: comparison(current.settlements, previous.settlements),
      margin: current.margin !== null && previous.margin !== null ? comparison(current.margin, previous.margin) : null,
    },
    topProducts: snapshot.top.map((row) => ({ name: row.name, quantity: decimal(row.quantity), revenueXof: row.total })),
    slowProducts: details?.slowProducts ?? [],
    stock: details?.stock ?? null,
    employees: details?.employees ?? [],
    inventoryVariance: { gainQty: decimal(snapshot.inventory?.gain), lossQty: decimal(snapshot.inventory?.loss), validatedSessionCount: snapshot.inventory?.sessions ?? "0" },
    trend: range.buckets.map((bucket) => ({ date: bucket, revenueXof: trendMap.get(bucket)?.total ?? "0", saleCount: trendMap.get(bucket)?.count ?? "0",
      collectionsXof: collectionMap.get(bucket) ?? "0", expensesXof: expenseMap.get(bucket) ?? "0" })),
  };
}

export type CommercialReport = Awaited<ReturnType<typeof getCommercialReport>>;

export function reportCsv(report: CommercialReport) {
  const methodLabel = (method: string | null) => method ?? "non précisé";
  const rowsOut: string[][] = [
    ["Rapport commercial QADR OPS", `${report.startDate} — ${report.endDate}`, `Fuseau: ${report.timezone}`, `Généré: ${report.generatedAt}`],
    ["Comparé à", `${report.previousStartDate} — ${report.previousEndDate}`],
    ["Indicateur", "Valeur", "Période précédente"],
    ["Chiffre d’affaires (XOF)", report.sales.revenueXof, report.sales.previousRevenueXof], ["Nombre de ventes", report.sales.count, report.sales.previousCount],
    ["Quantités vendues (toutes unités)", report.sales.itemsSold],
    ["Panier moyen (XOF)", report.sales.averageBasketXof ?? "Indisponible"], ["Remises (XOF)", report.sales.discountXof],
    ["Écart de CA vs période précédente (XOF)", report.sales.changeXof], ["Encaissements confirmés (XOF)", report.collections.totalXof, report.comparison.collections.previousXof],
    ["Dont règlements de crédits (XOF)", report.collections.settlementsXof], ["Paiements en attente, non encaissés (XOF)", report.collections.pending.totalXof],
    ["Anciennes dettes clients remboursées (XOF)", report.collections.openingRecoveries.totalXof],
    ["Ventes avec paiement mixte", report.settlement.mixed],
    ["Crédit accordé (XOF)", report.credit.grantedXof, report.comparison.creditGranted.previousXof],
    ["Créances ouvertes à la fin de période (XOF)", report.receivablesAsOf.totalXof], ["Anciennes dettes clients restantes (XOF)", report.credit.openingOutstandingXof],
    ["Remboursements confirmés (XOF)", report.refunds.totalXof],
    ["Dépenses enregistrées (XOF)", report.expenses.totalXof, report.comparison.expenses.previousXof], ["Dépenses payées (XOF)", report.expenses.paidXof],
    ["Achats reçus (XOF, présentés séparément)", report.purchases.totalXof], ["Paiements fournisseurs (XOF)", report.purchases.paidXof],
    ["Dettes fournisseurs à la fin de période (XOF)", report.supplierDebt?.totalXof ?? "Non calculé"],
    ["Marge brute estimée avant remboursements (XOF)", report.grossMarginEstimate.amountXof ?? report.grossMarginEstimate.note],
    ["Marge sur les lignes au coût connu (XOF)", report.margin.marginOnKnownXof], ["Lignes vendues sans coût connu", report.margin.unknownCostLines],
    ["Résultat estimé (marge − dépenses, XOF)", report.operatingEstimate.amountXof ?? "Indisponible : coût manquant"],
    ["Flux de trésorerie net de la période (XOF)", report.cashFlow.netXof],
    ["Pertes d’inventaire (quantité)", report.inventoryVariance.lossQty], ["Gains d’inventaire (quantité)", report.inventoryVariance.gainQty],
    [],
    ["Jour", "CA (XOF)", "Ventes", "Encaissements (XOF)", "Dépenses (XOF)"], ...report.trend.map((row) => [row.date, row.revenueXof, row.saleCount, row.collectionsXof, row.expensesXof]),
    [],
    ["Produit", "Quantité vendue", "CA (XOF)"], ...report.topProducts.map((row) => [row.name, row.quantity, row.revenueXof]),
    [],
    ["Catégorie", "Quantité vendue", "CA (XOF)"], ...report.sales.byCategory.map((row) => [row.category ?? "Sans catégorie", row.quantity, row.revenueXof]),
    [],
    ["Moyen de paiement", "Encaissements confirmés (XOF)"], ...report.collections.byMethod.map((row) => [row.method, row.amountXof]),
    ["Moyen de paiement", "En attente (XOF)"], ...report.collections.pending.byMethod.map((row) => [row.method, row.amountXof]),
    [],
    ["Catégorie de dépense", "Montant (XOF)"], ...report.expenses.byCategory.map((row) => [row.category, row.amountXof]),
    ["Moyen de paiement des dépenses", "Montant (XOF)"], ...report.expenses.byMethod.map((row) => [methodLabel(row.method), row.amountXof]),
    [],
    ["Employé", "Ventes", "CA (XOF)", "Encaissé (XOF)", "Dépenses (XOF)"], ...report.employees.map((row) => [row.name, row.saleCount, row.revenueXof, row.collectedXof, row.expensesXof]),
  ];
  return csvDocument(rowsOut);
}
