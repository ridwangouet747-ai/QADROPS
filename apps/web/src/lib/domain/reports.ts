import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "../auth/permissions";
import { businessProfile, expense, inventoryLine, inventorySession, member, payment, paymentRefund, purchase, sale, saleLine } from "../db/schema";
import { CommercialError, type CommercialDatabase } from "./commercial";

const reportInputSchema = z.object({
  businessId: z.string().min(1), actorUserId: z.string().min(1), period: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]).default("monthly"),
  date: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(),
});
type ReportInput = z.infer<typeof reportInputSchema>;

type LocalDate = { year: number; month: number; day: number };
const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(value: string): LocalDate {
  const match = dateRegex.exec(value);
  if (!match) throw new CommercialError("La date doit respecter le format AAAA-MM-JJ.");
  const [year, month, day] = match.slice(1).map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month || normalized.getUTCDate() !== day) throw new CommercialError("Date invalide.");
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

function rangeFor(input: ReportInput, timeZone: string, now: Date) {
  let startDate: LocalDate;
  let endDate: LocalDate;
  let previousStartDate: LocalDate;
  let previousEndDate: LocalDate;
  if (input.period === "custom") {
    if (!input.startDate || !input.endDate) throw new CommercialError("Choisissez les dates de début et de fin.");
    startDate = parseLocalDate(input.startDate);
    const lastDay = parseLocalDate(input.endDate);
    const dayCount = (Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day) - Date.UTC(startDate.year, startDate.month - 1, startDate.day)) / 86_400_000 + 1;
    if (dayCount < 1 || dayCount > 366) throw new CommercialError("La période personnalisée doit couvrir entre 1 et 366 jours.");
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
  return {
    startDate: dateKey(startDate), endDate: dateKey(addDays(endDate, -1)),
    start: localMidnightUtc(startDate, timeZone), end: localMidnightUtc(endDate, timeZone),
    previousStart: localMidnightUtc(previousStartDate, timeZone), previousEnd: localMidnightUtc(previousEndDate, timeZone),
  };
}

const amount = (value: string | number | bigint | null | undefined) => BigInt(value ?? 0);
const decimal = (value: string | number | null | undefined) => String(value ?? "0");
function roundedAverage(total: bigint, count: bigint) { return count === 0n ? null : ((total + count / 2n) / count).toString(); }

