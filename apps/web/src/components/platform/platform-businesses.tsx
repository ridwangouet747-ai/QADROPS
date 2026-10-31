"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useDebounced } from "@/components/business/use-paged-list";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { PfPageHeader } from "./platform-shell";
import {
  PfAvatar, PfBadge, PfButton, PfCard, PfDialog, PfEmpty, PfNotice, PfReasonDialog, PfSearch, PfSelect, PfSkeleton,
  pfDescribeChange, pfErrorMessage, pfEventLabel, pfFocus, pfRequest,
} from "./pf-ui";

type Lifecycle = "active" | "trial" | "suspended" | "expired" | "pending";
type Row = {
  businessId: string; name: string; activity: string; status: string; createdAt: string; memberCount: number; lifecycle: Lifecycle;
  owner: { name: string; email: string } | null; subscription: { planName: string; status: string; endsAt: string } | null;
};
type HistoryItem = { id: string; eventType: string; occurredAt: string; actor: { name: string | null } | null; before: unknown; after: unknown; reason: string | null };
type Detail = Row & {
  phone: string | null; businessEmail: string | null; address: string | null;
  subscriptions: { id: string; status: string; startsAt: string; endsAt: string; planName: string; origin: string }[];
  history: HistoryItem[];
};
type Plan = { id: string; name: string };

export const lifecycleTone = (value: string) => (value === "active" ? "solid" : value === "suspended" ? "alert" : value === "trial" ? "muted" : "outline") as "solid" | "alert" | "muted" | "outline";

