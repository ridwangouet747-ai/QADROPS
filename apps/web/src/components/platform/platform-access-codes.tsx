"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/lib/i18n/config";
import { PfPageHeader } from "./platform-shell";
import {
  PfBadge, PfButton, PfCard, PfDialog, PfEmpty, PfField, PfInput, PfNotice, PfReasonDialog, PfSegmented, PfSelect, PfSkeleton,
  pfErrorMessage, pfFocus, pfRequest,
} from "./pf-ui";

/*
 * Gestion des accès commerciaux (2026-11-16, docs/commercial-access-codes.md) : codes uniques remis après un
 * paiement vérifié hors de l'application. Le code brut n'apparaît qu'une fois, dans la réponse de génération ;
 * la liste ne montre que ses 4 derniers caractères. Rien ici ne décide d'un état : tout vient du serveur.
 */

type State = "unused" | "used" | "expired" | "revoked";
type Filter = "all" | State;
type Code = {
  id: string; hint: string; planName: string; durationUnit: "day" | "month"; durationValue: number; activationDeadline: string; createdAt: string;
  note: string | null; createdBy: string; revokedAt: string | null; consumedAt: string | null; consumedBy: string | null; businessName: string | null; state: State;
};
type Plan = { id: string; name: string; active: boolean };
type Duration = "d7" | "d21" | "m1" | "m3" | "custom";
type Generated = { codes: { id: string; code: string }[]; plan: { name: string }; duration: { unit: "day" | "month"; value: number }; activationDeadline: string };

const stateTone = (state: State) => (state === "unused" ? "solid" : state === "revoked" ? "alert" : state === "used" ? "dark" : "outline") as "solid" | "alert" | "dark" | "outline";

