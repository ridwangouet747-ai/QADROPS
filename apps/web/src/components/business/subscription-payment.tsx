"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { intlLocale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";

/*
 * Paiement de l'abonnement par GeniusPay (mission 12, lot L1b). Le navigateur n'envoie qu'un code de formule et
 * une clé d'idempotence : le montant vient du serveur. Il ne conclut JAMAIS lui-même qu'un paiement a réussi :
 * la page de retour interroge le serveur, qui relit le paiement chez GeniusPay.
 */

type Plan = { code: string; name: string; priceXof: string; durationDays: number; description: string | null };
export type PayOverview = {
  lifecycle: string; canPay?: boolean; onlinePayment?: boolean; plans?: Plan[];
  openInvoice?: { planCode: string; pendingAttemptId: string | null } | null;
};
type PayError = "billing_unavailable" | "provider_unavailable" | "payment_in_progress" | "checkout_in_progress" | "plan_not_found" | "amount_too_low"
  | "business_suspended" | "forbidden" | "network" | "unknown";
const payErrors = new Set<string>(["billing_unavailable", "provider_unavailable", "payment_in_progress", "checkout_in_progress", "plan_not_found", "amount_too_low", "business_suspended", "forbidden"]);

function newIdempotencyKey() {
  return `abo-${crypto.randomUUID()}`;
}

/** N'accepte qu'une adresse HTTPS pour quitter l'application vers la page de paiement. */
function safeCheckoutUrl(value: unknown) {
  return typeof value === "string" && URL.canParse(value) && new URL(value).protocol === "https:" ? value : null;
}

