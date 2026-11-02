"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Segmented } from "@/components/ui/controls";
import { BarChart, StatCard } from "@/components/ui/data-display";
import { Alert, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatDateTime, formatQuantity, formatXof } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translate";
import { track } from "@/lib/analytics/client";

type Period = "daily" | "weekly" | "monthly" | "yearly" | "custom";
type Compared = { currentXof: string; previousXof: string; changeXof: string; changePercent: string | null };
type Report = {
  timezone: string; period: Period; startDate: string; endDate: string; previousStartDate: string; previousEndDate: string; generatedAt: string;
  sales: { revenueXof: string; count: string; averageBasketXof: string | null; discountXof: string; itemsSold: string; changePercent: string | null; byCategory: { category: string | null; quantity: string; revenueXof: string }[] };
  settlement: { mixed: string };
  collections: { totalXof: string; atSaleXof: string; settlementsXof: string; byMethod: { method: string; amountXof: string }[];
    pending: { totalXof: string; count: string; byMethod: { method: string; amountXof: string; count: string }[] }; openingRecoveries: { totalXof: string; count: string } };
  credit: { grantedXof: string; settlementsXof: string; outstandingSalesXof: string; openingRecoveredXof: string; openingOutstandingXof: string; totalOutstandingXof: string };
  refunds: { totalXof: string; count: string };
  expenses: { totalXof: string; paidXof: string; count: string; byCategory: { category: string; amountXof: string; count: string }[]; byMethod: { method: string | null; amountXof: string }[] };
  purchases: { totalXof: string; count: string; paidXof: string };
  margin: { complete: boolean; amountXof: string | null; unknownCostLines: string; marginOnKnownXof: string };
  operatingEstimate: { available: boolean; amountXof: string | null };
  cashFlow: { inXof: string; outXof: string; netXof: string };
  supplierDebt: { purchasesDueXof: string; openingDueXof: string; totalXof: string } | null;
  comparison: Record<"revenue" | "saleCount" | "collections" | "expenses" | "creditGranted" | "settlements", Compared> & { margin: Compared | null };
  topProducts: { name: string; quantity: string; revenueXof: string }[];
  slowProducts: { name: string; variant: string; onHand: string; quantitySold: string }[];
  stock: { byReason: { reason: string; incomingQty: string; outgoingQty: string; count: string }[]; notable: { product: string; variant: string; reason: string; quantityDelta: string; occurredAt: string }[] } | null;
  employees: { userId: string; name: string; saleCount: string; revenueXof: string; collectedXof: string; expensesXof: string }[];
  inventoryVariance: { gainQty: string; lossQty: string };
  trend: { date: string; revenueXof: string; saleCount: string; collectionsXof: string; expensesXof: string }[];
};

const methodKeys = new Set(["cash", "wave", "orange_money", "mtn_momo", "other"]);
const reasonKeys = new Set(["sale", "purchase", "inventory_adjustment", "manual_adjustment", "return", "opening_stock"]);

