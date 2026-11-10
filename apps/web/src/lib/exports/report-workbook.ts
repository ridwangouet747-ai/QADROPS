import type { ExportData, ExportSheetKey } from "@/lib/domain/exports";
import { localeDirection, type Locale } from "@/lib/i18n/config";
import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translate";
import { labelOf, localStamp, summaryRows, type SummaryValue } from "./report-summary";
import { buildXlsx, decimalCell, headingCell, integerCell, type XlsxCell, type XlsxLimits, type XlsxSheet } from "./xlsx";

/*
 * Classeur des exports (mission 11, phase 4). En-têtes et noms de feuilles dans la langue de
 * l'utilisateur ; feuilles de droite à gauche en arabe. Les données (noms de produits, de clients…)
 * ne sont jamais traduites. Montants : entiers ; quantités : décimales exactes.
 */

const money = (value: string | null): XlsxCell => (value === null ? null : integerCell(value));
const qty = (value: string | null): XlsxCell => (value === null ? null : decimalCell(value));

function summaryCell(value: SummaryValue | undefined): XlsxCell {
  if (!value) return null;
  if (value.kind === "xof" || value.kind === "count") return integerCell(value.value);
  if (value.kind === "quantity") return decimalCell(value.value);
  return value.value;
}

type Column<T> = { header: MessageKey; width: number; cell: (row: T, t: Translate) => XlsxCell };

function dataSheet<T>(name: string, columns: Column<T>[], data: { rows: T[]; truncated: boolean }, t: Translate, limit: number, rightToLeft: boolean): XlsxSheet {
  const rows: XlsxCell[][] = [columns.map((column) => headingCell(t(column.header)))];
  for (const row of data.rows) rows.push(columns.map((column) => column.cell(row, t)));
  if (data.rows.length === 0) rows.push([t("exports.summary.empty")]);
  if (data.truncated) rows.push([], [headingCell(t("exports.summary.truncatedRow", { limit }))]);
  return { name, rows, columnWidths: columns.map((column) => column.width), frozenRows: 1, rightToLeft };
}

const yesNo = (value: boolean, t: Translate) => t(value ? "exports.common.yes" : "exports.common.no");
const method = (value: string | null, t: Translate) => labelOf(t, "reports.methods", value, "reports.methods.unknown");