export function PayCard({ overview }: { overview: PayOverview | null }) {
  const { t, locale } = useI18n();
  const plans = overview?.plans ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PayError | null>(null);
  // Même clé tant que la demande n'a pas reçu de réponse définitive : une coupure réseau ne crée pas deux paiements.
  const key = useRef<{ plan: string; value: string } | null>(null);
  const sending = useRef(false);
  const chosen = selected ?? overview?.openInvoice?.planCode ?? (plans.length === 1 ? plans[0]!.code : null);
  const plan = plans.find((item) => item.code === chosen) ?? null;

  const pay = async () => {
    if (!plan || sending.current) return;
    sending.current = true; setBusy(true); setFailure(null);
    if (!key.current || key.current.plan !== plan.code) key.current = { plan: plan.code, value: newIdempotencyKey() };
    try {
      const response = await fetch("/api/business/subscription/checkout", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ planCode: plan.code, idempotencyKey: key.current.value }),
      });
      const body = await response.json().catch(() => null) as { code?: string; attemptId?: string; status?: string; checkoutUrl?: string | null } | null;
      if (!response.ok) {
        key.current = null;
        setFailure(body?.code && payErrors.has(body.code) ? body.code as PayError : "unknown");
        return;
      }
      key.current = null;
      const url = safeCheckoutUrl(body?.checkoutUrl);
      if (body?.status === "pending" && url) { window.location.assign(url); return; }
      // Déjà payé (paiement repris et confirmé entre-temps) : la page de retour affiche l'état vérifié.
      if (body?.attemptId) { window.location.assign(`/business/subscription/return?attempt=${encodeURIComponent(body.attemptId)}`); return; }
      setFailure("unknown");
    } catch {
      setFailure("network");
    } finally {
      sending.current = false; setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="subscription-pay-title" className={cn("grid gap-4", (overview?.lifecycle === "pending" || overview?.lifecycle === "expired") && "max-lg:order-first")}>
      <CardTitle id="subscription-pay-title" title={t("subscription.pay.title")} aside={<span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="wallet" /></span>} />
      {!overview ? <Skeleton className="h-24 rounded-[16px]" /> : !overview.onlinePayment ? (
        <Alert tone="info">{t("subscription.pay.unavailable")}</Alert>
      ) : !overview.canPay ? (
        <Alert tone={overview.lifecycle === "suspended" ? "danger" : "info"}>{overview.lifecycle === "suspended" ? t("subscription.pay.errors.business_suspended") : t("subscription.pay.ownerOnly")}</Alert>
      ) : !plans.length ? (
        <Alert tone="info">{t("subscription.pay.noPlans")}</Alert>
      ) : (
        <>
          <p className="m-0 text-sm text-fg-muted">{t("subscription.pay.lead")}</p>
          {failure && <Alert tone={failure === "network" || failure === "provider_unavailable" || failure === "checkout_in_progress" ? "warning" : "danger"}>{t(`subscription.pay.errors.${failure}`)}</Alert>}
          <ul className="m-0 grid list-none gap-2 p-0" aria-label={t("subscription.pay.title")}>
            {plans.map((item) => {
              const active = item.code === chosen;
              return (
                <li key={item.code}>
                  <button type="button" aria-pressed={active} onClick={() => { setSelected(item.code); setFailure(null); }}
                    className={cn("flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-[16px] border bg-surface px-4 py-3 text-start",
                      active ? "border-brand ring-2 ring-brand-tint" : "border-line hover:border-brand-tint")}>
                    <span className="min-w-0">
                      <span dir="auto" className="block font-bold text-ink">{item.name}</span>
                      <span className="block text-sm text-fg-muted">{t("subscription.pay.perDuration", { count: item.durationDays })}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="numeric text-base font-bold text-ink">{formatXof(item.priceXof, locale)}</span>
                      {active && <Icon name="check" className="size-5 text-brand" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button variant="cta" size="lg" block loading={busy} disabled={!plan} onClick={() => void pay()} icon={<Icon name="wallet" />}>
            {busy ? t("subscription.pay.redirecting") : overview.openInvoice?.pendingAttemptId && overview.openInvoice.planCode === chosen
              ? t("subscription.pay.resume") : plan ? t("subscription.pay.submit", { amount: formatXof(plan.priceXof, locale) }) : t("subscription.pay.choose")}
          </Button>
          <p className="m-0 text-xs text-fg-subtle">{t("subscription.pay.renewHint")}</p>
          <p className="m-0 text-xs text-fg-subtle">{t("subscription.pay.activationHint")}</p>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Page de retour */

type PaymentStatus = {
  attemptId: string; status: "pending" | "confirmed" | "failed" | "canceled" | "expired" | "refunded"; verification: "fresh" | "recent" | "unavailable" | "final";
  plan: { name: string } | null; subscription: { status: string; endsAt: string } | null;
};
const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 5_000, 10_000, 15_000, 30_000];

export function SubscriptionPaymentReturn({ attemptId }: { attemptId: string | null }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<PaymentStatus | null>(null);
  const [problem, setProblem] = useState<"notFound" | "unverifiable" | null>(attemptId ? null : "notFound");
  const round = useRef(0);
  const [waitedLong, setWaitedLong] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    if (!attemptId) return;
    try {
      const response = await fetch(`/api/business/subscription/payments/${encodeURIComponent(attemptId)}`, { cache: "no-store" });
      if (response.status === 404 || response.status === 403) { setProblem("notFound"); return; }
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as PaymentStatus;
      setState(body); setProblem(body.verification === "unavailable" ? "unverifiable" : null);
      if (body.status === "pending") {
        const delay = POLL_DELAYS_MS[Math.min(round.current, POLL_DELAYS_MS.length - 1)]!;
        round.current += 1;
        if (round.current >= 4) setWaitedLong(true);
        timer.current = setTimeout(() => void check(), delay);
      }
    } catch {
      setProblem("unverifiable");
      timer.current = setTimeout(() => void check(), 15_000);
    }
  }, [attemptId]);

  useEffect(() => {
    void check();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [check]);

  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "long" });
  const status = state?.status ?? "pending";
  const final = status !== "pending";
  const tone = status === "confirmed" ? "success" : status === "pending" ? "brand" : "danger";
  const title = !state && problem === "notFound" ? t("subscription.paymentReturn.notFound") : status === "pending" ? t("subscription.paymentReturn.checking") : t(`subscription.paymentReturn.${status}`);
  const body = status === "confirmed" && state?.subscription
    ? t("subscription.paymentReturn.confirmedBody", { plan: state.plan?.name ?? "", date: date(state.subscription.endsAt) })
    : status === "pending" ? (waitedLong ? t("subscription.paymentReturn.stillPending") : t("subscription.paymentReturn.checkingBody"))
      : t(`subscription.paymentReturn.${status}Body` as "subscription.paymentReturn.failedBody");

  return (
    <div>
      <PageHeader title={t("subscription.paymentReturn.title")} />
      {problem === "notFound" && !state ? (
        <EmptyState icon="warning" title={t("subscription.paymentReturn.notFound")} action={<Link href="/business/subscription" className={buttonClasses({ variant: "secondary", className: "no-underline" })}>{t("subscription.paymentReturn.back")}</Link>} />
      ) : (
        <Card className="mx-auto grid max-w-xl gap-4" aria-live="polite" role="status">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className={cn("grid size-12 shrink-0 place-items-center rounded-full text-white", status === "confirmed" ? "bg-brand-gradient shadow-brand" : status === "pending" ? "bg-brand" : "bg-danger")}>
              {status === "pending" ? <span className="size-5 animate-spin rounded-full border-2 border-white border-e-transparent motion-reduce:animate-none" /> : <Icon name={status === "confirmed" ? "check" : "warning"} className="size-6" />}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-lg font-bold text-ink">{title}</p>
              {final && <Badge tone={tone} className="mt-1"><Icon name="shield" className="size-3.5" />{state?.plan?.name ? <span dir="auto">{state.plan.name}</span> : null}</Badge>}
            </div>
          </div>
          <p className="m-0 text-sm text-fg-muted">{body}</p>
          {problem === "unverifiable" && status === "pending" && <Alert tone="warning">{t("subscription.paymentReturn.unverifiable")}</Alert>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/business/subscription" className={buttonClasses({ variant: status === "confirmed" ? "primary" : "secondary", size: "lg", className: "no-underline" })}>{t("subscription.paymentReturn.back")}</Link>
            {status === "pending" ? (
              <Button variant="secondary" size="lg" onClick={() => { if (timer.current) clearTimeout(timer.current); void check(); }} icon={<Icon name="activity" />}>{t("subscription.paymentReturn.refresh")}</Button>
            ) : status !== "confirmed" && status !== "refunded" ? (
              <Link href="/business/subscription" className={buttonClasses({ variant: "cta", size: "lg", className: "no-underline" })}>{t("subscription.paymentReturn.retry")}</Link>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}