/* Navigation d'une période à l'autre : calcul de dates civiles (affichage seulement, le serveur fixe les bornes). */
function shiftDate(date: string, period: Period, step: number) {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const value = period === "monthly" ? new Date(Date.UTC(year, month - 1 + step, 1)) : period === "yearly" ? new Date(Date.UTC(year + step, 0, 1))
    : new Date(Date.UTC(year, month - 1, day + step * (period === "weekly" ? 7 : 1)));
  return value.toISOString().slice(0, 10);
}
const longDate = (date: string, locale: Locale) => new Date(`${date}T00:00:00Z`).toLocaleDateString(intlLocale[locale], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function ReportsWorkspace() {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<Period>("daily");
  const [date, setDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<"load" | "forbidden" | null>(null);
  const [message, setMessage] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === "custom") { if (startDate) params.set("startDate", startDate); if (endDate) params.set("endDate", endDate); }
    else if (date) params.set("date", date);
    return params.toString();
  }, [period, date, startDate, endDate]);
  const ready = period !== "custom" || (startDate !== "" && endDate !== "");

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/business/reports?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json().catch(() => null) as { report?: Report; error?: string } | null;
      if (response.status === 403) { setFailure("forbidden"); return; }
      if (!response.ok || !body?.report) { setFailure("load"); setMessage(body?.error ?? ""); return; }
      setReport(body.report); setFailure(null); setMessage("");
    }).catch((error: unknown) => { if ((error as Error).name !== "AbortError") setFailure("load"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, ready]);

  if (failure === "forbidden") return <><PageHeader title={t("reports.title")}>{t("reports.intro")}</PageHeader><EmptyState icon="shield" title={t("reports.forbidden")} /></>;

  const anchor = date || report?.startDate || "";
  const go = (step: number) => { if (anchor) setDate(shiftDate(anchor, period, step)); };
  const money = (value: string | null | undefined) => formatXof(value, locale);

  return (
    <div>
      <PageHeader title={t("reports.title")} actions={report && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="ghost" onClick={() => window.print()} icon={<Icon name="print" />}>{t("reports.print")}</Button>
        </div>
      )}>{t("reports.intro")}</PageHeader>

      <Card className="mb-4 grid gap-3 print:hidden" aria-label={t("reports.periods.label")}>
        <Segmented label={t("reports.periods.label")} value={period} onChange={(value) => { setPeriod(value); setDate(""); }}
          options={(["daily", "weekly", "monthly", "yearly", "custom"] as const).map((value) => ({ value, label: t(`reports.periods.${value}`) }))} />
        {period === "custom" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("reports.fields.from")}>{(props) => <Input {...props} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />}</Field>
            <Field label={t("reports.fields.to")}>{(props) => <Input {...props} type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />}</Field>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => go(-1)} aria-label={t("reports.previousPeriod")} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg hover:text-ink"><Icon name="back" className="rtl:rotate-180" /></button>
            <Field className="min-w-0 flex-1" label={t(period === "monthly" ? "reports.fields.month" : period === "weekly" ? "reports.fields.week" : period === "yearly" ? "reports.fields.year" : "reports.fields.day")}>
              {(props) => period === "monthly"
                ? <Input {...props} type="month" value={anchor.slice(0, 7)} onChange={(event) => setDate(event.target.value ? `${event.target.value}-01` : "")} />
                : <Input {...props} type="date" value={anchor} onChange={(event) => setDate(event.target.value)} />}
            </Field>
            <button type="button" onClick={() => go(1)} aria-label={t("reports.nextPeriod")} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg hover:text-ink"><Icon name="forward" className="rtl:rotate-180" /></button>
          </div>
        )}
        {report && (
          <p className="m-0 text-sm text-fg-muted">
            <strong className="text-ink">{t("reports.range", { start: longDate(report.startDate, locale), end: longDate(report.endDate, locale) })}</strong>
            {" · "}{t("reports.comparedTo", { start: longDate(report.previousStartDate, locale), end: longDate(report.previousEndDate, locale) })}
            {" · "}{t("reports.timezone", { zone: report.timezone })}
          </p>
        )}
      </Card>

      {report && <ExportCard query={query} period={period} />}

      {failure === "load" && <Alert tone="danger" className="mb-4">{message || t("reports.loadFailed")}</Alert>}
      {!report ? (ready ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div> : null) : (
        <div className={cn("grid gap-4 transition-opacity [&>*]:min-w-0", loading && "opacity-60")} aria-busy={loading}>
          {loading && <p className="sr-only" role="status">{t("reports.loading")}</p>}
          <ReportBody report={report} money={money} />
          <p className="m-0 text-xs text-fg-subtle">{t("reports.definitions")} {t("reports.printHint")} · {t("reports.updated", { date: formatDateTime(report.generatedAt, locale) })}</p>
        </div>
      )}
    </div>
  );
}

type ExportFormat = "xlsx" | "pdf" | "csv";

/**
 * Téléchargements préparés par le serveur (docs/exports.md). Le fichier est demandé par fetch pour
 * afficher une erreur claire (période trop longue, rôle) au lieu d'enregistrer une page d'erreur.
 */