export function PlatformAccessCodes() {
  const { t, locale } = useI18n();
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Code | null>(null);
  const [form, setForm] = useState({ planId: "", duration: "m1" as Duration, customDays: "14", activationDays: "30", quantity: "1", note: "", paymentVerified: false });

  const load = useCallback(async (state: Filter, before?: string) => {
    try {
      const query = new URLSearchParams({ state, limit: "50", ...(before ? { before } : {}) });
      const page = await pfRequest<{ items: Code[]; nextBefore: string | null }>(`/api/platform/access-codes?${query}`);
      setCodes((current) => (before && current ? [...current, ...page.items] : page.items));
      setNextBefore(page.nextBefore);
    } catch (caught) { setError(pfErrorMessage(caught, t, locale)); }
  }, [t, locale]);
  useEffect(() => { setCodes(null); void load(filter); }, [filter, load]);
  useEffect(() => {
    // Toutes les formules, publiées ou non : un code peut porter sur la formule Standard même avant sa publication.
    pfRequest<Plan[]>("/api/platform/plans").then((list) => {
      setPlans(list);
      setForm((current) => ({ ...current, planId: current.planId || (list.find((plan) => plan.active) ?? list[0])?.id || "" }));
    }).catch(() => setPlans([]));
  }, []);

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });
  const span = (unit: "day" | "month", value: number) => t(unit === "month" ? "platform.access.durationMonths" : "platform.access.durationDays", { count: value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.paymentVerified) { setFormError(t("platform.access.paymentRequired")); return; }
    setBusy(true); setFormError("");
    try {
      const result = await pfRequest<Generated>("/api/platform/access-codes", { method: "POST", body: {
        planId: form.planId, duration: form.duration, ...(form.duration === "custom" ? { customDays: Number(form.customDays) } : {}),
        activationDays: Number(form.activationDays), quantity: Number(form.quantity), note: form.note, paymentVerified: true,
      } });
      setOpen(false); setGenerated(result); setCopied(false);
      set({ paymentVerified: false, note: "" });
      void load(filter);
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  const revoke = async (reason: string) => {
    if (!revoking) return;
    setBusy(true); setFormError("");
    try {
      await pfRequest(`/api/platform/access-codes/${encodeURIComponent(revoking.id)}/revoke`, { method: "POST", body: { reason } });
      setRevoking(null); setNotice(t("platform.access.revoked")); void load(filter);
    } catch (caught) { setFormError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  const copy = () => {
    const text = generated?.codes.map((item) => item.code).join("\n") ?? "";
    void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined);
  };
  const durations: { value: Duration; label: string }[] = (["d7", "d21", "m1", "m3", "custom"] as const).map((value) => ({ value, label: t(`platform.access.${value}`) }));

  return (
    <>
      <PfPageHeader title={t("platform.access.title")} description={t("platform.access.description")}>
        <PfButton icon="plus" disabled={!plans?.length} onClick={() => { setFormError(""); setOpen(true); }}>{t("platform.access.generate")}</PfButton>
      </PfPageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PfSegmented label={t("platform.access.stateLabel")} value={filter} onChange={setFilter}
          options={[{ value: "all" as Filter, label: t("platform.common.all") }, ...(["unused", "used", "expired", "revoked"] as const).map((value) => ({ value: value as Filter, label: t(`platform.access.state.${value}`) }))]} />
        <span className="flex items-center gap-2 text-[0.78rem] text-pf-muted"><Icon name="shield" className="size-4" />{t("platform.access.rules")}</span>
      </div>
      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {plans?.length === 0 && <PfNotice>{t("platform.access.noPlan")}</PfNotice>}
        {error && <PfNotice tone="alert" onDismiss={() => setError("")}>{error}</PfNotice>}
        {notice && <PfNotice tone="success" onDismiss={() => setNotice("")}>{notice}</PfNotice>}
      </div>

      <PfCard className="p-2 sm:p-3">
        {codes === null ? <div className="grid gap-2 p-2">{Array.from({ length: 4 }, (_, index) => <PfSkeleton key={index} className="h-16" />)}</div>
          : codes.length === 0 ? <div className="p-3"><PfEmpty icon="tag" title={t("platform.access.empty")} /></div>
          : (
            <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
              {codes.map((code) => (
                <li key={code.id} className="grid items-center gap-3 rounded-[20px] px-3 py-3 hover:bg-pf-raised sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto_auto] sm:px-4">
                  <span className="min-w-0">
                    <code dir="ltr" className="block truncate font-mono text-[0.86rem] font-semibold text-pf-ink">QADR-…-{code.hint}</code>
                    <span className="block truncate text-[0.74rem] text-pf-muted">{code.planName} · {span(code.durationUnit, code.durationValue)}</span>
                  </span>
                  <span className="min-w-0 text-[0.76rem] text-pf-muted">
                    <span className="block truncate">{t("platform.access.createdBy", { name: code.createdBy, date: date(code.createdAt) })}</span>
                    {code.state === "used" && code.consumedAt ? (
                      <span className="block truncate font-semibold text-pf-fg">{t("platform.access.usedBy", { name: code.consumedBy ?? "—", date: date(code.consumedAt) })}{code.businessName ? ` · ${t("platform.access.usedFor", { name: code.businessName })}` : ""}</span>
                    ) : code.state === "revoked" && code.revokedAt ? (
                      <span className="block truncate">{t("platform.access.revokedOn", { date: date(code.revokedAt) })}</span>
                    ) : <span className="block truncate">{t("platform.access.deadline", { date: date(code.activationDeadline) })}</span>}
                    {code.note && <span dir="auto" className="block truncate">{code.note}</span>}
                  </span>
                  <PfBadge tone={stateTone(code.state)}>{t(`platform.access.state.${code.state}`)}</PfBadge>
                  <span className="flex gap-1.5">
                    {(code.state === "unused" || code.state === "expired") && (
                      <PfButton size="sm" variant="danger" icon="ban" onClick={() => { setFormError(""); setRevoking(code); }}>{t("platform.access.revoke")}</PfButton>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        {nextBefore && <div className="p-2"><PfButton variant="light" onClick={() => void load(filter, nextBefore)}>{t("platform.access.more")}</PfButton></div>}
      </PfCard>

      <PfDialog open={open} onClose={() => !busy && setOpen(false)} wide title={t("platform.access.generateTitle")} description={t("platform.access.rules")}>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <PfField label={t("platform.access.plan")}>{(props) => (
            <PfSelect {...props} required value={form.planId} onChange={(event) => set({ planId: event.target.value })}>
              {(plans ?? []).map((plan) => <option key={plan.id} value={plan.id}>{plan.active ? plan.name : t("platform.access.planInactive", { name: plan.name })}</option>)}
            </PfSelect>
          )}</PfField>
          <div className="grid gap-2">
            <span className="text-[0.82rem] font-semibold text-pf-ink">{t("platform.access.duration")}</span>
            <PfSegmented label={t("platform.access.duration")} value={form.duration} onChange={(duration) => set({ duration })} options={durations} />
            {form.duration === "custom" && <div className="max-w-56"><PfField label={t("platform.access.customDays")}>{(props) => <PfInput {...props} type="number" min={1} max={365} required value={form.customDays} onChange={(event) => set({ customDays: event.target.value })} />}</PfField></div>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PfField label={t("platform.access.activationDays")} hint={t("platform.access.activationHint")}>{(props) => <PfInput {...props} type="number" min={1} max={180} required value={form.activationDays} onChange={(event) => set({ activationDays: event.target.value })} />}</PfField>
            <PfField label={t("platform.access.quantity")}>{(props) => <PfInput {...props} type="number" min={1} max={20} required value={form.quantity} onChange={(event) => set({ quantity: event.target.value })} />}</PfField>
          </div>
          <PfField label={t("platform.access.note")} hint={t("platform.access.noteHint")}>{(props) => <PfInput {...props} maxLength={200} value={form.note} onChange={(event) => set({ note: event.target.value })} />}</PfField>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.86rem] font-semibold text-pf-ink">
            <input type="checkbox" checked={form.paymentVerified} onChange={(event) => set({ paymentVerified: event.target.checked })} className={cn("size-5 accent-pf-ink", pfFocus)} />{t("platform.access.paymentVerified")}
          </label>
          {formError && <PfNotice tone="alert">{formError}</PfNotice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <PfButton variant="light" onClick={() => setOpen(false)} disabled={busy}>{t("platform.common.cancel")}</PfButton>
            <PfButton type="submit" loading={busy} disabled={!form.paymentVerified || !form.planId} icon="tag">{t("platform.access.generate")}</PfButton>
          </div>
        </form>
      </PfDialog>

      <PfDialog open={generated !== null} onClose={() => setGenerated(null)} title={t("platform.access.generatedTitle")} description={t("platform.access.generatedBody")}>
        <ul dir="ltr" className="m-0 grid max-h-72 list-none gap-1.5 overflow-y-auto rounded-[20px] bg-pf-panel p-4 font-mono text-[0.92rem] tracking-[0.06em] text-white">
          {generated?.codes.map((item) => <li key={item.id} className="break-all">{item.code}</li>)}
        </ul>
        {generated && <p className="m-0 text-[0.8rem] text-pf-muted">{generated.plan.name} · {span(generated.duration.unit, generated.duration.value)} · {t("platform.access.deadline", { date: date(generated.activationDeadline) })}</p>}
        <PfButton icon={copied ? "check" : "clipboard"} onClick={copy}>
          {copied ? t("platform.common.copied") : (generated?.codes.length ?? 0) > 1 ? t("platform.access.copyAll") : t("platform.access.copy")}
        </PfButton>
      </PfDialog>

      <PfReasonDialog open={revoking !== null} busy={busy} error={formError} danger onClose={() => setRevoking(null)} onConfirm={(reason) => void revoke(reason)}
        title={revoking ? t("platform.access.revokeTitle", { hint: revoking.hint }) : ""} body={t("platform.access.revokeBody")} confirmLabel={t("platform.access.revoke")} />
    </>
  );
}