export function PlatformBusinesses() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [state, setState] = useState("");
  const [plan, setPlan] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebounced(search);

  const load = useCallback(async () => {
    setError("");
    const query = new URLSearchParams();
    if (debounced.trim()) query.set("q", debounced.trim());
    if (state) query.set("status", state);
    if (plan) query.set("plan", plan);
    try { setRows(await pfRequest<Row[]>(`/api/platform/businesses?${query}`)); }
    catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [debounced, state, plan, t, locale]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { pfRequest<Plan[]>("/api/platform/plans").then(setPlans).catch(() => undefined); }, []);

  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });

  return (
    <>
      <PfPageHeader title={t("platform.businesses.title")} description={t("platform.businesses.description")}>
        <PfSearch value={search} onChange={setSearch} placeholder={t("platform.businesses.searchPlaceholder")} label={t("platform.common.search")} />
      </PfPageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <label className="grid gap-1 text-[0.78rem] font-semibold text-pf-muted">{t("platform.businesses.state")}
          <PfSelect value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">{t("platform.common.all")}</option>
            {(["active", "trial", "pending", "expired", "suspended"] as const).map((key) => <option key={key} value={key}>{t(`platform.lifecycle.${key}`)}</option>)}
          </PfSelect>
        </label>
        <label className="grid gap-1 text-[0.78rem] font-semibold text-pf-muted">{t("platform.businesses.plan")}
          <PfSelect value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="">{t("platform.common.all")}</option>
            {plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </PfSelect>
        </label>
      </div>

      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {error && <PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice>}
        {notice && <PfNotice tone="success" onDismiss={() => setNotice("")}>{notice}</PfNotice>}
      </div>

      <PfCard className="p-2 sm:p-3">
        {rows === null ? <div className="grid gap-2 p-2">{Array.from({ length: 5 }, (_, index) => <PfSkeleton key={index} className="h-16" />)}</div>
          : rows.length === 0 ? <div className="p-3"><PfEmpty icon="store" title={t("platform.businesses.empty")} /></div>
          : (
            <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
              <li aria-hidden="true" className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_8.5rem] gap-4 px-4 py-2 text-[0.72rem] font-semibold tracking-wide text-pf-subtle uppercase lg:grid">
                <span>{t("platform.nav.businesses")}</span><span>{t("platform.businesses.owner")}</span><span>{t("platform.businesses.created")}</span><span>{t("platform.businesses.plan")}</span><span className="text-end">{t("platform.businesses.state")}</span>
              </li>
              {rows.map((row) => (
                <li key={row.businessId}>
                  <button type="button" onClick={() => setOpenId(row.businessId)} aria-label={`${t("platform.businesses.open")} : ${row.name}`}
                    className={cn("grid w-full cursor-pointer appearance-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[20px] border border-transparent bg-transparent px-3 py-3 text-start hover:border-pf-line hover:bg-pf-raised lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_8.5rem] lg:gap-4 lg:px-4", pfFocus)}>
                    <span className="flex min-w-0 items-center gap-3">
                      <PfAvatar name={row.name} />
                      <span className="min-w-0">
                        <strong dir="auto" className="block truncate text-[0.9rem] text-pf-ink">{row.name}</strong>
                        <span className="block truncate text-[0.76rem] text-pf-muted">{t(`platform.activity.${row.activity as "general"}`)} · {t("platform.common.members", { count: row.memberCount })}</span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 lg:block">
                      <span dir="auto" className="block truncate text-[0.84rem] text-pf-fg">{row.owner?.name ?? "—"}</span>
                      <span dir="ltr" className="block truncate text-[0.74rem] text-pf-muted">{row.owner?.email ?? ""}</span>
                    </span>
                    <span className="hidden text-[0.82rem] text-pf-muted lg:block">{date(row.createdAt)}</span>
                    <span className="hidden truncate text-[0.82rem] text-pf-fg lg:block">{row.subscription?.planName ?? t("platform.businesses.noPlan")}</span>
                    <span className="flex justify-end"><PfBadge tone={lifecycleTone(row.lifecycle)}>{t(`platform.lifecycle.${row.lifecycle}`)}</PfBadge></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </PfCard>

      <BusinessDetail businessId={openId} onClose={() => setOpenId(null)} onChanged={(message) => { setNotice(message); void load(); }} />
    </>
  );
}

function BusinessDetail({ businessId, onClose, onChanged }: { businessId: string | null; onClose: () => void; onChanged: (message: string) => void }) {
  const { t, locale } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setDetail(null); setError("");
    if (!businessId) return;
    pfRequest<Detail>(`/api/platform/businesses/${encodeURIComponent(businessId)}`).then(setDetail).catch((caught) => setError(pfErrorMessage(caught, t, locale)));
  }, [businessId, t, locale]);

  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });
  const suspended = detail?.status === "suspended";
  const submit = async (reason: string) => {
    if (!detail) return;
    setBusy(true); setActionError("");
    try {
      await pfRequest(`/api/platform/businesses/${encodeURIComponent(detail.businessId)}`, { method: "PATCH", body: { status: suspended ? "active" : "suspended", reason } });
      setConfirming(false); onClose();
      onChanged(t(suspended ? "platform.businesses.reactivated" : "platform.businesses.suspended", { name: detail.name }));
    } catch (caught) { setActionError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };

  return (
    <>
      <PfDialog open={businessId !== null && !confirming} onClose={onClose} wide title={detail?.name ?? t("platform.common.loading")}
        description={detail ? `${t(`platform.activity.${detail.activity as "general"}`)} · ${t("platform.businesses.created")} ${date(detail.createdAt)}` : undefined}>
        {error && <PfNotice tone="alert">{error}</PfNotice>}
        {!detail && !error && <PfSkeleton className="h-48" />}
        {detail && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <PfBadge tone={lifecycleTone(detail.lifecycle)}>{t(`platform.lifecycle.${detail.lifecycle}`)}</PfBadge>
              <PfBadge tone="outline" dot={false}>{t("platform.common.members", { count: detail.memberCount })}</PfBadge>
              <span className="ms-auto">
                <PfButton variant={suspended ? "dark" : "danger"} icon={suspended ? "play" : "pause"} onClick={() => { setActionError(""); setConfirming(true); }}>
                  {suspended ? t("platform.businesses.reactivate") : t("platform.businesses.suspend")}
                </PfButton>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PfCard tone="soft" className="p-4 sm:p-4">
                <h3 className="m-0 mb-2 text-[0.8rem] font-semibold text-pf-muted">{t("platform.businesses.owner")}</h3>
                <p dir="auto" className="m-0 text-[0.9rem] font-semibold text-pf-ink">{detail.owner?.name ?? "—"}</p>
                <p dir="ltr" className="m-0 truncate text-[0.8rem] text-pf-muted">{detail.owner?.email ?? ""}</p>
              </PfCard>
              <PfCard tone="soft" className="p-4 sm:p-4">
                <h3 className="m-0 mb-2 text-[0.8rem] font-semibold text-pf-muted">{t("platform.businesses.detail.contact")}</h3>
                <p dir="ltr" className="m-0 text-[0.84rem] text-pf-fg">{detail.phone ?? "—"}</p>
                <p dir="auto" className="m-0 truncate text-[0.8rem] text-pf-muted">{detail.address ?? ""}</p>
              </PfCard>
            </div>
            <section>
              <h3 className="m-0 mb-2 text-[0.9rem] font-semibold text-pf-ink">{t("platform.businesses.detail.subscriptions")}</h3>
              {detail.subscriptions.length ? (
                <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                  {detail.subscriptions.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-pf-line bg-pf-card px-3 py-2.5 text-[0.82rem]">
                      <span className="min-w-0"><strong className="text-pf-ink">{item.planName}</strong><span className="ms-2 text-pf-muted">{date(item.startsAt)} → {date(item.endsAt)}</span></span>
                      <span className="flex items-center gap-2"><PfBadge tone="outline" dot={false}>{t(`platform.origin.${item.origin as "manual"}`)}</PfBadge><PfBadge tone={item.status === "active" ? "solid" : item.status === "suspended" ? "alert" : "muted"}>{t(`platform.status.${item.status as "active"}`)}</PfBadge></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 text-[0.82rem] text-pf-muted">{t("platform.businesses.detail.noSubscription")}</p>}
            </section>
            <section>
              <h3 className="m-0 mb-2 text-[0.9rem] font-semibold text-pf-ink">{t("platform.businesses.detail.history")}</h3>
              {detail.history.length ? (
                <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                  {detail.history.map((event) => (
                    <li key={event.id} className="grid gap-0.5 rounded-[18px] bg-pf-panel px-4 py-3 text-[0.8rem] text-pf-panel-fg">
                      <span className="flex items-center justify-between gap-2"><strong className="text-white">{pfEventLabel(t, event.eventType)}</strong><span>{new Date(event.occurredAt).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" })}</span></span>
                      <span>{event.actor?.name ?? t("platform.audit.system")} · {pfDescribeChange(event.before)} → {pfDescribeChange(event.after)}</span>
                      {event.reason && <span className="text-white">« {event.reason} »</span>}
                    </li>
                  ))}
                </ol>
              ) : <p className="m-0 flex items-center gap-2 text-[0.82rem] text-pf-muted"><Icon name="info" className="size-4" />{t("platform.businesses.detail.noHistory")}</p>}
            </section>
          </div>
        )}
      </PfDialog>
      <PfReasonDialog open={confirming && detail !== null} busy={busy} error={actionError} danger={!suspended}
        onClose={() => setConfirming(false)} onConfirm={(reason) => void submit(reason)}
        title={detail ? t(suspended ? "platform.businesses.reactivateTitle" : "platform.businesses.suspendTitle", { name: detail.name }) : ""}
        body={t(suspended ? "platform.businesses.reactivateBody" : "platform.businesses.suspendBody")}
        confirmLabel={suspended ? t("platform.businesses.reactivate") : t("platform.businesses.suspend")} />
    </>
  );
}
