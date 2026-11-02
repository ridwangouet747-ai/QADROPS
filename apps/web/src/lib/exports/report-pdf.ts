import type { CommercialReport } from "@/lib/domain/reports";
import { formatQuantity, formatXof } from "@/lib/i18n/format";
import { intlLocale } from "@/lib/i18n/config";
import { createTranslator, type Translate } from "@/lib/i18n/translate";
import { fitText, hasUnsupportedCharacters, PdfPage, renderPdf, wrapText, type PdfColor } from "./pdf";
import { labelOf, localStamp, summaryRows, type SummaryValue } from "./report-summary";

/*
 * Rapport commercial en PDF (mission 11, phase 4), généré côté serveur, en mémoire. Langues : français
 * et anglais seulement (polices standard WinAnsi, voir pdf.ts) ; l'arabe passe par « Imprimer » ou le
 * classeur Excel. Les chiffres sont ceux de getCommercialReport, formatés sans flottant.
 */

export type PdfLocale = "fr" | "en";
export const pdfLocales: readonly PdfLocale[] = ["fr", "en"];

const INK: PdfColor = [0.07, 0.09, 0.15];
const MUTED: PdfColor = [0.39, 0.45, 0.55];
const PRIMARY: PdfColor = [0.15, 0.39, 0.92];
const BAND: PdfColor = [0.95, 0.96, 0.98];

const MARGIN = 42;
const BOTTOM = 56;

type ColumnSpec = { width: number; align?: "left" | "right" };

class Layout {
  readonly pages: PdfPage[] = [];
  private page!: PdfPage;
  private y = 0;
  unsupported = false;

  constructor(private readonly t: Translate) { this.newPage(); }

  private newPage() {
    this.page = new PdfPage();
    this.pages.push(this.page);
    this.y = this.page.height - MARGIN;
  }

  get contentWidth() { return this.page.width - 2 * MARGIN; }

  private ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  private write(text: string, x: number, y: number, options: Parameters<PdfPage["text"]>[3] = {}) {
    if (hasUnsupportedCharacters(text)) this.unsupported = true;
    this.page.text(text, x, y, options);
  }

  heading(text: string, size = 13) {
    this.ensure(size + 26);
    this.y -= 14;
    this.write(fitText(text, this.contentWidth, size, true), MARGIN, this.y - size, { size, bold: true, color: PRIMARY });
    this.y -= size + 8;
  }

  paragraph(text: string, size = 9, color: PdfColor = MUTED) {
    for (const line of wrapText(text, this.contentWidth, size)) {
      this.ensure(size + 4);
      this.write(line, MARGIN, this.y - size, { size, color });
      this.y -= size + 4;
    }
  }

  /** Tableau : en-tête en gras, lignes alternées, texte coupé à la largeur de sa colonne. */
  table(columns: ColumnSpec[], header: string[], rows: string[][], size = 9) {
    const rowHeight = size + 7;
    const drawHeader = () => {
      this.ensure(rowHeight * 2);
      this.drawRow(columns, header, size, true);
      this.page.line(MARGIN, this.y + 2, MARGIN + this.contentWidth, this.y + 2, MUTED, 0.8);
    };
    drawHeader();
    rows.forEach((row, index) => {
      if (this.y - rowHeight < BOTTOM) { this.newPage(); drawHeader(); }
      if (index % 2 === 1) this.page.rect(MARGIN, this.y - rowHeight + 2, this.contentWidth, rowHeight, BAND);
      this.drawRow(columns, row, size, false);
    });
    this.y -= 4;
  }

  private drawRow(columns: ColumnSpec[], cells: string[], size: number, bold: boolean) {
    const rowHeight = size + 7;
    let x = MARGIN;
    columns.forEach((column, index) => {
      const text = fitText(cells[index] ?? "", column.width - 6, size, bold);
      const right = column.align === "right";
      this.write(text, right ? x + column.width - 3 : x + 3, this.y - size - 1, { size, bold, color: INK, align: right ? "right" : "left" });
      x += column.width;
    });
    this.y -= rowHeight;
  }

  footer(producedBy: string) {
    this.pages.forEach((page, index) => {
      page.line(MARGIN, 40, page.width - MARGIN, 40);
      page.text(producedBy, MARGIN, 28, { size: 8, color: MUTED });
      page.text(this.t("exports.document.page", { page: index + 1, pages: this.pages.length }), page.width - MARGIN, 28, { size: 8, color: MUTED, align: "right" });
    });
  }
}

