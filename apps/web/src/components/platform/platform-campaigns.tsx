"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import {
  PfBadge, PfButton, PfCard, PfDialog, PfEmpty, PfField, PfInput, PfNotice, PfReasonDialog, PfSegmented, PfSkeleton, PfTextarea,
  pfErrorMessage, pfFocus, pfRequest,
} from "./pf-ui";

/*
 * Campagnes publiques (mission 12, docs/promotions.md) : offres d'acquisition réclamées seulement à
 * l'inscription d'un nouveau commerce. Distinctes des codes privés, gérés à côté dans la même page.
 */

type State = "active" | "paused" | "scheduled" | "expired" | "exhausted" | "revoked";
type Localized = { fr: string; en: string; ar: string };
type Campaign = {
  id: string; code: string; name: string; description: Localized; plans: { id: string; code: string; name: string; active: boolean }[];
  grantDays: number | null; discountPercent: number | null; discountXof: string | null;
  startsAt: string; endsAt: string | null; maxRedemptions: number | null; active: boolean;
  useCount: number; remaining: number | null; state: State; revokedAt: string | null;
};
type Redemption = { id: string; businessId: string; businessName: string; planName: string; subscriptionStatus: string; discountAmountXof: string; redeemedAt: string };
type Plan = { id: string; name: string; active: boolean };
type DiscountKind = "none" | "percent" | "fixed";
type StatusAction = { action: "pause" | "resume" | "revoke"; campaign: Campaign } | null;

const today = () => new Date().toISOString().slice(0, 10);
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const stateTone = (state: State) => (state === "active" ? "solid" : state === "revoked" ? "alert" : state === "paused" || state === "scheduled" ? "muted" : "outline") as "solid" | "alert" | "muted" | "outline";

const emptyForm = () => ({
  code: "", name: "", fr: "", en: "", ar: "", planIds: [] as string[], grantDays: "", discount: "none" as DiscountKind,
  percent: "", fixed: "", quota: "", startsAt: today(), endsAt: "", active: true,
});
type Form = ReturnType<typeof emptyForm>;

function formFrom(campaign: Campaign): Form {
  return {
    code: campaign.code, name: campaign.name, fr: campaign.description.fr, en: campaign.description.en, ar: campaign.description.ar,
    planIds: campaign.plans.map((plan) => plan.id), grantDays: campaign.grantDays?.toString() ?? "",
    discount: campaign.discountPercent !== null ? "percent" : campaign.discountXof !== null ? "fixed" : "none",
    percent: campaign.discountPercent?.toString() ?? "", fixed: campaign.discountXof ?? "", quota: campaign.maxRedemptions?.toString() ?? "",
    startsAt: day(campaign.startsAt), endsAt: day(campaign.endsAt), active: campaign.active,
  };
}

