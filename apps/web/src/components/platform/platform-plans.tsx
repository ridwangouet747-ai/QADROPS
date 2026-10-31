"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { formatXof } from "@/lib/i18n/format";
import { PfPageHeader } from "./platform-shell";
import { PfBadge, PfButton, PfCard, PfDialog, PfEmpty, PfField, PfInput, PfNotice, PfSkeleton, PfTextarea, pfErrorMessage, pfFocus, pfRequest } from "./pf-ui";

type Features = { pos: boolean; reports: boolean; inventory: boolean; procurement: boolean; productLimit: number | null; userLimit: number | null };
type Plan = { id: string; code: string; name: string; description: string | null; priceXof: string; currency: string; durationDays: number; storageMb: number | null; active: boolean; features: Features; subscribers: number };
type Draft = { code: string; name: string; description: string; priceXof: string; durationDays: string; storageMb: string; userLimit: string; productLimit: string; active: boolean; pos: boolean; reports: boolean; inventory: boolean; procurement: boolean };

const featureKeys = ["pos", "reports", "inventory", "procurement"] as const;
const emptyDraft: Draft = { code: "", name: "", description: "", priceXof: "", durationDays: "30", storageMb: "", userLimit: "", productLimit: "", active: true, pos: true, reports: true, inventory: true, procurement: true };

const toDraft = (plan: Plan): Draft => ({
  code: plan.code, name: plan.name, description: plan.description ?? "", priceXof: plan.priceXof, durationDays: String(plan.durationDays),
  storageMb: plan.storageMb ? String(plan.storageMb) : "", userLimit: plan.features.userLimit ? String(plan.features.userLimit) : "",
  productLimit: plan.features.productLimit ? String(plan.features.productLimit) : "", active: plan.active,
  pos: plan.features.pos, reports: plan.features.reports, inventory: plan.features.inventory, procurement: plan.features.procurement,
});
const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

