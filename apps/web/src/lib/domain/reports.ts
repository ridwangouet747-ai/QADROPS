import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { businessProfile, member } from "../db/schema";
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

/** Chiffres de base d'une période, calculés de la même façon pour la période et sa comparaison (une seule requête). */
async function coreTotals(db: CommercialDatabase, businessId: string, start: Date, end: Date) {
  const [row] = await rows<Record<string, string>>(db, sql`select
    (select coalesce(sum(s.total_xof), 0) from sale s where s.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as revenue,
    (select count(*) from sale s where s.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as sale_count,
    (select coalesce(sum(s.discount_xof), 0) from sale s where s.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as discounts,
    (select coalesce(sum(l.quantity), 0) from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as items,
    (select coalesce(sum(l.cogs_xof) filter (where l.cost_available), 0) from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as cogs_known,
    (select coalesce(sum(l.line_total_xof) filter (where l.cost_available), 0) from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as known_revenue,
    (select count(*) filter (where not l.cost_available) from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${businessId} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as unknown_lines,
    (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = ${businessId} and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end})::text as collected,
    (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = ${businessId} and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end}
      and exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id))::text as settlements,
    (select coalesce(sum(op.amount_xof), 0) from opening_balance_payment op join opening_balance b on b.business_id = op.business_id and b.id = op.opening_balance_id
      where op.business_id = ${businessId} and b.party_type = 'customer' and op.occurred_at >= ${start} and op.occurred_at < ${end})::text as opening_recovered,
    (select count(*) from opening_balance_payment op join opening_balance b on b.business_id = op.business_id and b.id = op.opening_balance_id
      where op.business_id = ${businessId} and b.party_type = 'customer' and op.occurred_at >= ${start} and op.occurred_at < ${end})::text as opening_recovered_count,
    (select coalesce(sum(e.amount_xof), 0) from expense e where e.business_id = ${businessId} and e.occurred_at >= ${start} and e.occurred_at < ${end})::text as expenses,
    (select count(*) from expense e where e.business_id = ${businessId} and e.occurred_at >= ${start} and e.occurred_at < ${end})::text as expense_count,
    (select coalesce(sum(greatest(s.total_xof - coalesce((select sum(p.amount_xof) from payment p where p.business_id = s.business_id and p.sale_id = s.id and p.status <> 'failed'
        and not exists (select 1 from receivable_payment r where r.business_id = p.business_id and r.payment_id = p.id)), 0), 0)), 0)
      from sale s where s.business_id = ${businessId} and s.customer_id is not null and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as credit_granted,
    (select coalesce(sum(rf.amount_xof), 0) from payment_refund rf where rf.business_id = ${businessId} and rf.status = 'confirmed' and rf.occurred_at >= ${start} and rf.occurred_at < ${end})::text as refunds,
    (select count(*) from payment_refund rf where rf.business_id = ${businessId} and rf.status = 'confirmed' and rf.occurred_at >= ${start} and rf.occurred_at < ${end})::text as refund_count
  `);
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

export async function getCommercialReport(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = reportInputSchema.parse(raw);
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
  )).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, "report", "read")) throw new CommercialError("Vous n’avez pas l’autorisation de consulter les rapports.", 403, "forbidden");
  const [business] = await db.select({ timezone: businessProfile.timezone }).from(businessProfile).where(eq(businessProfile.businessId, input.businessId)).limit(1);
  if (!business) throw new CommercialError("Commerce introuvable.", 404);
  const timezone = business.timezone;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new CommercialError("Le fuseau horaire du commerce est invalide.", 422); }
  const range = reportRange(input, timezone, now);
  const b = input.businessId;
  const { start, end } = range;
  const bucketUnit = input.period === "yearly" ? "month" : "day";
  const full = input.detail === "full";

  const [current, previous, pendingRows, methodRows, settlementRows, receivableRows, openingCustomerRows, purchaseRows, topRows, trendRows, collectionTrendRows, expenseTrendRows, inventoryRows] = await Promise.all([
    coreTotals(db, b, start, end),
    coreTotals(db, b, range.previousStart, range.previousEnd),
    rows<{ method: string; total: string; count: string }>(db, sql`select p.method, sum(p.amount_xof)::text as total, count(*)::text as count from payment p
      where p.business_id = ${b} and p.status = 'pending' and p.occurred_at >= ${start} and p.occurred_at < ${end} group by p.method order by p.method`),
    rows<{ method: string; total: string }>(db, sql`select p.method, sum(p.amount_xof)::text as total from payment p
      where p.business_id = ${b} and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end} group by p.method order by p.method`),
    rows<{ paid: string; partial: string; credit: string; mixed: string }>(db, sql`select
      count(*) filter (where coalesce(p.paid, 0) >= s.total_xof)::text as paid,
      count(*) filter (where coalesce(p.paid, 0) > 0 and coalesce(p.paid, 0) < s.total_xof)::text as partial,
      count(*) filter (where coalesce(p.paid, 0) = 0 and s.customer_id is not null)::text as credit,
      count(*) filter (where coalesce(p.methods, 0) >= 2)::text as mixed
      from sale s left join (select sale_id, sum(amount_xof) filter (where status in ${collectedStatuses} and confirmed_at < ${end}) as paid,
        count(distinct method) filter (where status <> 'failed') as methods from payment where business_id = ${b} group by sale_id) p on p.sale_id = s.id
      where s.business_id = ${b} and s.status <> 'voided' and s.occurred_at >= ${start} and s.occurred_at < ${end}`),
    rows<{ count: string; total: string }>(db, sql`select count(*)::text as count, coalesce(sum(s.total_xof - coalesce(p.paid, 0)), 0)::text as total
      from sale s left join (select sale_id, sum(amount_xof) as paid from payment where business_id = ${b} and status in ${collectedStatuses} and confirmed_at < ${end} group by sale_id) p on p.sale_id = s.id
      where s.business_id = ${b} and s.customer_id is not null and s.status <> 'voided' and s.occurred_at < ${end} and s.total_xof > coalesce(p.paid, 0)`),
    rows<{ remaining: string }>(db, sql`select coalesce(sum(greatest(b.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op
        where op.business_id = b.business_id and op.opening_balance_id = b.id and op.occurred_at < ${end}), 0), 0)), 0)::text as remaining
      from opening_balance b where b.business_id = ${b} and b.party_type = 'customer' and b.created_at < ${end}`),
    rows<{ total: string; count: string; paid: string }>(db, sql`select coalesce(sum(total_xof), 0)::text as total, count(*)::text as count,
      (select coalesce(sum(pp.amount_xof), 0) from purchase_payment pp where pp.business_id = ${b} and pp.occurred_at >= ${start} and pp.occurred_at < ${end})::text as paid
      from purchase where business_id = ${b} and status = 'received' and occurred_at >= ${start} and occurred_at < ${end}`),
    rows<{ name: string; quantity: string; total: string }>(db, sql`select l.product_name_snapshot as name, sum(l.quantity)::text as quantity, sum(l.line_total_xof)::text as total
      from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      where l.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses}
      group by l.product_name_snapshot order by sum(l.line_total_xof) desc, l.product_name_snapshot limit 10`),
    rows<{ bucket: string; total: string; count: string }>(db, sql`select to_char(date_trunc(${bucketUnit}, s.occurred_at at time zone ${timezone}), 'YYYY-MM-DD') as bucket,
      sum(s.total_xof)::text as total, count(*)::text as count from sale s
      where s.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses} group by 1 order by 1`),
    full ? rows<{ bucket: string; total: string }>(db, sql`select to_char(date_trunc(${bucketUnit}, p.confirmed_at at time zone ${timezone}), 'YYYY-MM-DD') as bucket, sum(p.amount_xof)::text as total
      from payment p where p.business_id = ${b} and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end} group by 1 order by 1`) : Promise.resolve([]),
    full ? rows<{ bucket: string; total: string }>(db, sql`select to_char(date_trunc(${bucketUnit}, e.occurred_at at time zone ${timezone}), 'YYYY-MM-DD') as bucket, sum(e.amount_xof)::text as total
      from expense e where e.business_id = ${b} and e.occurred_at >= ${start} and e.occurred_at < ${end} group by 1 order by 1`) : Promise.resolve([]),
    rows<{ gain: string; loss: string; sessions: string }>(db, sql`select coalesce(sum(greatest(l.counted_qty - l.theoretical_qty, 0)), 0)::text as gain,
      coalesce(sum(greatest(l.theoretical_qty - l.counted_qty, 0)), 0)::text as loss, count(distinct s.id)::text as sessions
      from inventory_line l join inventory_session s on s.business_id = l.business_id and s.id = l.session_id
      where l.business_id = ${b} and s.status = 'validated' and s.validated_at >= ${start} and s.validated_at < ${end}`),
  ]);

  const details = full ? await reportDetails(db, b, start, end) : null;

  const trendMap = new Map(trendRows.map((row) => [row.bucket, row]));
  const collectionMap = new Map(collectionTrendRows.map((row) => [row.bucket, row.total]));
  const expenseMap = new Map(expenseTrendRows.map((row) => [row.bucket, row.total]));
  const supplierPaid = amount(purchaseRows[0]?.paid);
  const settlement = settlementRows[0];
  const pendingTotal = pendingRows.reduce((sum, row) => sum + amount(row.total), 0n);
  const openingOutstanding = amount(openingCustomerRows[0]?.remaining);
  const receivables = amount(receivableRows[0]?.total);
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
      byMethod: methodRows.map((row) => ({ method: row.method, amountXof: row.total })),
      pending: { totalXof: pendingTotal.toString(), count: pendingRows.reduce((sum, row) => sum + amount(row.count), 0n).toString(), byMethod: pendingRows.map((row) => ({ method: row.method, amountXof: row.total, count: row.count })) },
      openingRecoveries: { totalXof: current.openingRecovered.toString(), count: current.openingRecoveredCount.toString() },
    },
    receivablesAsOf: { asOf: end.toISOString(), totalXof: receivables.toString(), count: receivableRows[0]?.count ?? "0" },
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
    purchases: { totalXof: purchaseRows[0]?.total ?? "0", count: purchaseRows[0]?.count ?? "0", paidXof: supplierPaid.toString() },
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
    topProducts: topRows.map((row) => ({ name: row.name, quantity: decimal(row.quantity), revenueXof: row.total })),
    slowProducts: details?.slowProducts ?? [],
    stock: details?.stock ?? null,
    employees: details?.employees ?? [],
    inventoryVariance: { gainQty: decimal(inventoryRows[0]?.gain), lossQty: decimal(inventoryRows[0]?.loss), validatedSessionCount: inventoryRows[0]?.sessions ?? "0" },
    trend: range.buckets.map((bucket) => ({ date: bucket, revenueXof: trendMap.get(bucket)?.total ?? "0", saleCount: trendMap.get(bucket)?.count ?? "0",
      collectionsXof: collectionMap.get(bucket) ?? "0", expensesXof: expenseMap.get(bucket) ?? "0" })),
  };
}