export async function getCommercialReport(db: CommercialDatabase, raw: unknown, now = new Date()) {
  const input = reportInputSchema.parse(raw);
  const [membership] = await db.select({ role: member.role }).from(member).where(and(
    eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId),
  )).limit(1);
  if (!membership || !hasBusinessPermission(membership.role, "report", "read")) throw new CommercialError("Vous n’avez pas l’autorisation de consulter les rapports.", 403);
  const [business] = await db.select({ timezone: businessProfile.timezone }).from(businessProfile).where(eq(businessProfile.businessId, input.businessId)).limit(1);
  if (!business) throw new CommercialError("Commerce introuvable.", 404);
  const timezone = business.timezone;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new CommercialError("Le fuseau horaire du commerce est invalide.", 422); }
  const range = rangeFor(input, timezone, now);

  const [salesSummary, previousSalesSummary, paymentRows, refundSummary, expenseSummary, purchaseSummary, receivableRows, settlementRows, topProducts, costSummary, trendRows, inventorySummary] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${sale.totalXof}), 0)::text`, count: sql<string>`count(*)::text`, discounts: sql<string>`coalesce(sum(${sale.discountXof}), 0)::text` }).from(sale)
      .where(and(eq(sale.businessId, input.businessId), gte(sale.occurredAt, range.start), lt(sale.occurredAt, range.end), sql`${sale.status} in ('completed','partially_refunded','refunded')`)),
    db.select({ total: sql<string>`coalesce(sum(${sale.totalXof}), 0)::text` }).from(sale)
      .where(and(eq(sale.businessId, input.businessId), gte(sale.occurredAt, range.previousStart), lt(sale.occurredAt, range.previousEnd), sql`${sale.status} in ('completed','partially_refunded','refunded')`)),
    db.select({ method: payment.method, total: sql<string>`coalesce(sum(${payment.amountXof}), 0)::text` }).from(payment)
      .where(and(eq(payment.businessId, input.businessId), eq(payment.status, "confirmed"), gte(payment.confirmedAt, range.start), lt(payment.confirmedAt, range.end)))
      .groupBy(payment.method).orderBy(asc(payment.method)),
    db.select({ total: sql<string>`coalesce(sum(${paymentRefund.amountXof}), 0)::text`, count: sql<string>`count(*)::text` }).from(paymentRefund)
      .where(and(eq(paymentRefund.businessId, input.businessId), eq(paymentRefund.status, "confirmed"), gte(paymentRefund.occurredAt, range.start), lt(paymentRefund.occurredAt, range.end))),
    db.select({ total: sql<string>`coalesce(sum(${expense.amountXof}), 0)::text`, count: sql<string>`count(*)::text` }).from(expense)
      .where(and(eq(expense.businessId, input.businessId), gte(expense.occurredAt, range.start), lt(expense.occurredAt, range.end))),
    db.select({ total: sql<string>`coalesce(sum(${purchase.totalXof}), 0)::text`, count: sql<string>`count(*)::text` }).from(purchase)
      .where(and(eq(purchase.businessId, input.businessId), eq(purchase.status, "received"), gte(purchase.occurredAt, range.start), lt(purchase.occurredAt, range.end))),
    db.execute(sql`select count(*)::text as count, coalesce(sum(s.total_xof - coalesce(p.paid, 0)::bigint), 0)::text as total
      from sale s left join (select business_id, sale_id, sum(amount_xof) as paid from payment where business_id = ${input.businessId} and status = 'confirmed' and confirmed_at < ${range.end} group by business_id, sale_id) p on p.business_id = s.business_id and p.sale_id = s.id
      where s.business_id = ${input.businessId} and s.customer_id is not null and s.status <> 'voided' and s.occurred_at < ${range.end} and s.total_xof > coalesce(p.paid, 0)`) as Promise<{ rows: { count: string; total: string }[] }>,
    db.execute(sql`select
      count(*) filter (where coalesce(p.paid, 0) >= s.total_xof)::text as paid,
      count(*) filter (where coalesce(p.paid, 0) > 0 and coalesce(p.paid, 0) < s.total_xof)::text as partial,
      count(*) filter (where coalesce(p.paid, 0) = 0 and s.customer_id is not null)::text as credit
      from sale s left join (select business_id, sale_id, sum(amount_xof) as paid from payment where business_id = ${input.businessId} and status = 'confirmed' and confirmed_at < ${range.end} group by business_id, sale_id) p on p.business_id = s.business_id and p.sale_id = s.id
      where s.business_id = ${input.businessId} and s.status <> 'voided' and s.occurred_at >= ${range.start} and s.occurred_at < ${range.end}`) as Promise<{ rows: { paid: string; partial: string; credit: string }[] }>,
    db.select({ productName: saleLine.productNameSnapshot, quantity: sql<string>`sum(${saleLine.quantity})::text`, total: sql<string>`sum(${saleLine.lineTotalXof})::text` }).from(saleLine)
      .innerJoin(sale, and(eq(sale.businessId, saleLine.businessId), eq(sale.id, saleLine.saleId)))
      .where(and(eq(saleLine.businessId, input.businessId), gte(sale.occurredAt, range.start), lt(sale.occurredAt, range.end), sql`${sale.status} in ('completed','partially_refunded','refunded')`))
      .groupBy(saleLine.productNameSnapshot).orderBy(sql`sum(${saleLine.lineTotalXof}) desc`).limit(10),
    db.select({ unavailable: sql<string>`count(*) filter (where ${saleLine.costAvailable} = false)::text`, cogs: sql<string>`coalesce(sum(${saleLine.cogsXof}),0)::text` }).from(saleLine)
      .innerJoin(sale, and(eq(sale.businessId, saleLine.businessId), eq(sale.id, saleLine.saleId)))
      .where(and(eq(saleLine.businessId, input.businessId), gte(sale.occurredAt, range.start), lt(sale.occurredAt, range.end), sql`${sale.status} in ('completed','partially_refunded','refunded')`)),
    db.select({ bucket: sql<string>`to_char(date_trunc(${input.period === "yearly" ? "month" : "day"}, ${sale.occurredAt} at time zone ${timezone}), 'YYYY-MM-DD')`, total: sql<string>`sum(${sale.totalXof})::text` }).from(sale)
      .where(and(eq(sale.businessId, input.businessId), gte(sale.occurredAt, range.start), lt(sale.occurredAt, range.end), sql`${sale.status} in ('completed','partially_refunded','refunded')`))
      .groupBy(sql`1`).orderBy(asc(sql`1`)),
    db.select({ gain: sql<string>`coalesce(sum(greatest(${inventoryLine.countedQty} - ${inventoryLine.theoreticalQty}, 0)),0)::text`, loss: sql<string>`coalesce(sum(greatest(${inventoryLine.theoreticalQty} - ${inventoryLine.countedQty}, 0)),0)::text`, sessions: sql<string>`count(distinct ${inventorySession.id})::text` }).from(inventoryLine)
      .innerJoin(inventorySession, and(eq(inventorySession.businessId, inventoryLine.businessId), eq(inventorySession.id, inventoryLine.sessionId)))
      .where(and(eq(inventoryLine.businessId, input.businessId), eq(inventorySession.status, "validated"), gte(inventorySession.validatedAt, range.start), lt(inventorySession.validatedAt, range.end))),
  ]);

  const revenueXof = amount(salesSummary[0]?.total);
  const previousRevenueXof = amount(previousSalesSummary[0]?.total);
  const saleCount = amount(salesSummary[0]?.count);
  const paymentsByMethod = paymentRows.map((row) => ({ method: row.method, amountXof: row.total }));
  return {
    timezone, period: input.period, startDate: range.startDate, endDate: range.endDate, generatedAt: now.toISOString(),
    sales: { revenueXof: revenueXof.toString(), count: saleCount.toString(), averageBasketXof: roundedAverage(revenueXof, saleCount), discountXof: salesSummary[0]?.discounts ?? "0", previousRevenueXof: previousRevenueXof.toString(), changeXof: (revenueXof - previousRevenueXof).toString(), changePercent: previousRevenueXof === 0n ? null : (((revenueXof - previousRevenueXof) * 10_000n + (revenueXof >= previousRevenueXof ? previousRevenueXof / 2n : -previousRevenueXof / 2n)) / previousRevenueXof).toString() },
    settlement: { paid: settlementRows.rows[0]?.paid ?? "0", partial: settlementRows.rows[0]?.partial ?? "0", credit: settlementRows.rows[0]?.credit ?? "0" },
    collections: { totalXof: paymentsByMethod.reduce((sum, row) => sum + amount(row.amountXof), 0n).toString(), byMethod: paymentsByMethod },
    receivablesAsOf: { asOf: range.end.toISOString(), totalXof: receivableRows.rows[0]?.total ?? "0", count: receivableRows.rows[0]?.count ?? "0" },
    refunds: { totalXof: refundSummary[0]?.total ?? "0", count: refundSummary[0]?.count ?? "0" },
    expenses: { totalXof: expenseSummary[0]?.total ?? "0", count: expenseSummary[0]?.count ?? "0" },
    purchases: { totalXof: purchaseSummary[0]?.total ?? "0", count: purchaseSummary[0]?.count ?? "0" },
    grossMarginEstimate: amount(costSummary[0]?.unavailable) === 0n ? { available: true, amountXof: (revenueXof - amount(costSummary[0]?.cogs)).toString(), note: "Estimation avant remboursements; ce n’est pas un bénéfice net." } : { available: false, amountXof: null, note: "Coût d’achat manquant pour au moins une ligne vendue." },
    topProducts: topProducts.map((row) => ({ name: row.productName, quantity: decimal(row.quantity), revenueXof: row.total })),
    inventoryVariance: { gainQty: decimal(inventorySummary[0]?.gain), lossQty: decimal(inventorySummary[0]?.loss), validatedSessionCount: inventorySummary[0]?.sessions ?? "0" },
    trend: trendRows.map((row) => ({ date: row.bucket, revenueXof: row.total })),
  };
}

export type CommercialReport = Awaited<ReturnType<typeof getCommercialReport>>;

export function reportCsv(report: CommercialReport) {
  const rows: string[][] = [
    ["Rapport commercial QADR OPS", `${report.startDate} — ${report.endDate}`, `Fuseau: ${report.timezone}`, `Généré: ${report.generatedAt}`],
    ["Indicateur", "Valeur"],
    ["Chiffre d’affaires (XOF)", report.sales.revenueXof], ["Nombre de ventes", report.sales.count],
    ["Panier moyen (XOF)", report.sales.averageBasketXof ?? "Indisponible"], ["Remises (XOF)", report.sales.discountXof],
    ["Écart de CA vs période précédente (XOF)", report.sales.changeXof], ["Encaissements confirmés (XOF)", report.collections.totalXof],
    ["Créances ouvertes à la fin de période (XOF)", report.receivablesAsOf.totalXof], ["Remboursements confirmés (XOF)", report.refunds.totalXof],
    ["Dépenses (XOF)", report.expenses.totalXof], ["Achats reçus (XOF, présentés séparément)", report.purchases.totalXof],
    ["Marge brute estimée avant remboursements (XOF)", report.grossMarginEstimate.amountXof ?? report.grossMarginEstimate.note],
    ["Pertes d’inventaire (quantité)", report.inventoryVariance.lossQty], ["Gains d’inventaire (quantité)", report.inventoryVariance.gainQty],
    ["Produit", "Quantité vendue", "CA (XOF)"], ...report.topProducts.map((row) => [row.name, row.quantity, row.revenueXof]),
    ["Moyen de paiement", "Encaissements confirmés (XOF)"], ...report.collections.byMethod.map((row) => [row.method, row.amountXof]),
  ];
  const safeCell = (value: string) => {
    const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${rows.map((row) => row.map(safeCell).join(",")).join("\r\n")}`;
}
