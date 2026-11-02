import type { CommercialReport } from "@/lib/domain/reports";
import type { Translate } from "@/lib/i18n/translate";

/*
 * Lignes de synthèse d'un rapport, partagées par la feuille « Synthèse » du classeur et le PDF.
 * Aucune valeur n'est recalculée ici : tout vient de getCommercialReport (reports.ts).
 */

export type SummaryValue =
  | { kind: "xof"; value: string }
  | { kind: "count"; value: string }
  | { kind: "quantity"; value: string }
  | { kind: "text"; value: string };

export type SummaryRow = { label: string; current: SummaryValue; previous?: SummaryValue };

const xof = (value: string): SummaryValue => ({ kind: "xof", value });
const count = (value: string): SummaryValue => ({ kind: "count", value });
const quantity = (value: string): SummaryValue => ({ kind: "quantity", value });
const text = (value: string): SummaryValue => ({ kind: "text", value });

export function summaryRows(report: CommercialReport, t: Translate): SummaryRow[] {
  const c = report.comparison;
  return [
    { label: t("reports.comparison.revenue"), current: xof(report.sales.revenueXof), previous: xof(report.sales.previousRevenueXof) },
    { label: t("reports.comparison.saleCount"), current: count(report.sales.count), previous: count(report.sales.previousCount) },
    { label: t("reports.sales.items"), current: quantity(report.sales.itemsSold) },
    { label: t("reports.sales.basket"), current: report.sales.averageBasketXof === null ? text("—") : xof(report.sales.averageBasketXof) },
    { label: t("reports.sales.discounts"), current: xof(report.sales.discountXof) },
    { label: t("reports.comparison.collections"), current: xof(report.collections.totalXof), previous: xof(c.collections.previousXof) },
    { label: t("reports.collections.atSale"), current: xof(report.collections.atSaleXof) },
    { label: t("reports.comparison.settlements"), current: xof(report.collections.settlementsXof), previous: xof(c.settlements.previousXof) },
    { label: t("exports.summary.pending"), current: xof(report.collections.pending.totalXof) },
    { label: t("reports.collections.opening"), current: xof(report.collections.openingRecoveries.totalXof) },
    { label: t("reports.collections.mixed"), current: count(report.settlement.mixed) },
    { label: t("reports.comparison.creditGranted"), current: xof(report.credit.grantedXof), previous: xof(c.creditGranted.previousXof) },
    { label: t("reports.credit.outstandingSales"), current: xof(report.credit.outstandingSalesXof) },
    { label: t("reports.credit.openingOutstanding"), current: xof(report.credit.openingOutstandingXof) },
    { label: t("reports.credit.total"), current: xof(report.credit.totalOutstandingXof) },
    { label: t("reports.result.refunds"), current: xof(report.refunds.totalXof) },
    { label: t("reports.comparison.expenses"), current: xof(report.expenses.totalXof), previous: xof(c.expenses.previousXof) },
    { label: t("reports.result.purchases"), current: xof(report.purchases.totalXof) },
    { label: t("reports.result.supplierPaid"), current: xof(report.purchases.paidXof) },
    { label: t("reports.result.supplierDebt"), current: report.supplierDebt ? xof(report.supplierDebt.totalXof) : text("—") },
    {
      label: t("reports.kpi.margin"),
      current: report.margin.complete && report.margin.amountXof !== null ? xof(report.margin.amountXof) : text(t("reports.kpi.marginIncomplete")),
      previous: report.margin.previousAmountXof === null ? undefined : xof(report.margin.previousAmountXof),
    },
    { label: t("reports.result.marginKnown"), current: xof(report.margin.marginOnKnownXof) },
    { label: t("reports.result.unknownLines"), current: count(report.margin.unknownCostLines) },
    { label: t("reports.result.operating"), current: report.operatingEstimate.amountXof === null ? text(t("reports.result.operatingUnavailable")) : xof(report.operatingEstimate.amountXof) },
    { label: t("reports.result.cashIn"), current: xof(report.cashFlow.inXof) },
    { label: t("reports.result.cashOut"), current: xof(report.cashFlow.outXof) },
    { label: t("reports.result.cashNet"), current: xof(report.cashFlow.netXof) },
    { label: t("exports.summary.inventoryLoss"), current: quantity(report.inventoryVariance.lossQty) },
    { label: t("exports.summary.inventoryGain"), current: quantity(report.inventoryVariance.gainQty) },
  ];
}

/** « AAAA-MM-JJ HH:MM » dans le fuseau du commerce (même présentation que les dates des feuilles). */
export function localStamp(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Libellé traduit d'une valeur connue (moyen, statut, motif), ou la valeur brute si elle est inconnue. */
export function labelOf(t: Translate, prefix: string, value: string | null, fallbackKey?: string) {
  if (value === null) return fallbackKey ? t(fallbackKey as never) : "";
  const key = `${prefix}.${value}`;
  const label = t(key as never);
  return label === key ? value : label;
}