/** Sections détaillées : catégories, dépenses ventilées, stock, produits peu vendus, employés, dettes fournisseurs. */
async function reportDetails(db: CommercialDatabase, b: string, start: Date, end: Date) {
  const [categories, expenseCategories, expenseMethods, stockReasons, notable, slow, employees, supplierDebt, supplierOpeningPaid] = await Promise.all([
    rows<{ category: string | null; quantity: string; total: string }>(db, sql`select c.name as category, sum(l.quantity)::text as quantity, sum(l.line_total_xof)::text as total
      from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
      join product_variant v on v.business_id = l.business_id and v.id = l.variant_id
      join product p on p.business_id = v.business_id and p.id = v.product_id
      left join product_category c on c.business_id = p.business_id and c.id = p.category_id
      where l.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses}
      group by c.name order by sum(l.line_total_xof) desc, c.name nulls last limit 20`),
    rows<{ category: string; total: string; count: string }>(db, sql`select category, sum(amount_xof)::text as total, count(*)::text as count from expense
      where business_id = ${b} and occurred_at >= ${start} and occurred_at < ${end} group by category order by sum(amount_xof) desc, category limit 20`),
    rows<{ method: string | null; total: string }>(db, sql`select payment_method as method, sum(amount_xof)::text as total from expense
      where business_id = ${b} and occurred_at >= ${start} and occurred_at < ${end} group by payment_method order by payment_method nulls last`),
    rows<{ reason: string; incoming: string; outgoing: string; count: string; value: string | null }>(db, sql`select reason,
      coalesce(sum(quantity_delta) filter (where quantity_delta > 0), 0)::text as incoming, coalesce(-sum(quantity_delta) filter (where quantity_delta < 0), 0)::text as outgoing,
      count(*)::text as count, round(sum(quantity_delta * unit_cost_xof))::bigint::text as value
      from stock_movement where business_id = ${b} and occurred_at >= ${start} and occurred_at < ${end} group by reason order by reason`),
    // Mouvements importants : hors ventes (déjà résumées), les plus grandes quantités en valeur absolue.
    rows<{ product: string; variant: string; reason: string; delta: string; occurredAt: Date }>(db, sql`select p.name as product, v.label as variant, m.reason, m.quantity_delta::text as delta, m.occurred_at as "occurredAt"
      from stock_movement m join product_variant v on v.business_id = m.business_id and v.id = m.variant_id join product p on p.business_id = v.business_id and p.id = v.product_id
      where m.business_id = ${b} and m.reason <> 'sale' and m.occurred_at >= ${start} and m.occurred_at < ${end} order by abs(m.quantity_delta) desc, m.occurred_at desc limit 5`),
    // Produits peu vendus : articles actifs en stock, classés par quantité vendue sur la période (zéro compris).
    rows<{ name: string; variant: string; onHand: string; quantity: string }>(db, sql`select p.name, v.label as variant, v.on_hand::text as "onHand", coalesce(sold.quantity, 0)::text as quantity
      from product_variant v join product p on p.business_id = v.business_id and p.id = v.product_id
      left join (select l.variant_id, sum(l.quantity) as quantity from sale_line l join sale s on s.business_id = l.business_id and s.id = l.sale_id
        where l.business_id = ${b} and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses} group by l.variant_id) sold on sold.variant_id = v.id
      where v.business_id = ${b} and v.archived_at is null and p.archived_at is null and v.on_hand > 0
      order by coalesce(sold.quantity, 0) asc, v.on_hand desc, p.name limit 5`),
    rows<{ userId: string; name: string; sales: string; revenue: string; collected: string; expenses: string }>(db, sql`select m.user_id as "userId", u.name,
      (select count(*) from sale s where s.business_id = m.organization_id and s.cashier_user_id = m.user_id and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as sales,
      (select coalesce(sum(s.total_xof), 0) from sale s where s.business_id = m.organization_id and s.cashier_user_id = m.user_id and s.occurred_at >= ${start} and s.occurred_at < ${end} and s.status in ${soldStatuses})::text as revenue,
      (select coalesce(sum(p.amount_xof), 0) from payment p where p.business_id = m.organization_id and p.recorded_by_user_id = m.user_id and p.status in ${collectedStatuses} and p.confirmed_at >= ${start} and p.confirmed_at < ${end})::text as collected,
      (select coalesce(sum(e.amount_xof), 0) from expense e where e.business_id = m.organization_id and e.paid_by_user_id = m.user_id and e.occurred_at >= ${start} and e.occurred_at < ${end})::text as expenses
      from member m join "user" u on u.id = m.user_id where m.organization_id = ${b} order by u.name`),
    rows<{ purchases: string; paid: string; opening: string }>(db, sql`select
      (select coalesce(sum(total_xof), 0) from purchase where business_id = ${b} and status = 'received' and occurred_at < ${end})::text as purchases,
      (select coalesce(sum(pp.amount_xof), 0) from purchase_payment pp join purchase pu on pu.business_id = pp.business_id and pu.id = pp.purchase_id
        where pp.business_id = ${b} and pu.status = 'received' and pp.occurred_at < ${end})::text as paid,
      (select coalesce(sum(greatest(ob.amount_xof - coalesce((select sum(op.amount_xof) from opening_balance_payment op where op.business_id = ob.business_id and op.opening_balance_id = ob.id and op.occurred_at < ${end}), 0), 0)), 0)
        from opening_balance ob where ob.business_id = ${b} and ob.party_type = 'supplier' and ob.created_at < ${end})::text as opening`),
    rows<{ total: string }>(db, sql`select coalesce(sum(op.amount_xof), 0)::text as total from opening_balance_payment op join opening_balance ob on ob.business_id = op.business_id and ob.id = op.opening_balance_id
      where op.business_id = ${b} and ob.party_type = 'supplier' and op.occurred_at >= ${start} and op.occurred_at < ${end}`),
  ]);
  const debt = supplierDebt[0];
  const purchasesDue = amount(debt?.purchases) - amount(debt?.paid);
  return {
    categories: categories.map((row) => ({ category: row.category, quantity: decimal(row.quantity), revenueXof: row.total })),
    expenseCategories: expenseCategories.map((row) => ({ category: row.category, amountXof: row.total, count: row.count })),
    expenseMethods: expenseMethods.map((row) => ({ method: row.method, amountXof: row.total })),
    stock: {
      byReason: stockReasons.map((row) => ({ reason: row.reason, incomingQty: decimal(row.incoming), outgoingQty: decimal(row.outgoing), count: row.count, valueAtCostXof: row.value })),
      notable: notable.map((row) => ({ product: row.product, variant: row.variant, reason: row.reason, quantityDelta: row.delta, occurredAt: new Date(row.occurredAt).toISOString() })),
    },
    slowProducts: slow.map((row) => ({ name: row.name, variant: row.variant, onHand: decimal(row.onHand), quantitySold: decimal(row.quantity) })),
    employees: employees.filter((row) => row.sales !== "0" || row.collected !== "0" || row.expenses !== "0")
      .map((row) => ({ userId: row.userId, name: row.name, saleCount: row.sales, revenueXof: row.revenue, collectedXof: row.collected, expensesXof: row.expenses })),
    supplierDebt: { purchasesDueXof: purchasesDue.toString(), openingDueXof: amount(debt?.opening).toString(), totalXof: (purchasesDue + amount(debt?.opening)).toString() },
    supplierOpeningPaid: amount(supplierOpeningPaid[0]?.total),
  };
}

export type CommercialReport = Awaited<ReturnType<typeof getCommercialReport>>;

/** Cellule CSV neutralisée : une valeur qui commence par = + - @ (ou une tabulation) ne peut pas devenir une formule. */
export function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

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
  return `\uFEFF${rowsOut.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
