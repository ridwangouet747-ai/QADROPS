"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import { PfPageHeader } from "./platform-shell";
import {
  PfBadge, PfButton, PfCard, PfDialog, PfEmpty, PfField, PfInput, PfNotice, PfReasonDialog, PfSegmented, PfSelect, PfSkeleton,
  pfErrorMessage, pfFocus, pfRequest,
} from "./pf-ui";

type State = "active" | "paused" | "scheduled" | "expired" | "exhausted" | "revoked";
type Promotion = {
  id: string; code: string; kind: "access" | "discount"; planName: string | null; grantDays: number | null; discountPercent: number | null; discountXof: string | null;
  campaign: string | null; batchId: string | null; maxRedemptions: number | null; useCount: number; state: State; startsAt: string; endsAt: string | null;
};
type Plan = { id: string; name: string; active: boolean };
type Business = { businessId: string; name: string };
type Duration = "7" | "21" | "30" | "90" | "custom";
type StatusAction = { action: "pause" | "resume" | "revoke"; promotion: Promotion } | null;

const today = () => new Date().toISOString().slice(0, 10);
const stateTone = (state: State) => (state === "active" ? "solid" : state === "revoked" ? "alert" : state === "paused" || state === "scheduled" ? "muted" : "outline") as "solid" | "alert" | "muted" | "outline";

