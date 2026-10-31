"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useDebounced } from "@/components/business/use-paged-list";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import { PfPageHeader } from "./platform-shell";
import {
  PfBadge, PfButton, PfCard, PfEmpty, PfField, PfInput, PfNotice, PfProgress, PfReasonDialog, PfSearch, PfSegmented, PfSkeleton,
  pfDescribeChange, pfErrorMessage, pfEventLabel, pfFocus, pfRequest,
} from "./pf-ui";

type Subscription = {
  id: string; businessName: string; status: string; origin: string; startsAt: string; endsAt: string; remainingDays: number; planName: string; planPriceXof: string;
  payments: { id: string; amountXof: string; status: string; method: string; occurredAt: string }[];
  history: { eventType: string; occurredAt: string; metadata: { before?: unknown; after?: unknown; reason?: string | null } }[];
};
type Filter = "" | "pending" | "trialing" | "active" | "suspended" | "expired" | "canceled";
type Action = { kind: "extend" | "cancel"; subscription: Subscription } | null;

export const statusTone = (status: string) => (status === "active" ? "solid" : status === "suspended" ? "alert" : status === "trialing" ? "muted" : "outline") as "solid" | "alert" | "muted" | "outline";

export function PlatformSubscriptions() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const debounced = useDebounced(search);

  const load = useCallback(async () => {
    setError("");
    const query = new URLSearchParams();
    if (filter) query.set("status", filter);
    if (debounced.trim()) query.set("q", debounced.trim());
    try { setRows((await pfRequest<{ subscriptions: Subscription[] }>(`/api/platform/subscriptions?${query}`)).subscriptions); }
    catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [filter, debounced, t, locale]);
  useEffect(() => { void load(); }, [load]);

  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });
  const submit = async (reason: string) => {
    if (!action) return;
    const parsedDays = Number(days);
    if (action.kind === "extend" && !(Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365)) { setActionError(t("platform.common.error")); return; }
    setBusy(true); setActionError("");
    try {
      await pfRequest(`/api/platform/subscriptions/${encodeURIComponent(action.subscription.id)}`, { method: "PATCH", body: action.kind === "extend" ? { action: "extend", days: parsedDays, reason } : { action: "cancel", reason } });
      setNotice(t(action.kind === "extend" ? "platform.subscriptions.extended" : "platform.subscriptions.canceled"));
      setAction(null); void load();
    } catch (caught) { setActionError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };

  const filters: { value: Filter; label: string }[] = [{ value: "", label: t("platform.common.all") }, ...(["active", "trialing", "pending", "suspended", "expired", "canceled"] as const).map((value) => ({ value, label: t(`platform.status.${value}`) }))];

  return (
    <>
      <PfPageHeader title={t("platform.subscriptions.title")} description={t("platform.subscriptions.description")}>
        <PfSearch value={search} onChange={setSearch} placeholder={t("platform.subscriptions.searchPlaceholder")} label={t("platform.common.search")} />
      </PfPageHeader>
      <div className="mb-4 max-w-full"><PfSegmented label={t("platform.businesses.state")} value={filter} onChange={setFilter} options={filters} /></div>
      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {error && <PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice>}
        {notice && <PfNotice tone="success" onDismiss={() => setNotice("")}>{notice}</PfNotice>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <PfCard className="p-2 sm:p-3">
          {rows === null ? <div className="grid gap-2 p-2">{Array.from({ length: 5 }, (_, index) => <PfSkeleton key={index} className="h-20" />)}</div>
            : rows.length === 0 ? <div className="p-3"><PfEmpty icon="receipt" title={t("platform.subscriptions.empty")} /></div>
            : (
              <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
                {rows.map((row) => {
                  const open = expanded === row.id;
                  const total = Math.max(1, Math.round((new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) / 86_400_000));
                  const actionable = ["pending", "trialing", "active", "suspended"].includes(row.status);
                  return (
                    <li key={row.id} className={cn("rounded-[20px] border px-3 py-3 sm:px-4", open ? "border-pf-line bg-pf-raised" : "border-transparent")}>
                      <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]">
                        <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : row.id)}
                          className={cn("flex min-w-0 cursor-pointer appearance-none items-center gap-2 border-0 bg-transparent p-0 text-start", pfFocus)}>
                          <Icon name="chevronDown" className={cn("size-4 shrink-0 text-pf-muted transition-transform duration-200", open && "rotate-180")} />
                          <span className="min-w-0">
                            <strong dir="auto" className="block truncate text-[0.9rem] text-pf-ink">{row.businessName}</strong>
                            <span className="block truncate text-[0.76rem] text-pf-muted">{row.planName} · {formatXof(row.planPriceXof, locale)}</span>
                          </span>
                        </button>
                        <span className="grid gap-1.5 text-[0.76rem] text-pf-muted">
                          <span>{date(row.startsAt)} → {date(row.endsAt)}</span>
                          <PfProgress value={(row.remainingDays / total) * 100} label={t("platform.subscriptions.remaining")} />
                        </span>
                        <span className="text-[0.8rem] text-pf-fg"><span className="numeric font-semibold">{t("platform.common.daysLeft", { count: row.remainingDays })}</span><span className="block text-[0.74rem] text-pf-muted">{t(`platform.origin.${row.origin as "manual"}`)}</span></span>
                        <PfBadge tone={statusTone(row.status)}>{t(`platform.status.${row.status as "active"}`)}</PfBadge>
                      </div>
                      {open && (
                        <div className="mt-4 grid gap-4 border-t border-pf-line pt-4 md:grid-cols-2">
                          <section>
                            <h3 className="m-0 mb-2 text-[0.82rem] font-semibold text-pf-ink">{t("platform.subscriptions.history")}</h3>
                            {row.history.length ? (
                              <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
                                {row.history.map((event, index) => (
                                  <li key={index} className="text-[0.78rem] text-pf-muted">
                                    <strong className="text-pf-ink">{pfEventLabel(t, event.eventType)}</strong> · {date(event.occurredAt)}
                                    <span className="block">{pfDescribeChange(event.metadata.before)} → {pfDescribeChange(event.metadata.after)}{event.metadata.reason ? ` · « ${event.metadata.reason} »` : ""}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : <p className="m-0 text-[0.78rem] text-pf-muted">{t("platform.subscriptions.noHistory")}</p>}
                          </section>
                          <section>
                            <h3 className="m-0 mb-2 text-[0.82rem] font-semibold text-pf-ink">{t("platform.subscriptions.payments")}</h3>
                            {row.payments.length ? (
                              <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
                                {row.payments.map((payment) => <li key={payment.id} className="flex justify-between gap-2 text-[0.78rem]"><span className="numeric text-pf-ink">{formatXof(payment.amountXof, locale)}</span><span className="text-pf-muted">{payment.status} · {date(payment.occurredAt)}</span></li>)}
                              </ul>
                            ) : <p className="m-0 text-[0.78rem] text-pf-muted">{t("platform.subscriptions.noPayments")}</p>}
                            {actionable && (
                              <div className="mt-4 flex flex-wrap gap-2">
                                {row.status !== "pending" && <PfButton size="sm" variant="dark" icon="plus" onClick={() => { setDays("30"); setActionError(""); setAction({ kind: "extend", subscription: row }); }}>{t("platform.subscriptions.extend")}</PfButton>}
                                <PfButton size="sm" variant="danger" icon="ban" onClick={() => { setActionError(""); setAction({ kind: "cancel", subscription: row }); }}>{t("platform.subscriptions.cancel")}</PfButton>
                              </div>
                            )}
                          </section>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </PfCard>
        <PfCard tone="dark" className="h-fit">
          <h2 className="m-0 text-[1rem] font-semibold text-white">{t("platform.subscriptions.lifecycleTitle")}</h2>
          <ol className="m-0 mt-4 grid list-none gap-2 p-0">
            {(["pending", "trialing", "active", "expired"] as const).map((status, index) => (
              <li key={status} className="flex items-center gap-3 text-[0.82rem] text-white">
                <span className="numeric grid size-7 place-items-center rounded-full bg-pf-panel-soft text-[0.72rem] text-pf-panel-fg">{index + 1}</span>{t(`platform.status.${status}`)}
              </li>
            ))}
          </ol>
          <p className="m-0 mt-4 text-[0.8rem] leading-relaxed text-pf-panel-fg">{t("platform.subscriptions.lifecycleBody")}</p>
        </PfCard>
      </div>

      <PfReasonDialog open={action !== null} busy={busy} error={actionError} danger={action?.kind === "cancel"}
        onClose={() => setAction(null)} onConfirm={(reason) => void submit(reason)}
        title={action ? t(action.kind === "extend" ? "platform.subscriptions.extendTitle" : "platform.subscriptions.cancelTitle", { name: action.subscription.businessName }) : ""}
        body={action?.kind === "cancel" ? t("platform.subscriptions.cancelBody") : undefined}
        confirmLabel={action?.kind === "extend" ? t("platform.subscriptions.extend") : t("platform.subscriptions.cancel")}
        extra={action?.kind === "extend" ? (
          <PfField label={t("platform.subscriptions.daysLabel")}>{(props) => <PfInput {...props} type="number" inputMode="numeric" min={1} max={365} required value={days} onChange={(event) => setDays(event.target.value)} />}</PfField>
        ) : undefined} />
    </>
  );
}
