"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useDebounced } from "@/components/business/use-paged-list";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { PfPageHeader } from "./platform-shell";
import { PfAvatar, PfBadge, PfButton, PfCard, PfEmpty, PfInput, PfNotice, PfSearch, PfSelect, PfSkeleton, pfDescribeChange, pfErrorMessage, pfEventLabel, pfRequest } from "./pf-ui";

type Item = {
  id: string; eventType: string; occurredAt: string; actor: { name: string | null; email: string | null } | null;
  businessName: string | null; before: unknown; after: unknown; reason: string | null; result: string;
};
const groups = [
  { value: "platform.business", key: "business" }, { value: "platform.plan", key: "plan" }, { value: "platform.promotion", key: "promotion" },
  { value: "subscription", key: "subscription" }, { value: "platform.admin", key: "admin" },
] as const;

export function PlatformAudit() {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const debounced = useDebounced(search);

  const query = useCallback((before?: string) => {
    const params = new URLSearchParams({ limit: "40" });
    if (debounced.trim()) params.set("q", debounced.trim());
    if (action) params.set("action", action);
    if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
    if (before) params.set("before", before);
    return `/api/platform/audit?${params}`;
  }, [debounced, action, from, to]);

  useEffect(() => {
    setItems(null); setError("");
    pfRequest<{ items: Item[]; nextBefore: string | null }>(query()).then((page) => { setItems(page.items); setNext(page.nextBefore); })
      .catch((caught) => { setItems([]); setError(pfErrorMessage(caught, t, locale)); });
  }, [query, t, locale]);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try { const page = await pfRequest<{ items: Item[]; nextBefore: string | null }>(query(next)); setItems((current) => [...(current ?? []), ...page.items]); setNext(page.nextBefore); }
    catch (caught) { setError(pfErrorMessage(caught, t, locale)); } finally { setLoadingMore(false); }
  };

  return (
    <>
      <PfPageHeader title={t("platform.audit.title")} description={t("platform.audit.description")}>
        <PfSearch value={search} onChange={setSearch} placeholder={t("platform.audit.searchPlaceholder")} label={t("platform.common.search")} />
      </PfPageHeader>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
        <label className="grid gap-1 text-[0.78rem] font-semibold text-pf-muted">{t("platform.audit.action")}
          <PfSelect value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">{t("platform.audit.allActions")}</option>
            {groups.map((group) => <option key={group.value} value={group.value}>{t(`platform.audit.groups.${group.key}`)}</option>)}
          </PfSelect>
        </label>
        <label className="grid gap-1 text-[0.78rem] font-semibold text-pf-muted">{t("platform.audit.from")}<PfInput type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="grid gap-1 text-[0.78rem] font-semibold text-pf-muted">{t("platform.audit.to")}<PfInput type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <p className="m-0 mb-4 flex items-center gap-2 text-[0.78rem] text-pf-muted"><Icon name="shield" className="size-4 text-pf-ink" />{t("platform.audit.immutable")}</p>
      {error && <div className="mb-4"><PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice></div>}

      <PfCard className="p-2 sm:p-3">
        {items === null ? <div className="grid gap-2 p-2">{Array.from({ length: 6 }, (_, index) => <PfSkeleton key={index} className="h-16" />)}</div>
          : items.length === 0 ? <div className="p-3"><PfEmpty icon="activity" title={t("platform.audit.empty")} /></div>
          : (
            <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
              {items.map((item) => (
                <li key={item.id} className="grid gap-2 rounded-[20px] px-3 py-3 hover:bg-pf-raised md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] md:items-center md:gap-4 md:px-4">
                  <span className="flex min-w-0 items-center gap-3">
                    <PfAvatar size="sm" name={item.actor?.name ?? "S"} />
                    <span className="min-w-0">
                      <strong className="block truncate text-[0.84rem] text-pf-ink">{item.actor?.name ?? t("platform.audit.system")}</strong>
                      <span className="block text-[0.72rem] text-pf-muted">{new Date(item.occurredAt).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" })}</span>
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.84rem] font-semibold text-pf-fg">{pfEventLabel(t, item.eventType)}</span>
                    <span dir="auto" className="block truncate text-[0.74rem] text-pf-muted">{item.businessName ?? "—"}</span>
                  </span>
                  <span className="min-w-0 text-[0.76rem] text-pf-muted">
                    <span className="block truncate" title={`${pfDescribeChange(item.before)} → ${pfDescribeChange(item.after)}`}>{pfDescribeChange(item.before)} → {pfDescribeChange(item.after)}</span>
                    {item.reason && <span dir="auto" className="block truncate text-pf-fg">« {item.reason} »</span>}
                  </span>
                  <PfBadge tone="muted">{item.result === "success" ? t("platform.audit.success") : item.result}</PfBadge>
                </li>
              ))}
            </ol>
          )}
        {next && <div className="flex justify-center p-3"><PfButton variant="light" loading={loadingMore} onClick={() => void more()}>{t("platform.audit.loadMore")}</PfButton></div>}
      </PfCard>
    </>
  );
}