function ExportCard({ query, period }: { query: string; period: Period }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // Le PDF serveur n'existe qu'en français et en anglais : en arabe, il est demandé en français, et l'écran le dit.
  const pdfLang = locale === "ar" ? "fr" : locale;

  const download = async (format: ExportFormat) => {
    setBusy(format);
    setNotice(null);
    const params = new URLSearchParams(query);
    params.set("format", format);
    params.set("lang", format === "pdf" ? pdfLang : locale);
    try {
      const response = await fetch(`/api/business/reports/export?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string } | null;
        const key: MessageKey = response.status === 403 ? "exports.errors.forbidden"
          : body?.code === "export_too_large" ? "exports.errors.tooLarge"
            : body?.code === "pdf_language_unsupported" ? "exports.errors.language" : "exports.errors.failed";
        setNotice({ tone: "danger", text: t(key) });
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `qadr-ops.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      track("report_exported", { format, period });
      setNotice({ tone: "success", text: t("exports.ready") });
    } catch {
      setNotice({ tone: "danger", text: t("exports.errors.network") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-4 grid gap-3 print:hidden" aria-labelledby="report-exports-title">
      <div>
        <CardTitle id="report-exports-title" title={t("exports.title")} />
        <p className="-mt-2 mb-0 text-sm text-fg-muted">{t("exports.intro")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void download("xlsx")} loading={busy === "xlsx"} disabled={busy !== null} icon={<Icon name="download" />}>{t("exports.xlsx")}</Button>
        <Button variant="secondary" onClick={() => void download("pdf")} loading={busy === "pdf"} disabled={busy !== null} icon={<Icon name="download" />}>{t(locale === "ar" ? "exports.pdfFrench" : "exports.pdf")}</Button>
        <Button variant="ghost" onClick={() => void download("csv")} loading={busy === "csv"} disabled={busy !== null} icon={<Icon name="download" />}>{t("exports.csv")}</Button>
      </div>
      <p className="m-0 text-xs text-fg-subtle">{t("exports.xlsxHint")}</p>
      {locale === "ar" && <p className="m-0 text-xs text-fg-subtle">{t("exports.pdfArabicNote")}</p>}
      {busy && <p className="sr-only" role="status">{t("exports.preparing")}</p>}
      {notice && <Alert tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={t("common.close")}>{notice.text}</Alert>}
    </Card>
  );
}

function Change({ value, invert = false }: { value: string | null; invert?: boolean }) {
  const { t, locale } = useI18n();
  if (value === null) return <span className="text-fg-subtle">{t("reports.change.none")}</span>;
  const points = Number(value);
  if (points === 0) return <span className="text-fg-muted">{t("reports.change.same")}</span>;
  const text = new Intl.NumberFormat(intlLocale[locale], { maximumFractionDigits: 1 }).format(Math.abs(points) / 100);
  const good = invert ? points < 0 : points > 0;
  return <span dir="ltr" className={cn("font-semibold", good ? "text-ok" : "text-danger")}>{t(points > 0 ? "reports.change.up" : "reports.change.down", { value: text })}</span>;
}

function Rows({ items }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="m-0 grid gap-2">
      {items.map((item, index) => (
        <div key={index} className={cn("flex items-baseline justify-between gap-3", item.strong && "border-t border-line pt-2")}>
          <dt className="min-w-0 text-sm text-fg-muted">{item.label}{item.hint && <span className="block text-xs text-fg-subtle">{item.hint}</span>}</dt>
          <dd className={cn("numeric m-0 shrink-0 text-end", item.strong ? "font-bold text-ink" : "font-semibold text-fg")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportBody({ report, money }: { report: Report; money: (value: string | null | undefined) => string }) {
  const { t, locale } = useI18n();
  const quantity = (value: string) => formatQuantity(value, locale);
  const methodLabel = (method: string | null) => t(method && methodKeys.has(method) ? `reports.methods.${method as "cash"}` : "reports.methods.unknown");
  const chart = report.trend.map((row) => ({
    key: row.date,
    label: report.period === "yearly" ? new Date(`${row.date}T00:00:00Z`).toLocaleDateString(intlLocale[locale], { month: "narrow", timeZone: "UTC" })
      : report.period === "weekly" ? new Date(`${row.date}T00:00:00Z`).toLocaleDateString(intlLocale[locale], { weekday: "short", timeZone: "UTC" })
      : String(Number(row.date.slice(8))),
    value: Number(row.revenueXof), title: `${row.date} · ${money(row.revenueXof)}`,
  }));
  const comparisonRows = (["revenue", "saleCount", "collections", "expenses", "creditGranted", "settlements", "margin"] as const)
    .flatMap((key) => { const row = report.comparison[key]; return row ? [{ key, row }] : []; });
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("reports.title")}>
        <StatCard label={t("reports.kpi.revenue")} icon="trendUp" value={money(report.sales.revenueXof)}
          hint={<>{t("reports.kpi.revenueHint", { count: report.sales.count })} · <Change value={report.sales.changePercent} /></>} />
        <StatCard label={t("reports.kpi.collected")} icon="wallet" iconTone="ok" value={money(report.collections.totalXof)}
          hint={report.collections.pending.totalXof !== "0" ? t("reports.kpi.pendingHint", { amount: money(report.collections.pending.totalXof) }) : t("reports.kpi.collectedHint")} />
        <StatCard label={t("reports.kpi.expenses")} icon="receipt" iconTone="warn" value={money(report.expenses.totalXof)}
          hint={<>{t("reports.kpi.expensesHint", { count: report.expenses.count })} · <Change value={report.comparison.expenses.changePercent} invert /></>} />
        <StatCard label={t("reports.kpi.margin")} icon="chart" iconTone="info" value={report.margin.complete ? money(report.margin.amountXof) : t("reports.kpi.marginIncomplete")}
          hint={report.margin.complete ? t("reports.kpi.marginHint") : t("reports.kpi.marginIncompleteHint", { count: report.margin.unknownCostLines })} />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {report.period !== "daily" && (
          <Card aria-labelledby="report-trend">
            <CardTitle id="report-trend" eyebrow={t("reports.trend.title")} title={t(report.period === "yearly" ? "reports.trend.revenueYear" : "reports.trend.revenue")} />
            <div className="mt-4">{report.sales.count === "0" ? <p className="m-0 text-sm text-fg-muted">{t("reports.noSales")}</p> : <BarChart data={chart} label={t("reports.trend.revenue")} />}</div>
          </Card>
        )}
        <Card aria-labelledby="report-comparison">
          <CardTitle id="report-comparison" title={t("reports.comparison.title")} />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-sm">
              <thead><tr className="text-xs text-fg-subtle">
                <th scope="col" className="py-2 text-start font-semibold">{t("reports.comparison.metric")}</th><th scope="col" className="py-2 text-end font-semibold">{t("reports.comparison.current")}</th>
                <th scope="col" className="py-2 text-end font-semibold">{t("reports.comparison.previous")}</th><th scope="col" className="py-2 text-end font-semibold">{t("reports.comparison.change")}</th>
              </tr></thead>
              <tbody>{comparisonRows.map(({ key, row }) => {
                const format = key === "saleCount" ? (value: string) => value : money;
                return (
                  <tr key={key} className="border-t border-line">
                    <th scope="row" className="py-2.5 text-start font-semibold text-ink">{t(`reports.comparison.${key}`)}</th>
                    <td className="numeric py-2.5 text-end">{format(row.currentXof)}</td><td className="numeric py-2.5 text-end text-fg-muted">{format(row.previousXof)}</td>
                    <td className="py-2.5 text-end"><Change value={row.changePercent} invert={key === "expenses"} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card aria-labelledby="report-collections" className="grid gap-4">
          <CardTitle id="report-collections" title={t("reports.collections.title")} />
          {report.collections.byMethod.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("reports.collections.none")}</p>
            : <Rows items={[...report.collections.byMethod.map((row) => ({ label: methodLabel(row.method), value: money(row.amountXof) })),
              { label: t("reports.collections.atSale"), value: money(report.collections.atSaleXof), strong: true }, { label: t("reports.collections.settlements"), value: money(report.collections.settlementsXof) }]} />}
          {report.collections.pending.count !== "0" && (
            <div className="rounded-[14px] border border-warn/30 bg-warn-soft p-3">
              <p className="m-0 text-sm font-semibold text-warn">{t("reports.collections.pending")} · {money(report.collections.pending.totalXof)}</p>
              <p className="m-0 mt-1 text-xs text-fg-muted">{t("reports.collections.pendingHint")}</p>
              <ul className="m-0 mt-2 list-none p-0 text-sm">{report.collections.pending.byMethod.map((row) => <li key={row.method} className="flex justify-between gap-2"><span>{methodLabel(row.method)}</span><span className="numeric">{money(row.amountXof)}</span></li>)}</ul>
            </div>
          )}
          <Rows items={[{ label: t("reports.collections.mixed"), value: report.settlement.mixed },
            { label: t("reports.collections.opening"), value: money(report.collections.openingRecoveries.totalXof), hint: t("reports.collections.openingHint") }]} />
        </Card>

        <Card aria-labelledby="report-credit" className="grid gap-4">
          <CardTitle id="report-credit" title={t("reports.credit.title")} />
          <Rows items={[{ label: t("reports.credit.granted"), value: money(report.credit.grantedXof) }, { label: t("reports.credit.settlements"), value: money(report.credit.settlementsXof) },
            { label: t("reports.credit.openingRecovered"), value: money(report.credit.openingRecoveredXof) }]} />
          <div className="rounded-[14px] bg-surface-muted p-3">
            <p className="m-0 mb-2 text-xs font-semibold text-fg-subtle">{t("reports.credit.asOf")}</p>
            <Rows items={[{ label: t("reports.credit.outstandingSales"), value: money(report.credit.outstandingSalesXof) }, { label: t("reports.credit.openingOutstanding"), value: money(report.credit.openingOutstandingXof) },
              { label: t("reports.credit.total"), value: money(report.credit.totalOutstandingXof), strong: true }]} />
          </div>
        </Card>

        <Card aria-labelledby="report-expenses" className="grid gap-4">
          <CardTitle id="report-expenses" title={t("reports.expenses.title")} />
          <Rows items={[{ label: t("reports.expenses.recorded"), value: money(report.expenses.totalXof) }, { label: t("reports.expenses.paid"), value: money(report.expenses.paidXof), hint: t("reports.expenses.paidHint") }]} />
          {report.expenses.byCategory.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("reports.expenses.none")}</p> : <>
            <div><p className="m-0 mb-2 text-xs font-semibold text-fg-subtle">{t("reports.expenses.byCategory")}</p><Rows items={report.expenses.byCategory.map((row) => ({ label: <span dir="auto">{row.category}</span>, value: money(row.amountXof) }))} /></div>
            <div><p className="m-0 mb-2 text-xs font-semibold text-fg-subtle">{t("reports.expenses.byMethod")}</p><Rows items={report.expenses.byMethod.map((row) => ({ label: methodLabel(row.method), value: money(row.amountXof) }))} /></div>
          </>}
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card aria-labelledby="report-sales" className="grid gap-4">
          <CardTitle id="report-sales" title={t("reports.sales.title")} />
          <Rows items={[{ label: t("reports.sales.count"), value: report.sales.count }, { label: t("reports.sales.items"), value: quantity(report.sales.itemsSold), hint: t("reports.sales.itemsHint") },
            { label: t("reports.sales.basket"), value: money(report.sales.averageBasketXof) }, { label: t("reports.sales.discounts"), value: money(report.sales.discountXof) }]} />
          {report.sales.byCategory.length > 0 && <div><p className="m-0 mb-2 text-xs font-semibold text-fg-subtle">{t("reports.sales.byCategory")}</p>
            <Rows items={report.sales.byCategory.map((row) => ({ label: <span dir="auto">{row.category ?? t("reports.sales.noCategory")}</span>, value: money(row.revenueXof), hint: t("reports.sales.sold", { quantity: quantity(row.quantity) }) }))} /></div>}
        </Card>
        <Card aria-labelledby="report-products" className="grid gap-4">
          <CardTitle id="report-products" title={t("reports.sales.top")} />
          {report.topProducts.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("reports.noSales")}</p> : (
            <ol className="m-0 grid list-none gap-2 p-0">{report.topProducts.map((row, index) => (
              <li key={`${row.name}-${index}`} className="flex items-center gap-3">
                <span className="numeric grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">{index + 1}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink" dir="auto">{row.name}</span><span className="block text-xs text-fg-subtle">{t("reports.sales.sold", { quantity: quantity(row.quantity) })}</span></span>
                <span className="numeric shrink-0 font-semibold">{money(row.revenueXof)}</span>
              </li>
            ))}</ol>
          )}
          {report.slowProducts.length > 0 && <div><p className="m-0 text-xs font-semibold text-fg-subtle">{t("reports.sales.slow")}</p><p className="m-0 mb-2 text-xs text-fg-subtle">{t("reports.sales.slowHint")}</p>
            <Rows items={report.slowProducts.map((row) => ({ label: <span dir="auto">{row.name}{row.variant !== "Standard" ? ` · ${row.variant}` : ""}</span>, value: t("reports.sales.sold", { quantity: quantity(row.quantitySold) }), hint: t("reports.sales.inStock", { quantity: quantity(row.onHand) }) }))} /></div>}
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card tone="night" aria-labelledby="report-result" className="grid gap-4">
          <CardTitle inverse id="report-result" title={t("reports.result.title")} />
          <dl className="m-0 grid gap-2 text-sm">
            {[
              [t("reports.result.marginKnown"), money(report.margin.marginOnKnownXof)],
              [t("reports.result.unknownLines"), report.margin.unknownCostLines],
              [t("reports.result.operating"), report.operatingEstimate.available ? money(report.operatingEstimate.amountXof) : t("reports.result.operatingUnavailable")],
              [t("reports.result.cashIn"), money(report.cashFlow.inXof)], [t("reports.result.cashOut"), money(report.cashFlow.outXof)], [t("reports.result.cashNet"), money(report.cashFlow.netXof)],
              [t("reports.result.refunds"), money(report.refunds.totalXof)],
            ].map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3"><dt className="text-night-fg">{label}</dt><dd className="numeric m-0 text-end font-semibold text-white">{value}</dd></div>)}
          </dl>
          <p className="m-0 text-xs text-night-fg">{t("reports.result.operatingHint")} {t("reports.result.cashHint")}</p>
        </Card>
        <Card aria-labelledby="report-suppliers" className="grid gap-4">
          <CardTitle id="report-suppliers" title={t("reports.result.purchases")} />
          <Rows items={[{ label: t("reports.result.purchases"), value: money(report.purchases.totalXof), hint: t("reports.result.purchasesHint") }, { label: t("reports.result.supplierPaid"), value: money(report.purchases.paidXof) },
            ...(report.supplierDebt ? [{ label: t("reports.result.supplierDebt"), value: money(report.supplierDebt.totalXof), hint: t("reports.result.supplierDebtHint"), strong: true }] : [])]} />
        </Card>
      </div>

      {report.stock && (
        <Card aria-labelledby="report-stock" className="grid gap-4">
          <CardTitle id="report-stock" title={t("reports.stock.title")} />
          {report.stock.byReason.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("reports.stock.none")}</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[320px] border-collapse text-sm">
              <thead><tr className="text-xs text-fg-subtle"><th scope="col" className="py-2 text-start font-semibold">{t("reports.stock.reason")}</th><th scope="col" className="py-2 text-end font-semibold">{t("reports.stock.in")}</th><th scope="col" className="py-2 text-end font-semibold">{t("reports.stock.out")}</th></tr></thead>
              <tbody>{report.stock.byReason.map((row) => <tr key={row.reason} className="border-t border-line"><th scope="row" className="py-2 text-start font-semibold text-ink">{reasonKeys.has(row.reason) ? t(`reports.stock.reasons.${row.reason}` as MessageKey) : row.reason}</th>
                <td className="numeric py-2 text-end text-ok">+{quantity(row.incomingQty)}</td><td className="numeric py-2 text-end text-danger">−{quantity(row.outgoingQty)}</td></tr>)}</tbody>
            </table></div>
          )}
          {report.stock.notable.length > 0 && <div><p className="m-0 mb-2 text-xs font-semibold text-fg-subtle">{t("reports.stock.notable")}</p>
            <Rows items={report.stock.notable.map((row) => ({ label: <span dir="auto">{row.product}{row.variant !== "Standard" ? ` · ${row.variant}` : ""}</span>, hint: `${reasonKeys.has(row.reason) ? t(`reports.stock.reasons.${row.reason}` as MessageKey) : row.reason} · ${formatDateTime(row.occurredAt, locale)}`, value: quantity(row.quantityDelta) }))} /></div>}
          <p className="m-0 text-xs text-fg-subtle">{t("reports.stock.variance", { loss: quantity(report.inventoryVariance.lossQty), gain: quantity(report.inventoryVariance.gainQty) })}</p>
        </Card>
      )}

      <Card aria-labelledby="report-team">
        <CardTitle id="report-team" title={t("reports.employees.title")} />
        {report.employees.length === 0 ? <p className="m-0 mt-3 text-sm text-fg-muted">{t("reports.employees.none")}</p> : (
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] border-collapse text-sm">
            <thead><tr className="text-xs text-fg-subtle">{(["name", "sales", "revenue", "collected", "expenses"] as const).map((key) => <th key={key} scope="col" className={cn("py-2 font-semibold", key === "name" ? "text-start" : "text-end")}>{t(`reports.employees.${key}`)}</th>)}</tr></thead>
            <tbody>{report.employees.map((row) => <tr key={row.userId} className="border-t border-line"><th scope="row" className="py-2.5 text-start font-semibold text-ink" dir="auto">{row.name}</th>
              <td className="numeric py-2.5 text-end">{row.saleCount}</td><td className="numeric py-2.5 text-end">{money(row.revenueXof)}</td><td className="numeric py-2.5 text-end">{money(row.collectedXof)}</td><td className="numeric py-2.5 text-end">{money(row.expensesXof)}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