export function PlatformCampaigns() {
  const { t, locale } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [detail, setDetail] = useState<(Campaign & { redemptions: Redemption[] }) | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try { setCampaigns(await pfRequest<Campaign[]>("/api/platform/campaigns")); } catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [t, locale]);
  useEffect(() => {
    void load();
    pfRequest<Plan[]>("/api/platform/plans").then(setPlans).catch(() => undefined);
  }, [load]);

  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });
  const benefit = (campaign: Campaign) => [
    campaign.grantDays ? t("platform.campaigns.benefitDays", { days: campaign.grantDays }) : null,
    campaign.discountPercent !== null ? t("platform.campaigns.benefitPercent", { percent: campaign.discountPercent }) : null,
    campaign.discountXof !== null ? `−${formatXof(campaign.discountXof, locale)}` : null,
  ].filter(Boolean).join(" · ");

  const openCreate = () => { setForm(emptyForm()); setFormError(""); setEditing({ id: null }); };
  const openEdit = (campaign: Campaign) => { setForm(formFrom(campaign)); setFormError(""); setDetail(null); setEditing({ id: campaign.id }); };
  const openDetail = async (campaign: Campaign) => {
    setError("");
    try { setDetail(await pfRequest<Campaign & { redemptions: Redemption[] }>(`/api/platform/campaigns/${encodeURIComponent(campaign.id)}`)); }
    catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setFormError("");
    const body = {
      code: form.code.trim().toUpperCase(), name: form.name.trim(), description: { fr: form.fr.trim(), en: form.en.trim(), ar: form.ar.trim() },
      planIds: form.planIds, grantDays: form.grantDays ? Number(form.grantDays) : null,
      discountPercent: form.discount === "percent" && form.percent ? Number(form.percent) : null,
      // Montant XOF transmis en chaîne d'entiers, jamais en nombre flottant.
      discountXof: form.discount === "fixed" && form.fixed ? form.fixed.trim() : null,
      maxRedemptions: form.quota ? Number(form.quota) : null,
      startsAt: new Date(`${form.startsAt}T00:00:00`).toISOString(), endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
      active: form.active,
    };
    try {
      if (editing.id) await pfRequest(`/api/platform/campaigns/${encodeURIComponent(editing.id)}`, { method: "PATCH", body });
      else await pfRequest("/api/platform/campaigns", { method: "POST", body });
      setNotice(t(editing.id ? "platform.campaigns.updated" : "platform.campaigns.saved"));
      setEditing(null); void load();
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };

  const applyStatus = async (reason: string) => {
    if (!statusAction) return;
    setBusy(true); setFormError("");
    try {
      await pfRequest(`/api/platform/campaigns/${encodeURIComponent(statusAction.campaign.id)}/status`, { method: "POST", body: { action: statusAction.action, reason } });
      setStatusAction(null); setNotice(t("platform.campaigns.updated")); void load();
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };

  const editable = (campaign: Campaign) => campaign.state !== "revoked";
  const selectablePlans = plans.filter((plan) => plan.active || form.planIds.includes(plan.id));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[1.05rem] font-semibold text-pf-ink">{t("platform.campaigns.title")}</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-pf-muted">{t("platform.campaigns.description")}</p>
        </div>
        <PfButton icon="plus" onClick={openCreate}>{t("platform.campaigns.create")}</PfButton>
      </div>
      <p className="m-0 mb-4 flex items-start gap-2 text-[0.78rem] text-pf-muted"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{t("platform.campaigns.rules")}</p>
      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {error && <PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice>}
        {notice && <PfNotice tone="success" onDismiss={() => setNotice("")}>{notice}</PfNotice>}
      </div>

      <PfCard className="p-2 sm:p-3">
        {campaigns === null ? <div className="grid gap-2 p-2">{Array.from({ length: 3 }, (_, index) => <PfSkeleton key={index} className="h-16" />)}</div>
          : campaigns.length === 0 ? <div className="p-3"><PfEmpty icon="tag" title={t("platform.campaigns.empty")} /></div>
          : (
            <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="grid items-center gap-3 rounded-[20px] px-3 py-3 hover:bg-pf-raised sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto_auto] sm:px-4">
                  <span className="min-w-0">
                    <code dir="ltr" className="block truncate font-mono text-[0.86rem] font-semibold text-pf-ink">{campaign.code}</code>
                    <span dir="auto" className="block truncate text-[0.74rem] text-pf-muted">{campaign.name}</span>
                  </span>
                  <span className="min-w-0 text-[0.8rem]">
                    <span className="block truncate font-semibold text-pf-fg">{benefit(campaign)}</span>
                    <span className="block truncate text-[0.74rem] text-pf-muted">
                      {campaign.plans.map((plan) => plan.name).join(", ")} · {date(campaign.startsAt)}{campaign.endsAt ? ` → ${date(campaign.endsAt)}` : ` · ${t("platform.campaigns.noEnd")}`}
                    </span>
                  </span>
                  <span className="text-[0.8rem]">
                    <span className="numeric block text-pf-fg">{campaign.useCount}/{campaign.maxRedemptions ?? "∞"}</span>
                    <span className="block text-[0.74rem] text-pf-muted">{campaign.remaining === null ? t("platform.campaigns.unlimited") : t("platform.campaigns.remaining", { count: campaign.remaining })}</span>
                  </span>
                  <PfBadge tone={stateTone(campaign.state)}>{t(`platform.promotions.state.${campaign.state}`)}</PfBadge>
                  <span className="flex flex-wrap gap-1.5">
                    <PfButton size="sm" variant="light" icon="eye" onClick={() => void openDetail(campaign)}>{t("platform.campaigns.details")}</PfButton>
                    {editable(campaign) && <PfButton size="sm" variant="light" icon="edit" onClick={() => openEdit(campaign)}>{t("platform.campaigns.edit")}</PfButton>}
                    {editable(campaign) && (campaign.active
                      ? <PfButton size="sm" variant="light" icon="pause" onClick={() => { setFormError(""); setStatusAction({ action: "pause", campaign }); }}>{t("platform.campaigns.pause")}</PfButton>
                      : <PfButton size="sm" variant="light" icon="play" onClick={() => { setFormError(""); setStatusAction({ action: "resume", campaign }); }}>{t("platform.campaigns.resume")}</PfButton>)}
                    {editable(campaign) && <PfButton size="sm" variant="danger" icon="ban" onClick={() => { setFormError(""); setStatusAction({ action: "revoke", campaign }); }}>{t("platform.campaigns.revoke")}</PfButton>}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </PfCard>

      <PfDialog open={editing !== null} onClose={() => !busy && setEditing(null)} wide
        title={editing?.id ? t("platform.campaigns.editTitle", { code: form.code }) : t("platform.campaigns.createTitle")} description={t("platform.campaigns.rules")}>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PfField label={t("platform.campaigns.code")} hint={t("platform.campaigns.codeHint")}>{(props) => (
              <PfInput {...props} dir="ltr" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_\-]{3,40}" autoComplete="off" value={form.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} />
            )}</PfField>
            <PfField label={t("platform.campaigns.name")} hint={t("platform.campaigns.nameHint")}>{(props) => <PfInput {...props} dir="auto" required minLength={3} maxLength={80} value={form.name} onChange={(event) => set({ name: event.target.value })} />}</PfField>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <PfField label={t("platform.campaigns.descriptionFr")} hint={t("platform.campaigns.descriptionHint")}>{(props) => <PfTextarea {...props} dir="ltr" lang="fr" required minLength={3} maxLength={280} value={form.fr} onChange={(event) => set({ fr: event.target.value })} />}</PfField>
            <PfField label={t("platform.campaigns.descriptionEn")}>{(props) => <PfTextarea {...props} dir="ltr" lang="en" required minLength={3} maxLength={280} value={form.en} onChange={(event) => set({ en: event.target.value })} />}</PfField>
            <PfField label={t("platform.campaigns.descriptionAr")}>{(props) => <PfTextarea {...props} dir="rtl" lang="ar" required minLength={3} maxLength={280} value={form.ar} onChange={(event) => set({ ar: event.target.value })} />}</PfField>
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-[0.82rem] font-semibold text-pf-ink">{t("platform.campaigns.plans")}</legend>
            <p className="m-0 text-[0.78rem] text-pf-muted">{t("platform.campaigns.plansHint")}</p>
            <div className="flex flex-wrap gap-2">
              {selectablePlans.map((plan) => {
                const checked = form.planIds.includes(plan.id);
                return (
                  <label key={plan.id} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[0.84rem] font-semibold", checked ? "border-pf-ink bg-pf-ink text-white" : "border-pf-line bg-pf-card text-pf-ink")}>
                    <input type="checkbox" checked={checked} className={cn("size-4 accent-pf-ink", pfFocus)}
                      onChange={(event) => set({ planIds: event.target.checked ? [...form.planIds, plan.id] : form.planIds.filter((id) => id !== plan.id) })} />
                    <span dir="auto">{plan.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <PfField label={t("platform.campaigns.grantDays")} hint={t("platform.campaigns.grantDaysHint")}>{(props) => <PfInput {...props} type="number" inputMode="numeric" min={1} max={365} value={form.grantDays} onChange={(event) => set({ grantDays: event.target.value })} />}</PfField>
            <div className="grid content-start gap-2">
              <span className="text-[0.82rem] font-semibold text-pf-ink">{t("platform.campaigns.discount")}</span>
              <PfSegmented label={t("platform.campaigns.discount")} value={form.discount} onChange={(discount) => set({ discount })}
                options={[{ value: "none", label: t("platform.campaigns.discountNone") }, { value: "percent", label: t("platform.campaigns.discountPercent") }, { value: "fixed", label: t("platform.campaigns.discountFixed") }]} />
            </div>
            {form.discount === "percent" && <PfField label={t("platform.campaigns.percentValue")}>{(props) => <PfInput {...props} type="number" inputMode="numeric" min={1} max={100} required value={form.percent} onChange={(event) => set({ percent: event.target.value })} />}</PfField>}
            {form.discount === "fixed" && <PfField label={t("platform.campaigns.fixedValue")}>{(props) => <PfInput {...props} dir="ltr" inputMode="numeric" pattern="[1-9][0-9]{0,17}" required value={form.fixed} onChange={(event) => set({ fixed: event.target.value.replace(/\D/g, "") })} />}</PfField>}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <PfField label={t("platform.campaigns.quota")} hint={t("platform.campaigns.quotaHint")}>{(props) => <PfInput {...props} type="number" inputMode="numeric" min={1} max={1000000} value={form.quota} onChange={(event) => set({ quota: event.target.value })} />}</PfField>
            <PfField label={t("platform.campaigns.startsAt")}>{(props) => <PfInput {...props} type="date" required value={form.startsAt} onChange={(event) => set({ startsAt: event.target.value })} />}</PfField>
            <PfField label={t("platform.campaigns.endsAt")} hint={t("platform.campaigns.noEnd")}>{(props) => <PfInput {...props} type="date" min={form.startsAt} value={form.endsAt} onChange={(event) => set({ endsAt: event.target.value })} />}</PfField>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.86rem] font-semibold text-pf-ink">
            <input type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} className={cn("size-5 accent-pf-ink", pfFocus)} />{t("platform.campaigns.activeNow")}
          </label>
          {formError && <PfNotice tone="alert">{formError}</PfNotice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <PfButton variant="light" onClick={() => setEditing(null)} disabled={busy}>{t("platform.common.cancel")}</PfButton>
            <PfButton type="submit" loading={busy} icon="check">{t("platform.common.save")}</PfButton>
          </div>
        </form>
      </PfDialog>

      <PfDialog open={detail !== null} onClose={() => setDetail(null)} wide title={detail ? `${detail.code} · ${detail.name}` : ""} description={detail ? benefit(detail) : undefined}>
        {detail && (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3 text-[0.84rem] sm:grid-cols-3">
              <div><dt className="text-pf-muted">{t("platform.campaigns.uses")}</dt><dd className="numeric m-0 font-semibold text-pf-ink">{detail.useCount}/{detail.maxRedemptions ?? "∞"}</dd></div>
              <div><dt className="text-pf-muted">{t("platform.campaigns.plans")}</dt><dd dir="auto" className="m-0 font-semibold text-pf-ink">{detail.plans.map((plan) => plan.name).join(", ")}</dd></div>
              <div><dt className="text-pf-muted">{t("platform.campaigns.status")}</dt><dd className="m-0"><PfBadge tone={stateTone(detail.state)}>{t(`platform.promotions.state.${detail.state}`)}</PfBadge></dd></div>
            </dl>
            <div className="grid gap-1 rounded-[20px] border border-pf-line p-4 text-[0.82rem] text-pf-fg">
              <p dir="ltr" lang="fr" className="m-0">{detail.description.fr}</p>
              <p dir="ltr" lang="en" className="m-0">{detail.description.en}</p>
              <p dir="rtl" lang="ar" className="m-0">{detail.description.ar}</p>
            </div>
            <section aria-labelledby="campaign-history">
              <h3 id="campaign-history" className="m-0 mb-2 text-[0.9rem] font-semibold text-pf-ink">{t("platform.campaigns.history")}</h3>
              {detail.redemptions.length === 0 ? <PfEmpty icon="clipboard" title={t("platform.campaigns.historyEmpty")} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-start text-[0.82rem]">
                    <thead><tr className="text-pf-muted">
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t("platform.campaigns.business")}</th>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t("platform.campaigns.plan")}</th>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t("platform.campaigns.status")}</th>
                      <th scope="col" className="py-2 pe-3 text-start font-semibold">{t("platform.campaigns.discount")}</th>
                      <th scope="col" className="py-2 text-start font-semibold">{t("platform.campaigns.date")}</th>
                    </tr></thead>
                    <tbody>
                      {detail.redemptions.map((row) => (
                        <tr key={row.id} className="border-t border-pf-line">
                          <td dir="auto" className="py-2 pe-3 font-semibold text-pf-ink">{row.businessName}</td>
                          <td dir="auto" className="py-2 pe-3">{row.planName}</td>
                          <td className="py-2 pe-3">{row.subscriptionStatus}</td>
                          <td className="py-2 pe-3">{row.discountAmountXof === "0" ? t("platform.common.none") : formatXof(row.discountAmountXof, locale)}</td>
                          <td className="numeric py-2">{date(row.redeemedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {editable(detail) && <PfButton variant="light" icon="edit" className="justify-self-start" onClick={() => openEdit(detail)}>{t("platform.campaigns.edit")}</PfButton>}
          </div>
        )}
      </PfDialog>

      <PfReasonDialog open={statusAction !== null} busy={busy} error={formError} danger={statusAction?.action === "revoke"}
        onClose={() => setStatusAction(null)} onConfirm={(reason) => void applyStatus(reason)}
        title={statusAction ? t(`platform.campaigns.${statusAction.action}Title`, { code: statusAction.campaign.code }) : ""}
        body={statusAction ? t(`platform.campaigns.${statusAction.action}Body`) : ""}
        confirmLabel={statusAction ? t(`platform.campaigns.${statusAction.action}`) : ""} />
    </>
  );
}
