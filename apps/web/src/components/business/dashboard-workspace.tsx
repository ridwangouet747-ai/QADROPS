"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { BarChart, Monogram, StatCard } from "@/components/ui/data-display";
import { Alert, Badge, EmptyState, ProgressBar, Skeleton } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { intlLocale } from "@/lib/i18n/config";
import { formatDateTime, formatQuantity, formatXof } from "@/lib/i18n/format";

type Amount = string | null | undefined;
type Overview = {
  today?: {
    sales?: { revenueXof?: Amount; count?: number | string; averageBasketXof?: Amount };
    collections?: { totalXof?: Amount };
    receivablesAsOf?: { totalXof?: Amount; count?: number | string };
    expenses?: { totalXof?: Amount };
    grossMarginEstimate?: { available?: boolean; amountXof?: Amount };
  };
  week?: { startDate?: string; endDate?: string; trend?: { date: string; revenueXof: string }[] };
  recentSales?: { id: string; reference: string; customerName: string | null; occurredAt: string; totalXof: string; paidXof: string }[];
  lowStock?: { variantId: string; name: string; variant: string | null; sku: string | null; onHand: string; threshold: string }[];
  error?: string;
};

const toBig = (value: Amount) => { try { return BigInt(value ?? "0"); } catch { return 0n; } };