export function buildReportWorkbook(data: ExportData, locale: Locale, limits?: XlsxLimits) {
  const t = createTranslator(locale);
  const rtl = localeDirection[locale] === "rtl";
  const { report, sheets, limit } = data;
  const sheetName = (key: ExportSheetKey | "summary") => t(`exports.sheets.${key}` as MessageKey);

  // Synthèse : en-tête, indicateurs comparés, évolution, remarques (feuilles absentes ou tronquées).
  const summary: XlsxCell[][] = [
    [headingCell(t("exports.summary.title", { business: data.businessName }))],
    [t("exports.summary.period"), `${report.startDate} – ${report.endDate}`],
    [t("exports.summary.compared"), `${report.previousStartDate} – ${report.previousEndDate}`],
    [t("exports.summary.timezone"), report.timezone],
    [t("exports.summary.generated"), localStamp(report.generatedAt, report.timezone)],
    [t("exports.summary.currency")],
    [],
    [headingCell(t("exports.summary.indicator")), headingCell(t("exports.summary.current")), headingCell(t("exports.summary.previous"))],
    ...summaryRows(report, t).map((row) => [row.label, summaryCell(row.current), summaryCell(row.previous)]),
    [],
    [headingCell(t("exports.summary.trend")), headingCell(t("exports.summary.trendRevenue")), headingCell(t("exports.summary.trendCount")),
      headingCell(t("exports.summary.trendCollections")), headingCell(t("exports.summary.trendExpenses"))],
    ...report.trend.map((day) => [day.date, integerCell(day.revenueXof), integerCell(day.saleCount), integerCell(day.collectionsXof), integerCell(day.expensesXof)]),
    [],
    [headingCell(t("exports.summary.notes"))],
    [t("reports.definitions")],
    [t("exports.summary.snapshotNote")],
  ];
  if (data.omitted.length) summary.push([t("exports.summary.omitted", { sheets: data.omitted.map(sheetName).join(", ") })]);
  if (data.truncated.length) summary.push([t("exports.summary.truncated", { limit, sheets: data.truncated.map(sheetName).join(", ") })]);

  const workbook: XlsxSheet[] = [{ name: sheetName("summary"), rows: summary, columnWidths: [48, 20, 20, 20, 20], rightToLeft: rtl }];
  const add = <K extends ExportSheetKey>(key: K, columns: Column<NonNullable<ExportData["sheets"][K]>["rows"][number]>[]) => {
    const sheet = sheets[key];
    if (sheet) workbook.push(dataSheet(sheetName(key), columns, sheet as { rows: NonNullable<ExportData["sheets"][K]>["rows"]; truncated: boolean }, t, limit, rtl));
  };

  add("sales", [
    { header: "exports.columns.date", width: 18, cell: (row) => row.occurredAt },
    { header: "exports.columns.reference", width: 16, cell: (row) => row.reference },
    { header: "exports.columns.status", width: 20, cell: (row, tr) => labelOf(tr, "exports.status.sale", row.status) },
    { header: "exports.columns.customer", width: 24, cell: (row) => row.customerName },
    { header: "exports.columns.cashier", width: 20, cell: (row) => row.cashierName },
    { header: "exports.columns.subtotal", width: 14, cell: (row) => money(row.subtotalXof) },
    { header: "exports.columns.discount", width: 12, cell: (row) => money(row.discountXof) },
    { header: "exports.columns.total", width: 14, cell: (row) => money(row.totalXof) },
    { header: "exports.columns.paidAtEnd", width: 18, cell: (row) => money(row.paidXof) },
    { header: "exports.columns.dueAtEnd", width: 18, cell: (row) => money(row.dueXof) },
  ]);
  add("products", [
    { header: "exports.columns.product", width: 30, cell: (row) => row.name },
    { header: "exports.columns.variant", width: 16, cell: (row) => row.variant },
    { header: "exports.columns.sku", width: 14, cell: (row) => row.sku },
    { header: "exports.columns.barcode", width: 16, cell: (row) => row.barcode },
    { header: "exports.columns.category", width: 18, cell: (row) => row.category },
    { header: "exports.columns.unit", width: 10, cell: (row) => row.unit },
    { header: "exports.columns.salePrice", width: 14, cell: (row) => money(row.salePriceXof) },
    { header: "exports.columns.averageCost", width: 18, cell: (row) => (row.costKnown ? money(row.averageCostXof) : null) },
    { header: "exports.columns.costKnown", width: 10, cell: (row, tr) => yesNo(row.costKnown, tr) },
    { header: "exports.columns.onHand", width: 12, cell: (row) => qty(row.onHand) },
    { header: "exports.columns.lowStock", width: 12, cell: (row) => qty(row.lowStockThreshold) },
  ]);
  add("stock", [
    { header: "exports.columns.date", width: 18, cell: (row) => row.occurredAt },
    { header: "exports.columns.product", width: 30, cell: (row) => row.product },
    { header: "exports.columns.variant", width: 16, cell: (row) => row.variant },
    { header: "exports.columns.reason", width: 18, cell: (row, tr) => labelOf(tr, "reports.stock.reasons", row.reason) },
    { header: "exports.columns.quantity", width: 16, cell: (row) => qty(row.quantityDelta) },
    { header: "exports.columns.unitCost", width: 16, cell: (row) => money(row.unitCostXof) },
    { header: "exports.columns.by", width: 20, cell: (row) => row.createdBy },
  ]);
  add("customers", [
    { header: "exports.columns.name", width: 28, cell: (row) => row.name },
    { header: "exports.columns.phone", width: 18, cell: (row) => row.phone },
    { header: "exports.columns.notes", width: 40, cell: (row) => row.notes },
    { header: "exports.columns.createdAt", width: 12, cell: (row) => row.createdAt },
  ]);
  add("receivables", [
    { header: "exports.columns.customer", width: 28, cell: (row) => row.name },
    { header: "exports.columns.phone", width: 18, cell: (row) => row.phone },
    { header: "exports.columns.unpaidSales", width: 14, cell: (row) => integerCell(row.unpaidSales) },
    { header: "exports.columns.salesDue", width: 18, cell: (row) => money(row.salesDueXof) },
    { header: "exports.columns.openingDue", width: 18, cell: (row) => money(row.openingDueXof) },
    { header: "exports.columns.totalDue", width: 16, cell: (row) => money(row.totalDueXof) },
  ]);
  add("suppliers", [
    { header: "exports.columns.name", width: 28, cell: (row) => row.name },
    { header: "exports.columns.phone", width: 18, cell: (row) => row.phone },
    { header: "exports.columns.archived", width: 10, cell: (row, tr) => yesNo(row.archived, tr) },
    { header: "exports.columns.purchaseCount", width: 14, cell: (row) => integerCell(row.purchaseCount) },
    { header: "exports.columns.purchased", width: 18, cell: (row) => money(row.purchasedXof) },
    { header: "exports.columns.purchasesDue", width: 18, cell: (row) => money(row.purchasesDueXof) },
    { header: "exports.columns.openingDue", width: 18, cell: (row) => money(row.openingDueXof) },
    { header: "exports.columns.supplierTotalDue", width: 18, cell: (row) => money(row.totalDueXof) },
  ]);
  add("purchases", [
    { header: "exports.columns.date", width: 18, cell: (row) => row.occurredAt },
    { header: "exports.columns.reference", width: 16, cell: (row) => row.reference },
    { header: "exports.columns.supplier", width: 26, cell: (row) => row.supplier },
    { header: "exports.columns.status", width: 12, cell: (row, tr) => labelOf(tr, "exports.status.purchase", row.status) },
    { header: "exports.columns.total", width: 14, cell: (row) => money(row.totalXof) },
    { header: "exports.columns.paid", width: 18, cell: (row) => money(row.paidXof) },
    { header: "exports.columns.due", width: 16, cell: (row) => money(row.dueXof) },
  ]);
  add("expenses", [
    { header: "exports.columns.date", width: 18, cell: (row) => row.occurredAt },
    { header: "exports.columns.category", width: 18, cell: (row) => row.category },
    { header: "exports.columns.description", width: 36, cell: (row) => row.description },
    { header: "exports.columns.method", width: 14, cell: (row, tr) => method(row.method, tr) },
    { header: "exports.columns.amount", width: 14, cell: (row) => money(row.amountXof) },
    { header: "exports.columns.paidBy", width: 20, cell: (row) => row.paidBy },
  ]);
  add("payments", [
    { header: "exports.columns.date", width: 18, cell: (row) => row.occurredAt },
    { header: "exports.columns.confirmedAt", width: 18, cell: (row) => row.confirmedAt },
    { header: "exports.columns.sale", width: 16, cell: (row) => row.saleReference },
    { header: "exports.columns.method", width: 14, cell: (row, tr) => method(row.method, tr) },
    { header: "exports.columns.status", width: 16, cell: (row, tr) => labelOf(tr, "exports.status.payment", row.status) },
    { header: "exports.columns.amount", width: 14, cell: (row) => money(row.amountXof) },
    { header: "exports.columns.settlement", width: 12, cell: (row, tr) => yesNo(row.settlement, tr) },
    { header: "exports.columns.collectedInPeriod", width: 18, cell: (row, tr) => yesNo(row.collectedInPeriod, tr) },
    { header: "exports.columns.recordedBy", width: 20, cell: (row) => row.recordedBy },
  ]);
  return buildXlsx(workbook, limits);
}

export function workbookFileName(data: ExportData) {
  return `qadr-ops-classeur-${data.report.startDate}-${data.report.endDate}.xlsx`;
}