export function PlatformPromotions() {
  const { t, locale } = useI18n();
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [filter, setFilter] = useState<"" | State>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ planName: string; codes: { code: string }[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ planId: "", duration: "30" as Duration, customDays: "14", quantity: "10", prefix: "", usage: "single" as "single" | "multiple", maxUses: "20", startsAt: today(), endsAt: "", eligible: "", campaign: "", active: true });

  const load = useCallback(async () => {
    try { setPromotions(await pfRequest<Promotion[]>("/api/platform/promotions")); } catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [t, locale]);
  useEffect(() => {
    void load();
    pfRequest<Plan[]>("/api/platform/plans").then((list) => { setPlans(list); setForm((current) => ({ ...current, planId: current.planId || list.find((plan) => plan.active)?.id || "" })); }).catch(() => undefined);
    pfRequest<Business[]>("/api/platform/businesses").then(setBusinesses).catch(() => undefined);
  }, [load]);

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });
  const grantDays = form.duration === "custom" ? Number(form.customDays) : Number(form.duration);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setFormError("");
    try {
      const result = await pfRequest<{ planName: string; codes: { code: string }[] }>("/api/platform/promotions/batch", { method: "POST", body: {
        planId: form.planId, grantDays, quantity: Number(form.quantity), prefix: form.prefix, campaign: form.campaign, active: form.active,
        maxRedemptions: form.usage === "single" ? 1 : Number(form.maxUses),
        startsAt: new Date(`${form.startsAt}T00:00:00`).toISOString(), endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
        eligibleBusinessIds: form.eligible ? [form.eligible] : [],
      } });
      setGenerating(false); setGenerated(result); setCopied(false); void load();
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  const applyStatus = async (reason: string) => {
    if (!statusAction) return;
    setBusy(true); setFormError("");
    try {
      await pfRequest(`/api/platform/promotions/${encodeURIComponent(statusAction.promotion.id)}/status`, { method: "POST", body: { action: statusAction.action, reason } });
      setStatusAction(null); setNotice(t("platform.promotions.updated")); void load();
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  const benefit = (promo: Promotion) => promo.kind === "access" ? t("platform.promotions.benefitDays", { days: promo.grantDays ?? 0 })
    : promo.discountPercent !== null ? `−${promo.discountPercent} %` : `−${formatXof(promo.discountXof, locale)}`;
  const visible = (promotions ?? []).filter((promo) => !filter || promo.state === filter);
  const durations: { value: Duration; label: string }[] = [
    { value: "7", label: t("platform.promotions.d7") }, { value: "21", label: t("platform.promotions.d21") },
    { value: "30", label: t("platform.promotions.d30") }, { value: "90", label: t("platform.promotions.d90") }, { value: "custom", label: t("platform.promotions.custom") },
  ];

  return (
    <>
      <PfPageHeader title={t("platform.promotions.title")} description={t("platform.promotions.description")}>
        <PfButton icon="plus" onClick={() => { setFormError(""); setGenerating(true); }}>{t("platform.promotions.generate")}</PfButton>
      </PfPageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PfSegmented label={t("platform.promotions.stateLabel")} value={filter} onChange={setFilter}
          options={[{ value: "", label: t("platform.common.all") }, ...(["active", "scheduled", "paused", "exhausted", "expired", "revoked"] as const).map((value) => ({ value, label: t(`platform.promotions.state.${value}`) }))]} />
        <span className="flex items-center gap-2 text-[0.78rem] text-pf-muted"><Icon name="shield" className="size-4" />{t("platform.promotions.rules")}</span>
      </div>
      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {error && <PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice>}
        {notice && <PfNotice tone="success" onDismiss={() => setNotice("")}>{notice}</PfNotice>}
      </div>

      <PfCard className="p-2 sm:p-3">
        {promotions === null ? <div className="grid gap-2 p-2">{Array.from({ length: 5 }, (_, index) => <PfSkeleton key={index} className="h-16" />)}</div>
          : visible.length === 0 ? <div className="p-3"><PfEmpty icon="tag" title={t("platform.promotions.empty")} /></div>
          : (
            <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
              {visible.map((promo) => (
                <li key={promo.id} className="grid items-center gap-3 rounded-[20px] px-3 py-3 hover:bg-pf-raised sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto_auto] sm:px-4">
                  <span className="min-w-0">
                    <code dir="ltr" className="block truncate font-mono text-[0.86rem] font-semibold text-pf-ink">{promo.code}</code>
                    <span className="block truncate text-[0.74rem] text-pf-muted">{promo.campaign ?? t(`platform.promotions.kindLabel.${promo.kind}`)}</span>
                  </span>
                  <span className="min-w-0 text-[0.8rem]">
                    <span className="block truncate font-semibold text-pf-fg">{benefit(promo)}{promo.planName ? ` · ${promo.planName}` : ""}</span>
                    <span className="block truncate text-[0.74rem] text-pf-muted">{date(promo.startsAt)}{promo.endsAt ? ` → ${date(promo.endsAt)}` : ` · ${t("platform.promotions.noEnd")}`}</span>
                  </span>
                  <span className="numeric text-[0.82rem] text-pf-fg">{promo.useCount}/{promo.maxRedemptions ?? "∞"}</span>
                  <PfBadge tone={stateTone(promo.state)}>{t(`platform.promotions.state.${promo.state}`)}</PfBadge>
                  <span className="flex gap-1.5">
                    {promo.state !== "revoked" && promo.kind === "access" && (
                      promo.state === "paused"
                        ? <PfButton size="sm" variant="light" icon="play" onClick={() => setStatusAction({ action: "resume", promotion: promo })}>{t("platform.promotions.resume")}</PfButton>
                        : <PfButton size="sm" variant="light" icon="pause" onClick={() => setStatusAction({ action: "pause", promotion: promo })}>{t("platform.promotions.pause")}</PfButton>
                    )}
                    {promo.state !== "revoked" && <PfButton size="sm" variant="danger" icon="ban" onClick={() => setStatusAction({ action: "revoke", promotion: promo })}>{t("platform.promotions.revoke")}</PfButton>}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </PfCard>

      <PfDialog open={generating} onClose={() => !busy && setGenerating(false)} wide title={t("platform.promotions.generateTitle")} description={t("platform.promotions.rules")}>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PfField label={t("platform.promotions.plan")}>{(props) => (
              <PfSelect {...props} required value={form.planId} onChange={(event) => set({ planId: event.target.value })}>
                {plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </PfSelect>
            )}</PfField>
            <PfField label={t("platform.promotions.campaign")}>{(props) => <PfInput {...props} required minLength={3} maxLength={80} value={form.campaign} onChange={(event) => set({ campaign: event.target.value })} />}</PfField>
          </div>
          <div className="grid gap-2">
            <span className="text-[0.82rem] font-semibold text-pf-ink">{t("platform.promotions.duration")}</span>
            <PfSegmented label={t("platform.promotions.duration")} value={form.duration} onChange={(duration) => set({ duration })} options={durations} />
            {form.duration === "custom" && <div className="max-w-48"><PfField label={t("platform.promotions.customDays")}>{(props) => <PfInput {...props} type="number" min={1} max={365} required value={form.customDays} onChange={(event) => set({ customDays: event.target.value })} />}</PfField></div>}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <PfField label={t("platform.promotions.quantity")}>{(props) => <PfInput {...props} type="number" min={1} max={200} required value={form.quantity} onChange={(event) => set({ quantity: event.target.value })} />}</PfField>
            <PfField label={t("platform.promotions.prefix")}>{(props) => <PfInput {...props} dir="ltr" maxLength={8} pattern="[A-Za-z0-9]{0,8}" value={form.prefix} onChange={(event) => set({ prefix: event.target.value.toUpperCase() })} />}</PfField>
            <PfField label={t("platform.promotions.eligible")}>{(props) => (
              <PfSelect {...props} value={form.eligible} onChange={(event) => set({ eligible: event.target.value })}>
                <option value="">{t("platform.promotions.eligibleAll")}</option>
                {businesses.map((business) => <option key={business.businessId} value={business.businessId}>{business.name}</option>)}
              </PfSelect>
            )}</PfField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <span className="text-[0.82rem] font-semibold text-pf-ink">{t("platform.promotions.usage")}</span>
              <PfSegmented label={t("platform.promotions.usage")} value={form.usage} onChange={(usage) => set({ usage })} options={[{ value: "single", label: t("platform.promotions.single") }, { value: "multiple", label: t("platform.promotions.multiple") }]} />
            </div>
            {form.usage === "multiple" && <PfField label={t("platform.promotions.maxUses")}>{(props) => <PfInput {...props} type="number" min={2} max={100000} required value={form.maxUses} onChange={(event) => set({ maxUses: event.target.value })} />}</PfField>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PfField label={t("platform.promotions.startsAt")}>{(props) => <PfInput {...props} type="date" required value={form.startsAt} onChange={(event) => set({ startsAt: event.target.value })} />}</PfField>
            <PfField label={t("platform.promotions.endsAt")} hint={t("platform.promotions.noEnd")}>{(props) => <PfInput {...props} type="date" min={form.startsAt} value={form.endsAt} onChange={(event) => set({ endsAt: event.target.value })} />}</PfField>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.86rem] font-semibold text-pf-ink">
            <input type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} className={cn("size-5 accent-pf-ink", pfFocus)} />{t("platform.promotions.activeNow")}
          </label>
          {formError && <PfNotice tone="alert">{formError}</PfNotice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <PfButton variant="light" onClick={() => setGenerating(false)} disabled={busy}>{t("platform.common.cancel")}</PfButton>
            <PfButton type="submit" loading={busy} icon="tag">{t("platform.promotions.generate")}</PfButton>
          </div>
        </form>
      </PfDialog>

      <PfDialog open={generated !== null} onClose={() => setGenerated(null)} title={t("platform.promotions.generatedTitle", { count: generated?.codes.length ?? 0 })} description={t("platform.promotions.generatedBody")}>
        <ul dir="ltr" className="m-0 grid max-h-72 list-none gap-1.5 overflow-y-auto rounded-[20px] bg-pf-panel p-4 font-mono text-[0.86rem] text-white">
          {generated?.codes.map((item) => <li key={item.code}>{item.code}</li>)}
        </ul>
        <PfButton icon={copied ? "check" : "clipboard"} onClick={() => { void navigator.clipboard?.writeText(generated?.codes.map((item) => item.code).join("\n") ?? "").then(() => setCopied(true)).catch(() => undefined); }}>
          {copied ? t("platform.common.copied") : t("platform.promotions.copyAll")}
        </PfButton>
      </PfDialog>

      <PfReasonDialog open={statusAction !== null} busy={busy} error={formError} danger={statusAction?.action === "revoke"}
        onClose={() => setStatusAction(null)} onConfirm={(reason) => void applyStatus(reason)}
        title={statusAction ? t(`platform.promotions.${statusAction.action}Title`, { code: statusAction.promotion.code }) : ""}
        body={statusAction ? t(`platform.promotions.${statusAction.action}Body`) : ""}
        confirmLabel={statusAction ? t(`platform.promotions.${statusAction.action}`) : ""} />
    </>
  );
}