/** Tous les jours de la semaine du rapport, y compris ceux sans vente (barre à zéro). */
function weekDays(week: Overview["week"]) {
  if (!week?.startDate || !week.endDate) return (week?.trend ?? []).map((entry) => entry.date);
  const days: string[] = [];
  for (let day = new Date(`${week.startDate}T00:00:00Z`); day <= new Date(`${week.endDate}T00:00:00Z`) && days.length < 7; day.setUTCDate(day.getUTCDate() + 1)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

export function DashboardWorkspace() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [selectedSale, setSelectedSale] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/business/dashboard", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as Overview;
        if (!response.ok) throw new Error(body.error ?? t("dashboard.loadFailed"));
        if (alive) { setData(body); setSelectedSale(body.recentSales?.[0]?.id ?? ""); }
      })
      .catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : t("dashboard.loadFailed")); });
    return () => { alive = false; };
  }, [t]);

  const money = (value: Amount | bigint) => formatXof(value ?? null, locale);
  const today = data?.today;
  const sales = data?.recentSales ?? [];
  const selected = sales.find((sale) => sale.id === selectedSale) ?? sales[0];
  const trend = weekDays(data?.week).map((date) => {
    const revenue = data?.week?.trend?.find((entry) => entry.date === date)?.revenueXof ?? "0";
    const day = new Date(`${date}T12:00:00Z`);
    // La hauteur des barres est un simple rapport visuel ; les montants exacts restent en chaîne.
    return { key: date, value: Number(revenue), title: `${date} : ${money(revenue)}`,
      label: day.toLocaleDateString(intlLocale[locale], { weekday: "short", timeZone: "UTC" }) };
  });
  const revenueToday = toBig(today?.sales?.revenueXof);
  const collectedShare = revenueToday > 0n ? Number((toBig(today?.collections?.totalXof) * 100n) / revenueToday) : null;
  const margin = today?.grossMarginEstimate;

  return (
    <div>
      <PageHeader title={t("dashboard.title")} actions={
        <Link href="/business/pos" className={buttonClasses({ variant: "primary", className: "no-underline" })}><Icon name="plus" />{t("dashboard.openPos")}</Link>
      }>{t("dashboard.intro")}</PageHeader>

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {!data && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-44 rounded-xl" />)}</div>
      ) : data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("dashboard.title")}>
            <StatCard label={t("dashboard.revenue")} icon="trendUp" value={money(today?.sales?.revenueXof)}
              hint={t("dashboard.revenueHint", { count: String(today?.sales?.count ?? 0), basket: money(today?.sales?.averageBasketXof) })}>
              {trend.length > 0 && <BarChart data={trend} label={t("dashboard.weekTitle")} />}
            </StatCard>
            <StatCard label={t("dashboard.collected")} icon="wallet" iconTone="ok" value={money(today?.collections?.totalXof)} hint={t("dashboard.collectedHint")}>
              {collectedShare !== null && (
                <div className="grid gap-2 rounded-[14px] bg-paper p-3">
                  <ProgressBar value={Math.min(100, collectedShare)} max={100} label={t("dashboard.collectedShare", { percent: collectedShare })} />
                  <p className="m-0 text-xs font-semibold text-fg-muted">{t("dashboard.collectedShare", { percent: collectedShare })}</p>
                </div>
              )}
            </StatCard>
            <StatCard label={t("dashboard.receivables")} icon="warning" iconTone="danger" value={money(today?.receivablesAsOf?.totalXof)}
              hint={t("dashboard.receivablesHint", { count: String(today?.receivablesAsOf?.count ?? 0) })}>
              <Link href="/business/customers" className={buttonClasses({ variant: "secondary", block: true, className: "no-underline" })}><Icon name="users" className="size-4" />{t("dashboard.seeCustomers")}</Link>
            </StatCard>
            <Card tone="brand" className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="m-0 text-[0.86rem] font-semibold text-white/90">{t("dashboard.margin")}</h3>
                <span className="grid size-8 place-items-center rounded-full bg-white/20"><Icon name="chart" className="size-4" /></span>
              </div>
              <p className="numeric m-0 mt-2 text-start text-[1.6rem] font-bold tracking-[-0.03em] sm:text-[1.85rem] rtl:text-end">{margin?.available ? money(margin.amountXof) : t("dashboard.unavailable")}</p>
              <p className="m-0 mt-1 text-[0.8rem] text-white/80">{t("dashboard.marginHint")}</p>
              <div className="mt-auto flex items-center justify-between gap-2 rounded-[14px] bg-white/15 px-3 py-2.5 backdrop-blur-sm">
                <span className="text-[0.8rem] text-white/85">{t("dashboard.expenses")}</span>
                <strong className="numeric text-[0.95rem]">{money(today?.expenses?.totalXof)}</strong>
              </div>
            </Card>
          </section>

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Panneau bleu nuit : liste à gauche, détail en dégradé violet à droite (cf. référence). */}
            <Card tone="night" className="p-3 sm:p-4" aria-labelledby="recent-sales-title">
              <div className="mb-3 flex items-center justify-between gap-3 px-1 pt-1">
                <h2 id="recent-sales-title" className="m-0 text-[1.05rem] font-bold">{t("dashboard.recentTitle")}</h2>
                <Link href="/business/sales" className="rounded-full border border-night-line px-3.5 py-2 text-sm font-semibold text-white no-underline hover:bg-night-soft">{t("dashboard.seeAll")}</Link>
              </div>
              {sales.length === 0 ? (
                <p className="m-0 rounded-lg bg-night-soft p-5 text-center text-sm text-night-fg">{t("dashboard.noRecent")}</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <ul className="m-0 grid list-none content-start gap-1.5 p-0">
                    {sales.map((sale) => {
                      const due = toBig(sale.totalXof) - toBig(sale.paidXof);
                      const isSelected = sale.id === selected?.id;
                      return (
                        <li key={sale.id}>
                          <button type="button" onClick={() => setSelectedSale(sale.id)} aria-pressed={isSelected}
                            className={cn("flex w-full cursor-pointer items-center gap-3 rounded-[16px] border-0 p-2.5 text-start transition-colors",
                              isSelected ? "bg-brand-gradient text-white shadow-brand" : "bg-night-soft/60 text-white hover:bg-night-soft")}>
                            <Monogram text={sale.customerName ?? sale.reference.replace(/^\W+/, "")} className={cn("size-9", isSelected ? "bg-white/20 text-white" : "bg-night-line text-white")} />
                            <span className="grid min-w-0 flex-1">
                              <strong className="numeric truncate text-start text-sm rtl:text-end"># {sale.reference}</strong>
                              <small className={cn("truncate text-xs", isSelected ? "text-white/80" : "text-night-fg")}>{sale.customerName ?? t("dashboard.walkIn")}</small>
                            </span>
                            <span className="grid justify-items-end gap-1">
                              <strong className="numeric text-sm">{money(sale.totalXof)}</strong>
                              <small className={cn("rounded-full px-2 py-0.5 text-[0.68rem] font-semibold", due > 0n ? (isSelected ? "bg-white text-brand-strong" : "bg-danger-soft text-danger") : (isSelected ? "bg-white/20" : "bg-night-line text-night-fg"))}>
                                {due > 0n ? t("dashboard.remaining", { amount: money(due) }) : t("dashboard.paidInFull")}
                              </small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {selected && (() => {
                    const due = toBig(selected.totalXof) - toBig(selected.paidXof);
                    return (
                      <article className="flex flex-col gap-4 rounded-[20px] bg-brand-glow p-4 text-white shadow-raised sm:p-5" aria-live="polite">
                        <div className="grid gap-3">
                          <div className="min-w-0">
                            <p className="m-0 text-xs text-white/75">{t("dashboard.detailTitle")}</p>
                            <p className="numeric m-0 mt-1 text-start text-[1.5rem] font-bold tracking-[-0.02em] rtl:text-end"># {selected.reference}</p>
                            <p className="m-0 text-xs text-white/75">{formatDateTime(selected.occurredAt, locale)}</p>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <Monogram text={selected.customerName ?? "?"} className="size-9 bg-white/20 text-white" />
                            <div className="min-w-0">
                              <p className="m-0 text-xs text-white/75">{t("dashboard.customer")}</p>
                              <p className="m-0 truncate font-semibold">{selected.customerName ?? t("dashboard.walkIn")}</p>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[["dashboard.total", selected.totalXof], ["dashboard.paid", selected.paidXof], ["dashboard.due", due]].map(([key, value]) => (
                            <div key={String(key)} className="flex min-w-0 items-center justify-between gap-2 rounded-[14px] border border-white/20 bg-white/12 px-3 py-2 sm:block sm:p-3">
                              <p className="m-0 text-[0.7rem] text-white/75">{t(key as "dashboard.total")}</p>
                              <p className="numeric m-0 text-start text-[0.92rem] font-bold sm:mt-1 sm:truncate rtl:text-end">{money(value as Amount | bigint)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-auto flex flex-wrap gap-2">
                          <Link href={`/business/sales/${selected.id}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-brand-strong no-underline hover:bg-brand-soft">{t("dashboard.openSale")}</Link>
                          <Link href={`/business/sales/${selected.id}/receipt`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/35 px-4 text-sm font-semibold text-white no-underline hover:bg-white/10"><Icon name="receipt" className="size-4" />{t("dashboard.receipt")}</Link>
                        </div>
                      </article>
                    );
                  })()}
                </div>
              )}
            </Card>

            <Card aria-labelledby="low-stock-title">
              <CardTitle id="low-stock-title" title={t("dashboard.lowStockTitle")}
                aside={<Link href="/business/stock" className="shrink-0 text-sm font-semibold text-brand-strong no-underline">{t("dashboard.seeStock")}</Link>} />
              <p className="m-0 -mt-2 mb-3 text-xs text-fg-subtle">{t("dashboard.lowStockHint")}</p>
              {(data.lowStock ?? []).length === 0 ? (
                <EmptyState icon="success" title={t("dashboard.noLowStock")} />
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {(data.lowStock ?? []).map((item) => (
                    <li key={item.variantId} className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-2.5">
                      <Monogram text={item.name} className="bg-danger-soft text-danger" />
                      <span className="grid min-w-0 flex-1">
                        <strong className="truncate text-sm text-ink">{item.name}</strong>
                        <small className="truncate text-xs text-fg-subtle">{item.sku ?? item.variant ?? ""}</small>
                      </span>
                      <span className="grid justify-items-end">
                        <Badge tone="danger"><span className="numeric">{formatQuantity(item.onHand, locale)}</span></Badge>
                        <small className="mt-0.5 text-[0.7rem] text-fg-subtle">{t("dashboard.threshold", { qty: formatQuantity(item.threshold, locale) })}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