export function buildReportPdf(report: CommercialReport, businessName: string, locale: PdfLocale) {
  const t = createTranslator(locale);
  const money = (value: string | null) => formatXof(value, locale);
  const integer = (value: string) => new Intl.NumberFormat(intlLocale[locale]).format(BigInt(value));
  const show = (value: SummaryValue | undefined) => {
    if (!value) return "";
    if (value.kind === "xof") return money(value.value);
    if (value.kind === "count") return integer(value.value);
    if (value.kind === "quantity") return formatQuantity(value.value, locale);
    return value.value;
  };
  const colon = locale === "fr" ? " : " : ": ";
  const layout = new Layout(t);
  const width = layout.contentWidth;

  layout.heading(businessName || t("exports.document.title"), 16);
  layout.paragraph(t("exports.document.title"), 11, INK);
  layout.paragraph(`${t("exports.summary.period")}${colon}${report.startDate} – ${report.endDate} · ${t("exports.summary.compared")}${colon}${report.previousStartDate} – ${report.previousEndDate}`);
  layout.paragraph(`${t("exports.summary.timezone")}${colon}${report.timezone} · ${t("exports.summary.generated")}${colon}${localStamp(report.generatedAt, report.timezone)}`);

  layout.heading(t("exports.document.indicators"));
  layout.table([{ width: width - 220 }, { width: 110, align: "right" }, { width: 110, align: "right" }],
    [t("exports.summary.indicator"), t("exports.summary.current"), t("exports.summary.previous")],
    summaryRows(report, t).map((row) => [row.label, show(row.current), show(row.previous)]));

  layout.heading(t("exports.summary.trend"));
  layout.table([{ width: width - 360 }, { width: 100, align: "right" }, { width: 60, align: "right" }, { width: 100, align: "right" }, { width: 100, align: "right" }],
    [t("exports.columns.date"), t("exports.summary.trendRevenue"), t("exports.summary.trendCount"), t("exports.summary.trendCollections"), t("exports.summary.trendExpenses")],
    report.trend.map((day) => [day.date, money(day.revenueXof), integer(day.saleCount), money(day.collectionsXof), money(day.expensesXof)]));

  const section = (title: string, columns: ColumnSpec[], header: string[], rows: string[][]) => {
    if (!rows.length) return;
    layout.heading(title);
    layout.table(columns, header, rows);
  };
  const threeColumns: ColumnSpec[] = [{ width: width - 220 }, { width: 100, align: "right" }, { width: 120, align: "right" }];
  section(t("exports.document.topProducts"), threeColumns, [t("exports.columns.product"), t("reports.sales.items"), t("reports.comparison.revenue")],
    report.topProducts.map((row) => [row.name, formatQuantity(row.quantity, locale), money(row.revenueXof)]));
  section(t("exports.document.categories"), threeColumns, [t("exports.columns.category"), t("reports.sales.items"), t("reports.comparison.revenue")],
    report.sales.byCategory.map((row) => [row.category ?? t("reports.sales.noCategory"), formatQuantity(row.quantity, locale), money(row.revenueXof)]));
  section(t("exports.document.methods"), [{ width: width - 120 }, { width: 120, align: "right" }], [t("exports.columns.method"), t("exports.columns.amount")],
    report.collections.byMethod.map((row) => [labelOf(t, "reports.methods", row.method), money(row.amountXof)]));
  section(t("exports.document.expenseCategories"), threeColumns, [t("exports.columns.category"), t("reports.expenses.recorded"), t("exports.columns.amount")],
    report.expenses.byCategory.map((row) => [row.category, integer(row.count), money(row.amountXof)]));
  section(t("exports.document.employees"), [{ width: width - 330 }, { width: 60, align: "right" }, { width: 90, align: "right" }, { width: 90, align: "right" }, { width: 90, align: "right" }],
    [t("reports.employees.name"), t("reports.employees.sales"), t("reports.employees.revenue"), t("reports.employees.collected"), t("reports.employees.expenses")],
    report.employees.map((row) => [row.name, integer(row.saleCount), money(row.revenueXof), money(row.collectedXof), money(row.expensesXof)]));

  layout.heading(t("exports.summary.notes"), 11);
  layout.paragraph(t("exports.summary.currency"));
  layout.paragraph(t("reports.definitions"));
  if (layout.unsupported) layout.paragraph(t("exports.document.unsupportedCharacters"), 9, INK);
  layout.footer(t("exports.document.producedBy"));
  return renderPdf(layout.pages, { title: `${t("exports.document.title")} ${report.startDate} ${report.endDate}` });
}

export function reportPdfFileName(report: CommercialReport) {
  return `qadr-ops-rapport-${report.startDate}-${report.endDate}.pdf`;
}
