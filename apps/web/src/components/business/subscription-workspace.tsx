"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { intlLocale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import { finalizeCode, isPlausibleCode, normalizeCodeInput, redeemPromotionCode, type RedeemFailure, type RedeemSuccess } from "@/lib/subscription/redeem-outcome";

type Lifecycle = "active" | "trial" | "pending" | "expired" | "suspended";
type Overview = {
  lifecycle: Lifecycle; canRedeem: boolean;
  subscription: { status: string; inForce: boolean; planCode: string; planName: string; origin: string; startsAt: string; endsAt: string; remainingDays: number } | null;
  pending: { id: string; planName: string; priceXof: string; durationDays: number } | null;
};
type LoadState = { overview: Overview | null; failure: "load" | "forbiddenView" | null };

const lifecycleTone: Record<Lifecycle, "success" | "brand" | "warning" | "danger" | "neutral"> = { active: "success", trial: "brand", pending: "warning", expired: "danger", suspended: "danger" };
const statusKeys = new Set(["trialing", "active", "pending", "expired", "suspended", "canceled"]);
const originKeys = new Set(["promotion", "payment", "manual"]);

function useSubscriptionOverview() {
  const [state, setState] = useState<LoadState>({ overview: null, failure: null });
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/business/subscription", { cache: "no-store" });
      if (response.status === 403) { setState({ overview: null, failure: "forbiddenView" }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ overview: await response.json() as Overview, failure: null });
    } catch { setState((current) => ({ overview: current.overview, failure: "load" })); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

/** Bandeau du tableau de bord : seulement pour un commerce sans forfait ou expiré, et seulement pour qui peut agir. */
export function SubscriptionNotice() {
  const { t } = useI18n();
  const { overview } = useSubscriptionOverview();
  if (!overview?.canRedeem || (overview.lifecycle !== "pending" && overview.lifecycle !== "expired")) return null;
  const expired = overview.lifecycle === "expired";
  return (
    <Card tone="brand" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center" aria-labelledby="subscription-notice-title">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15"><Icon name="tag" /></span>
      <div className="min-w-0 flex-1">
        <h2 id="subscription-notice-title" className="m-0 text-base font-bold text-white">{t(expired ? "subscription.banner.expiredTitle" : "subscription.banner.pendingTitle")}</h2>
        <p className="m-0 mt-1 text-sm text-white/85">{t(expired ? "subscription.banner.expiredBody" : "subscription.banner.pendingBody")}</p>
      </div>
      <Link href="/business/subscription" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 text-[0.92rem] font-semibold text-brand-strong no-underline hover:bg-brand-soft">
        {t("subscription.banner.action")}<Icon name="forward" className="size-4" />
      </Link>
    </Card>
  );
}

export function SubscriptionWorkspace() {
  const { t, locale } = useI18n();
  const { overview, failure, reload } = useSubscriptionOverview();
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "long" });

  if (failure === "forbiddenView") return <><PageHeader title={t("subscription.title")}>{t("subscription.intro")}</PageHeader><EmptyState icon="shield" title={t("subscription.errors.forbiddenView")} /></>;

  const current = overview?.subscription;
  return (
    <div>
      <PageHeader title={t("subscription.title")}>{t("subscription.intro")}</PageHeader>
      {failure === "load" && <Alert tone="danger" className="mb-4">{t("subscription.errors.load")} <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-inherit underline" onClick={() => void reload()}>{t("common.retry")}</button></Alert>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <Card tone="night" aria-labelledby="subscription-current-title" className="grid gap-4">
          <CardTitle inverse id="subscription-current-title" eyebrow={t("subscription.current.title")}
            title={!overview ? <span aria-hidden="true" className="block h-7 w-40 animate-pulse rounded-full bg-white/15 motion-reduce:animate-none" /> : current ? <span dir="auto">{current.planName}</span> : t("subscription.current.none")}
            aside={overview && <Badge tone={lifecycleTone[overview.lifecycle]}>{t(`subscription.lifecycle.${overview.lifecycle}`)}</Badge>} />
          {overview && current && (
            <dl className="m-0 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] bg-night-soft/70 p-3.5">
                <dt className="text-xs text-night-fg">{t(current.inForce ? "subscription.current.endsLabel" : "subscription.current.endedLabel")}</dt>
                <dd className="m-0 mt-1 text-lg font-bold text-white">{date(current.endsAt)}</dd>
                {current.inForce && <dd className="m-0 mt-0.5 text-sm text-night-fg">{t("subscription.current.remaining", { count: current.remainingDays })}</dd>}
              </div>
              <div className="rounded-[16px] bg-night-soft/70 p-3.5">
                <dt className="text-xs text-night-fg">{t("subscription.current.source")}</dt>
                <dd className="m-0 mt-1 text-lg font-bold text-white">{originKeys.has(current.origin) ? t(`subscription.origin.${current.origin as "promotion"}`) : current.origin}</dd>
                <dd className="m-0 mt-0.5 text-sm text-night-fg">{t("subscription.current.since", { date: date(current.startsAt) })}</dd>
              </div>
            </dl>
          )}
          {overview && !current && <p className="m-0 text-sm text-night-fg">{t("subscription.current.noneHint")}</p>}
          {overview?.pending && <p className="m-0 rounded-[14px] bg-night-soft/70 p-3 text-sm text-white">{t("subscription.current.pendingPlan", { plan: overview.pending.planName })} · {formatXof(overview.pending.priceXof, locale)}</p>}
          {overview?.lifecycle === "expired" && <p className="m-0 text-sm text-night-fg">{t("subscription.current.expiredHint")}</p>}
          {overview?.lifecycle === "suspended" && <p className="m-0 text-sm text-night-fg">{t("subscription.current.suspendedHint")}</p>}
        </Card>
        <RedeemCard overview={overview} onActivated={reload} />
      </div>
    </div>
  );
}