export function PlatformPlans() {
  const { t, locale } = useI18n();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try { setPlans(await pfRequest<Plan[]>("/api/platform/plans")); } catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [t, locale]);
  useEffect(() => { void load(); }, [load]);

  const open = (plan: Plan | "new") => { setDraft(plan === "new" ? emptyDraft : toDraft(plan)); setFormError(""); setEditing(plan); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setFormError("");
    const body = {
      code: draft.code, name: draft.name, description: draft.description.trim() || null, priceXof: draft.priceXof.trim(), currency: "XOF",
      durationDays: Number(draft.durationDays), storageMb: optionalNumber(draft.storageMb), active: draft.active,
      features: { pos: draft.pos, reports: draft.reports, inventory: draft.inventory, procurement: draft.procurement, userLimit: optionalNumber(draft.userLimit), productLimit: optionalNumber(draft.productLimit) },
    };
    try {
      if (editing === "new") await pfRequest("/api/platform/plans", { method: "POST", body });
      else if (editing) await pfRequest(`/api/platform/plans/${encodeURIComponent(editing.id)}`, { method: "PATCH", body });
      setEditing(null); setNotice(t("platform.plans.saved")); void load();
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <>
      <PfPageHeader title={t("platform.plans.title")} description={t("platform.plans.description")}>
        <PfButton icon="plus" onClick={() => open("new")}>{t("platform.plans.create")}</PfButton>
      </PfPageHeader>
      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {error && <PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice>}
        {notice && <PfNotice tone="success" onDismiss={() => setNotice("")}>{notice}</PfNotice>}
      </div>
      {plans === null ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <PfSkeleton key={index} className="h-80" />)}</div>
        : plans.length === 0 ? <PfEmpty icon="layers" title={t("platform.plans.empty")} />
        : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan, index) => (
              <PfCard key={plan.id} tone={index === plans.length - 1 && plans.length > 1 ? "dark" : "white"} as="article" className="flex flex-col gap-5">
                {(() => {
                  const dark = index === plans.length - 1 && plans.length > 1;
                  return (
                    <>
                      <header className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className={cn("text-[0.74rem] font-semibold tracking-wide uppercase", dark ? "text-pf-panel-fg" : "text-pf-subtle")}>{plan.code}</span>
                          <h2 className={cn("m-0 mt-1 text-[1.35rem] font-semibold tracking-[-0.03em]", dark ? "text-white" : "text-pf-ink")}>{plan.name}</h2>
                        </div>
                        {plan.active ? <PfBadge tone={dark ? "dark" : "solid"}>{t("platform.plans.subscribers", { count: plan.subscribers })}</PfBadge> : <PfBadge tone="outline">{t("platform.plans.inactive")}</PfBadge>}
                      </header>
                      <p className="m-0">
                        <span className={cn("numeric text-[2.2rem] leading-none font-semibold tracking-[-0.045em]", dark ? "text-white" : "text-pf-ink")}>{formatXof(plan.priceXof, locale)}</span>
                        <span className={cn("ms-1.5 text-[0.82rem]", dark ? "text-pf-panel-fg" : "text-pf-muted")}>{t("platform.plans.perPeriod", { days: plan.durationDays })}</span>
                      </p>
                      {plan.description && <p className={cn("m-0 text-[0.86rem]", dark ? "text-pf-panel-fg" : "text-pf-muted")}>{plan.description}</p>}
                      <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                        {featureKeys.map((key) => (
                          <li key={key} className={cn("flex items-center gap-2.5 text-[0.84rem]", plan.features[key] ? (dark ? "text-white" : "text-pf-ink") : (dark ? "text-pf-panel-fg line-through" : "text-pf-subtle line-through"))}>
                            <Icon name={plan.features[key] ? "check" : "close"} className="size-4" />{t(`platform.plans.feature.${key}`)}
                          </li>
                        ))}
                      </ul>
                      <dl className={cn("m-0 grid gap-2 rounded-[20px] p-4 text-[0.8rem]", dark ? "bg-pf-panel-soft" : "bg-pf-raised")}>
                        {([["users", plan.features.userLimit, true], ["products", plan.features.productLimit, true], ["storage", plan.storageMb, false]] as const).map(([key, value, enforced]) => (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <dt className={dark ? "text-pf-panel-fg" : "text-pf-muted"}>{t(`platform.plans.${key}`)}</dt>
                            <dd className={cn("numeric m-0 flex items-center gap-1.5 font-semibold", dark ? "text-white" : "text-pf-ink")}>
                              {value ?? t("platform.common.unlimited")}
                              {enforced && value !== null && <span title={t("platform.plans.enforced")} className="inline-flex"><Icon name="shield" className="size-3.5" label={t("platform.plans.enforced")} /></span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <PfButton variant={dark ? "light" : "dark"} icon="edit" className="mt-auto" onClick={() => open(plan)}>{t("platform.plans.edit")}</PfButton>
                    </>
                  );
                })()}
              </PfCard>
            ))}
          </div>
        )}
      <p className="m-0 mt-4 flex items-center gap-2 text-[0.78rem] text-pf-muted"><Icon name="shield" className="size-4" />{t("platform.plans.featuresNote")} {t("platform.plans.storageNote")}</p>

      <PfDialog open={editing !== null} onClose={() => !busy && setEditing(null)} wide title={editing === "new" ? t("platform.plans.createTitle") : t("platform.plans.editTitle", { name: editing ? editing.name : "" })}>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <PfField label={t("platform.plans.code")}>{(props) => <PfInput {...props} required dir="ltr" maxLength={32} pattern="[A-Za-z0-9_-]{2,32}" value={draft.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} />}</PfField>
            <PfField label={t("platform.plans.name")}>{(props) => <PfInput {...props} required maxLength={80} value={draft.name} onChange={(event) => set({ name: event.target.value })} />}</PfField>
          </div>
          <PfField label={t("platform.plans.descriptionLabel")}>{(props) => <PfTextarea {...props} maxLength={500} value={draft.description} onChange={(event) => set({ description: event.target.value })} />}</PfField>
          <div className="grid gap-4 sm:grid-cols-3">
            <PfField label={t("platform.plans.price")}>{(props) => <PfInput {...props} required inputMode="numeric" pattern="0|[1-9][0-9]{0,17}" value={draft.priceXof} onChange={(event) => set({ priceXof: event.target.value.replace(/\D/g, "") })} />}</PfField>
            <PfField label={t("platform.plans.currency")}>{(props) => <PfInput {...props} value="XOF" readOnly disabled />}</PfField>
            <PfField label={t("platform.plans.duration")}>{(props) => <PfInput {...props} required type="number" min={1} max={3650} value={draft.durationDays} onChange={(event) => set({ durationDays: event.target.value })} />}</PfField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <PfField label={t("platform.plans.users")} hint={t("platform.plans.limitHint")}>{(props) => <PfInput {...props} type="number" min={1} value={draft.userLimit} onChange={(event) => set({ userLimit: event.target.value })} />}</PfField>
            <PfField label={t("platform.plans.products")} hint={t("platform.plans.limitHint")}>{(props) => <PfInput {...props} type="number" min={1} value={draft.productLimit} onChange={(event) => set({ productLimit: event.target.value })} />}</PfField>
            <PfField label={t("platform.plans.storage")} hint={t("platform.plans.storageNote")}>{(props) => <PfInput {...props} type="number" min={1} value={draft.storageMb} onChange={(event) => set({ storageMb: event.target.value })} />}</PfField>
          </div>
          <fieldset className="m-0 grid gap-2 rounded-[20px] border border-pf-line p-4">
            <legend className="px-1 text-[0.82rem] font-semibold text-pf-ink">{t("platform.plans.features")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {featureKeys.map((key) => (
                <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.86rem] text-pf-fg">
                  <input type="checkbox" checked={draft[key]} onChange={(event) => set({ [key]: event.target.checked })} className={cn("size-5 accent-pf-ink", pfFocus)} />{t(`platform.plans.feature.${key}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.88rem] font-semibold text-pf-ink">
            <input type="checkbox" checked={draft.active} onChange={(event) => set({ active: event.target.checked })} className={cn("size-5 accent-pf-ink", pfFocus)} />{t("platform.plans.active")}
          </label>
          {formError && <PfNotice tone="alert">{formError}</PfNotice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <PfButton variant="light" onClick={() => setEditing(null)} disabled={busy}>{t("platform.common.cancel")}</PfButton>
            <PfButton type="submit" loading={busy}>{t("platform.common.save")}</PfButton>
          </div>
        </form>
      </PfDialog>
    </>
  );
}
