"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import { PfPageHeader } from "./platform-shell";
import {
  PfAvatar, PfBadge, PfButton, PfCard, PfCardHeader, PfEmpty, PfLineChart, PfNotice, PfProgress, PfSearch, PfSegmented, PfSkeleton, PfStackBar, PfStat,
  pfErrorMessage, pfEventLabel, pfFocus, pfRequest,
} from "./pf-ui";

type Operation = { id: string; eventType: string; occurredAt: string; actor: { name: string | null } | null; businessName: string | null; reason: string | null };
type Overview = {
  periodDays: number; generatedAt: string;
  businesses: { total: number; active: number; trial: number; suspended: number; expired: number; pending: number };
  subscriptions: { pending: number; expiringSoon: number; inForce: number };
  signups: { step: number; inPeriod: number; series: { start: string; count: number }[] };
  planDistribution: { planId: string; name: string; count: number }[];
  planSummary: { id: string; name: string; code: string; priceXof: string; durationDays: number; active: boolean; subscribers: number }[];
  watchlist: { subscriptionId: string; businessName: string; planName: string; status: string; endsAt: string; daysLeft: number }[];
  alerts: { kind: "expiring" | "suspended" | "pendingSubscriptions" | "pendingPayments"; count: number }[];
  revenue: { billedXof: string; collectedXof: string; pendingXof: string; refundedXof: string; confirmedPayments: number; promotionalDiscountXof: string; offeredDays: number; redemptions: number };
  recentSignups: { businessId: string; name: string; activity: string; createdAt: string; ownerName: string | null }[];
  recentOperations: Operation[];
};
type Period = "7" | "30" | "90";