type Step = { name: "closed" } | { name: "entry" } | { name: "confirm" } | { name: "done"; result: RedeemSuccess };

function RedeemCard({ overview, onActivated }: { overview: Overview | null; onActivated: () => Promise<void> }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>({ name: "closed" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RedeemFailure | "malformed" | null>(null);
  // Un seul envoi à la fois, même si le bouton reçoit deux appuis avant le nouveau rendu.
  const sending = useRef(false);


  const review = (event: FormEvent) => {
    event.preventDefault();
    const final = finalizeCode(code);
    setCode(final);
    if (!isPlausibleCode(final)) { setFailure("malformed"); return; }
    setFailure(null); setStep({ name: "confirm" });
  };
  const activate = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setFailure(null);
    const outcome = await redeemPromotionCode(code, overview?.pending?.id ?? null);
    sending.current = false; setBusy(false);
    if (!outcome.ok) {
      setFailure(outcome.reason);
      // Un refus définitif renvoie à la saisie ; une coupure laisse réessayer le même code (rejeu sans double comptage).
      if (outcome.reason !== "network" && outcome.reason !== "unavailable") setStep({ name: "entry" });
      return;
    }
    setStep({ name: "done", result: outcome.result });
    void onActivated();
  };
  const restart = () => { setCode(""); setFailure(null); setStep({ name: "entry" }); };

  const failureText = failure === "malformed" ? t("subscription.redeem.malformed") : failure ? t(`subscription.errors.${failure}`) : "";
  return (
    // Sur téléphone, l'activation passe en premier quand le commerce en a besoin (sans forfait ou expiré).
    <Card aria-labelledby="subscription-redeem-title" className={cn("grid gap-4", (overview?.lifecycle === "pending" || overview?.lifecycle === "expired") && "max-lg:order-first")}>
      <CardTitle id="subscription-redeem-title" title={t("subscription.redeem.title")} aside={<span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="tag" /></span>} />
      {!overview ? <Skeleton className="h-24 rounded-[16px]" /> : !overview.canRedeem ? (
        <Alert tone={overview.lifecycle === "suspended" ? "danger" : "info"}>{overview.lifecycle === "suspended" ? t("subscription.errors.business_suspended") : t("subscription.redeem.notAllowed")}</Alert>
      ) : step.name === "closed" ? (
        <>
          <p className="m-0 text-sm text-fg-muted">{t("subscription.redeem.lead")}</p>
          <Button variant="cta" size="lg" block onClick={() => setStep({ name: "entry" })} icon={<Icon name="tag" />}>{t("subscription.redeem.open")}</Button>
          <p className="m-0 text-xs text-fg-subtle">{t("subscription.redeem.noCode")}</p>
        </>
      ) : step.name === "done" ? (
        <RedeemResult result={step.result} onAnother={restart} />
      ) : (
        <form className="grid gap-4" onSubmit={step.name === "entry" ? review : (event) => { event.preventDefault(); void activate(); }} noValidate>
          {failure && <Alert tone={failure === "network" || failure === "unavailable" || failure === "rate_limited" ? "warning" : "danger"}>{failureText}</Alert>}
          {step.name === "entry" ? (
            <>
              <Field label={t("subscription.redeem.label")} hint={t("subscription.redeem.hint")}>
                {(props) => <Input {...props} autoFocus value={code} onChange={(event) => { setCode(normalizeCodeInput(event.target.value)); if (failure) setFailure(null); }}
                  dir="ltr" inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={48}
                  placeholder="QADR-XXXX-XXXX-XXXX" className="text-center font-mono text-lg tracking-[0.12em]" aria-invalid={failure ? true : undefined} />}
              </Field>
              <Button type="submit" variant="primary" size="lg" block disabled={code.length < 3} icon={<Icon name="forward" />}>{t("subscription.redeem.continue")}</Button>
            </>
          ) : (
            <>
              <div className="rounded-[16px] border border-brand-tint bg-brand-soft p-4 text-center">
                <p className="m-0 text-xs font-semibold text-brand-strong">{t("subscription.redeem.confirmTitle")}</p>
                <p dir="ltr" className="m-0 mt-2 break-all font-mono text-xl font-bold tracking-[0.12em] text-ink">{code}</p>
              </div>
              <p className="m-0 text-sm text-fg-muted">{t("subscription.redeem.confirmBody", { code: `⁦${code}⁩` })}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" size="lg" disabled={busy} onClick={() => { setFailure(null); setStep({ name: "entry" }); }}>{t("subscription.redeem.edit")}</Button>
                <Button type="submit" variant="cta" size="lg" loading={busy} icon={<Icon name="check" />}>{failure === "network" || failure === "unavailable" ? t("common.retry") : t("subscription.redeem.confirm")}</Button>
              </div>
            </>
          )}
        </form>
      )}
    </Card>
  );
}

function RedeemResult({ result, onAnother }: { result: RedeemSuccess; onAnother: () => void }) {
  const { t, locale } = useI18n();
  const rows: [string, string][] = [];
  if (result.plan) rows.push([t("subscription.result.plan"), result.plan.name]);
  if (result.kind === "access") {
    if (result.grantDays) rows.push([t("subscription.result.duration"), t("subscription.result.days", { count: result.grantDays })]);
    if (result.endsAt) rows.push([t("subscription.result.endsAt"), new Date(result.endsAt).toLocaleDateString(intlLocale[locale], { dateStyle: "long" })]);
    if (result.status && statusKeys.has(result.status)) rows.push([t("subscription.result.state"), t(`subscription.result.status.${result.status as "trialing"}`)]);
  } else {
    rows.push([t("subscription.result.discount"), formatXof(result.discountAmountXof, locale)], [t("subscription.result.amountDue"), formatXof(result.amountDueXof, locale)]);
  }
  return (
    <div className="grid gap-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-brand"><Icon name="check" className="size-6" /></span>
        <div className="min-w-0">
          <p className="m-0 text-lg font-bold text-ink">{t(result.replayed ? "subscription.result.replayed" : "subscription.result.success")}</p>
          <Badge tone="success" className="mt-1"><Icon name="shield" className="size-3.5" />{t("subscription.result.confirmed")}</Badge>
        </div>
      </div>
      {result.replayed && <p className="m-0 text-sm text-fg-muted">{t("subscription.result.replayedBody")}</p>}
      <dl className="m-0 grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className={cn("flex items-baseline justify-between gap-3 rounded-[14px] bg-paper px-3.5 py-2.5")}>
            <dt className="text-sm text-fg-muted">{label}</dt>
            <dd dir="auto" className="m-0 text-end text-sm font-bold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {result.kind === "discount" && <p className="m-0 text-sm text-fg-muted">{t(result.paymentStatus === "pending" ? "subscription.result.paymentPending" : "subscription.result.noPaymentDue")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/business/dashboard" className={buttonClasses({ variant: "primary", size: "lg", className: "no-underline" })}>{t("shell.items.dashboard.label")}</Link>
        <Button variant="secondary" size="lg" onClick={onAnother}>{t("subscription.result.another")}</Button>
      </div>
    </div>
  );
}