export function PlatformOverview() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("30");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setData(await pfRequest<Overview>(`/api/platform/overview?period=${period}`)); }
    catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [period, t, locale]);
  useEffect(() => { void load(); }, [load]);

  const date = (value: string, style: "short" | "medium" = "medium") => new Date(value).toLocaleDateString(intlLocale[locale], style === "short" ? { day: "numeric", month: "short" } : { dateStyle: "medium" });
  const money = (value: string) => formatXof(value, locale);

  return (
    <>
      <PfPageHeader title={t("platform.overview.title")} description={t("platform.overview.description")}>
        <form role="search" onSubmit={(event) => { event.preventDefault(); router.push(`/platform/businesses${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`); }}>
          <PfSearch value={search} onChange={setSearch} placeholder={t("platform.businesses.searchPlaceholder")} label={t("platform.common.search")} />
        </form>
        <PfSegmented label={t("platform.periods.label")} value={period} onChange={setPeriod}
          options={[{ value: "7", label: t("platform.periods.d7") }, { value: "30", label: t("platform.periods.d30") }, { value: "90", label: t("platform.periods.d90") }]} />
      </PfPageHeader>

      {error && <div className="mb-4"><PfNotice tone="alert">{error} <button type="button" onClick={() => void load()} className={cn("ms-2 cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-current underline", pfFocus)}>{t("platform.common.retry")}</button></PfNotice></div>}

      {!data ? (
        <div className="grid gap-4" aria-busy="true" aria-label={t("platform.common.loading")}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <PfSkeleton key={index} className="h-32" />)}</div>
          <div className="grid gap-4 lg:grid-cols-12"><PfSkeleton className="h-72 lg:col-span-7" /><PfSkeleton className="h-72 lg:col-span-5" /></div>
        </div>
      ) : (
        <div className="grid gap-4">
          <section aria-label={t("platform.overview.states")} className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <PfStat emphasis label={t("platform.overview.stats.total")} value={data.businesses.total} icon="store" hint={t("platform.overview.signupsCaption", { count: data.signups.inPeriod })} />
            <PfStat label={t("platform.overview.stats.active")} value={data.businesses.active} icon="check" />
            <PfStat label={t("platform.overview.stats.trial")} value={data.businesses.trial} icon="calendar" />
            <PfStat label={t("platform.overview.stats.suspended")} value={data.businesses.suspended} icon="pause" />
            <PfStat label={t("platform.overview.stats.expired")} value={data.businesses.expired} icon="ban" />
            <PfStat label={t("platform.overview.stats.pending")} value={data.businesses.pending} icon="info" />
            <PfStat label={t("platform.overview.stats.pendingSubscriptions")} value={data.subscriptions.pending} icon="receipt" />
            <PfStat label={t("platform.overview.stats.expiring")} value={data.subscriptions.expiringSoon} icon="warning" />
          </section>

          <div className="grid gap-4 lg:grid-cols-12">
            <PfCard className="lg:col-span-6 xl:col-span-6">
              <PfCardHeader title={t("platform.overview.signups")} caption={`${t("platform.overview.signupsCaption", { count: data.signups.inPeriod })} · ${data.signups.step === 7 ? t("platform.overview.perWeek") : t("platform.overview.perDay")}`} />
              <PfLineChart label={t("platform.overview.signups")} points={data.signups.series.map((bucket) => ({ key: bucket.start, value: bucket.count }))} formatLabel={(key) => date(key, "short")} />
            </PfCard>
            <PfCard className="lg:col-span-3">
              <PfCardHeader title={t("platform.overview.plans")} caption={t("platform.overview.plansCaption")} />
              {data.planDistribution.length
                ? <PfStackBar label={t("platform.overview.plans")} items={data.planDistribution.map((plan) => ({ key: plan.planId, label: plan.name, value: plan.count }))} />
                : <PfEmpty title={t("platform.plans.empty")} />}
            </PfCard>
            <PfCard className="lg:col-span-3">
              <PfCardHeader title={t("platform.overview.states")} caption={t("platform.overview.stats.total") + ` · ${data.businesses.total}`} />
              <PfStackBar label={t("platform.overview.states")} items={(["active", "trial", "pending", "expired", "suspended"] as const).map((key) => ({ key, label: t(`platform.lifecycle.${key}`), value: data.businesses[key] }))} />
            </PfCard>
          </div>

          <PfCard tone="dark" className="grid gap-6 md:grid-cols-3 md:gap-0 md:divide-x md:divide-pf-panel-line rtl:md:divide-x-reverse">
            <div className="md:pe-6">
              <PfCardHeader dark title={t("platform.overview.activity")} />
              {data.recentOperations.length ? (
                <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-3 p-0">
                  {data.recentOperations.slice(0, 5).map((event) => (
                    <li key={event.id} className="flex items-start gap-3">
                      <PfAvatar dark size="sm" name={event.actor?.name ?? "S"} />
                      <span className="min-w-0 text-[0.82rem]">
                        <strong className="block truncate font-semibold text-white">{pfEventLabel(t, event.eventType)}</strong>
                        <span className="block truncate text-pf-panel-fg">{[event.businessName, date(event.occurredAt, "short")].filter(Boolean).join(" · ")}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <PfEmpty dark title={t("platform.overview.empty")} />}
            </div>
            <div className="md:px-6">
              <PfCardHeader dark title={t("platform.overview.alerts")} />
              {data.alerts.length ? (
                <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2.5 p-0">
                  {data.alerts.map((alert) => (
                    <li key={alert.kind} className="flex items-start gap-3 rounded-[18px] bg-pf-panel-soft p-3 text-[0.82rem] text-white">
                      <Icon name="warning" className="mt-0.5 size-4 text-pf-panel-fg" />
                      <span>{t(`platform.overview.alert.${alert.kind}`, { count: alert.count })}</span>
                    </li>
                  ))}
                </ul>
              ) : <PfEmpty dark icon="check" title={t("platform.overview.noAlerts")} />}
            </div>
            <div className="md:ps-6">
              <PfCardHeader dark title={t("platform.overview.watch")} action={<Link href="/platform/subscriptions" aria-label={t("platform.nav.subscriptions")} className={cn("grid size-9 place-items-center rounded-full bg-white text-pf-ink", pfFocus)}><Icon name="arrowUpRight" className="size-4" /></Link>} />
              {data.watchlist.length ? (
                <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-3.5 p-0">
                  {data.watchlist.map((item) => (
                    <li key={item.subscriptionId} className="grid gap-1.5">
                      <span className="flex items-center justify-between gap-2 text-[0.82rem]">
                        <strong className="truncate font-semibold text-white">{item.businessName}</strong>
                        <span className="numeric shrink-0 text-pf-panel-fg">{t("platform.common.daysLeft", { count: item.daysLeft })}</span>
                      </span>
                      <PfProgress dark value={(item.daysLeft / 7) * 100} label={`${item.businessName} · ${item.planName}`} />
                      <span className="text-[0.74rem] text-pf-panel-fg">{item.planName} · {t(`platform.status.${item.status as "active"}`)}</span>
                    </li>
                  ))}
                </ul>
              ) : <PfEmpty dark icon="calendar" title={t("platform.overview.watchEmpty")} />}
            </div>
          </PfCard>

          <PfCard>
            <PfCardHeader title={t("platform.overview.revenue")} caption={t("platform.overview.revenueNote")} />
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-5">
              {([
                ["collected", data.revenue.collectedXof],
                ["billed", data.revenue.billedXof],
                ["pendingAmount", data.revenue.pendingXof],
                ["refunded", data.revenue.refundedXof],
                ["promoBenefits", data.revenue.promotionalDiscountXof],
              ] as const).map(([key, value]) => (
                <div key={key} className={cn("min-w-0", key === "collected" && "col-span-2 md:col-span-1")}>
                  <dt className="text-[0.78rem] text-pf-muted">{t(`platform.overview.${key}`)}</dt>
                  <dd className={cn("numeric m-0 mt-1 truncate font-semibold tracking-[-0.03em] text-pf-ink", key === "collected" ? "text-[1.9rem]" : "text-[1.25rem]")}>{money(value)}</dd>
                  {key === "promoBenefits" && <dd className="m-0 mt-0.5 text-[0.74rem] text-pf-subtle">{t("platform.overview.offeredDays", { count: data.revenue.offeredDays })}</dd>}
                </div>
              ))}
            </dl>
            {data.revenue.confirmedPayments === 0 && <p className="m-0 mt-5 rounded-[18px] bg-pf-chip px-4 py-3 text-[0.82rem] text-pf-fg">{t("platform.overview.noConfirmed")}</p>}
          </PfCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <PfCard>
              <PfCardHeader title={t("platform.overview.latestSignups")} action={<PfButton size="sm" variant="light" onClick={() => router.push("/platform/businesses")}>{t("platform.nav.businesses")}</PfButton>} />
              <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                {data.recentSignups.map((business) => (
                  <li key={business.businessId} className="flex items-center gap-3 rounded-[18px] border border-pf-line px-3 py-2.5">
                    <PfAvatar size="sm" name={business.name} />
                    <span className="min-w-0 flex-1">
                      <strong dir="auto" className="block truncate text-[0.85rem] text-pf-ink">{business.name}</strong>
                      <span className="block truncate text-[0.74rem] text-pf-muted">{t(`platform.activity.${business.activity as "general"}`)} · {business.ownerName ?? "—"}</span>
                    </span>
                    <span className="shrink-0 text-[0.74rem] text-pf-subtle">{date(business.createdAt, "short")}</span>
                  </li>
                ))}
              </ul>
            </PfCard>
            <PfCard>
              <PfCardHeader title={t("platform.overview.latestOperations")} action={<PfButton size="sm" variant="light" onClick={() => router.push("/platform/audit")}>{t("platform.nav.audit")}</PfButton>} />
              {data.recentOperations.length ? (
                <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                  {data.recentOperations.map((event) => (
                    <li key={event.id} className="grid gap-0.5 rounded-[18px] border border-pf-line px-3 py-2.5">
                      <span className="flex items-center justify-between gap-2"><strong className="truncate text-[0.84rem] text-pf-ink">{pfEventLabel(t, event.eventType)}</strong><span className="shrink-0 text-[0.72rem] text-pf-subtle">{date(event.occurredAt, "short")}</span></span>
                      <span className="truncate text-[0.74rem] text-pf-muted">{[event.actor?.name ?? t("platform.audit.system"), event.businessName, event.reason].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              ) : <PfEmpty title={t("platform.overview.empty")} />}
            </PfCard>
            <PfCard>
              <PfCardHeader title={t("platform.overview.planSummary")} action={<PfButton size="sm" variant="light" onClick={() => router.push("/platform/plans")}>{t("platform.nav.plans")}</PfButton>} />
              <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                {data.planSummary.map((plan) => (
                  <li key={plan.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-pf-line px-3 py-2.5">
                    <span className="min-w-0">
                      <strong className="block truncate text-[0.85rem] text-pf-ink">{plan.name}</strong>
                      <span className="numeric block text-[0.74rem] text-pf-muted">{money(plan.priceXof)} {t("platform.plans.perPeriod", { days: plan.durationDays })}</span>
                    </span>
                    {plan.active ? <PfBadge tone="solid">{t("platform.overview.subscribers", { count: plan.subscribers })}</PfBadge> : <PfBadge tone="outline">{t("platform.overview.inactive")}</PfBadge>}
                  </li>
                ))}
              </ul>
            </PfCard>
          </div>
          <p className="m-0 text-end text-[0.74rem] text-pf-subtle">{t("platform.common.updatedAt", { date: new Date(data.generatedAt).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" }) })}</p>
        </div>
      )}
    </>
  );
}
