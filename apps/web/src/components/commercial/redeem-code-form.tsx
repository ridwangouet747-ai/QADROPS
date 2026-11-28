"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { whatsappHref } from "@/lib/commercial/mode";
import { intlLocale } from "@/lib/i18n/config";
import { redeemPromotionCode } from "@/lib/subscription/redeem-outcome";
import { AccessCodeFields, accessDurationLabel, asAccessCodeError, isTransientAccessCodeError, useAccessCodeCheck, type CheckedAccessCode } from "./access-code-check";

/*
 * Page /redeem-code (2026-11-16, docs/commercial-access-codes.md) : « Vous avez un code Qadr Agency ? ».
 * Le navigateur ne décide de rien : le serveur vérifie le code (sans le consommer), pose un laissez-passer HttpOnly
 * et indique l'étape suivante. Le renouvellement d'un commerce existant passe par la route de son abonnement,
 * avec la session : le code ne s'applique jamais à un autre commerce que celui de la session.
 */

type Checked = CheckedAccessCode;

export function RedeemCodeForm() {
  const { t, locale } = useI18n();
  const [checked, setChecked] = useState<Checked | null>(null);
  const entry = useAccessCodeCheck((value) => setChecked(value));
  const { code, setCode, busy, error, setError, errorText, sending } = entry;
  const [renewing, setRenewing] = useState(false);
  const [renewed, setRenewed] = useState<{ endsAt: string | null; lifetime: boolean } | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "long" });
  const span = (duration: Checked["duration"]) => accessDurationLabel(t, duration);

  useEffect(() => {
    fetch("/api/public/access-codes/pass", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((body: { whatsapp?: string | null } | null) => setWhatsapp(body?.whatsapp ?? null)).catch(() => undefined);
  }, []);

  const renew = async () => {
    if (sending.current) return;
    sending.current = true; setRenewing(true); setError(null);
    const outcome = await redeemPromotionCode(code, null);
    sending.current = false; setRenewing(false);
    if (outcome.ok) { setRenewed({ endsAt: outcome.result.endsAt ?? null, lifetime: outcome.result.lifetime === true }); return; }
    setError(outcome.reason === "network" ? "network" : asAccessCodeError(outcome.reason));
  };

  const restart = () => { setChecked(null); setRenewed(null); setError(null); setCode(""); };
  const contact = whatsapp ? whatsappHref(whatsapp, t("access.redeem.whatsappMessage")) : null;

  return (
    <AuthShell title={t("access.redeem.title")} intro={t("access.redeem.intro")}
      footer={(
        <div className="grid gap-1">
          <span>{t("access.redeem.login")} <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("access.redeem.loginLink")}</Link></span>
          <span>{t("access.redeem.employee")} <Link href="/join-business" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("access.redeem.employeeLink")}</Link></span>
        </div>
      )}>
      {renewed && checked ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-brand"><Icon name="check" className="size-6" /></span>
            <p className="m-0 text-lg font-bold text-ink">{t("access.redeem.renewedTitle")}</p>
          </div>
          {renewed.lifetime ? <p className="m-0 text-sm text-fg-muted">{t("access.redeem.renewedLifetime", { business: `⁨${checked.businessName ?? ""}⁩` })}</p>
            : renewed.endsAt && <p className="m-0 text-sm text-fg-muted">{t("access.redeem.renewedBody", { business: `⁨${checked.businessName ?? ""}⁩`, date: date(renewed.endsAt) })}</p>}
          <Link href="/business/dashboard" className={buttonClasses({ variant: "primary", size: "lg", block: true, className: "no-underline" })}>{t("access.redeem.openSpace")}</Link>
        </div>
      ) : checked ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-live="polite">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="shield" className="size-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-lg font-bold text-ink">{t("access.redeem.validTitle")}</p>
              <p dir="ltr" className="m-0 truncate font-mono text-sm text-fg-muted">{code}</p>
            </div>
          </div>
          {error && <Alert tone={isTransientAccessCodeError(error) ? "warning" : "danger"}>{errorText}</Alert>}
          <dl className="m-0 grid gap-2">
            {[
              [t("access.redeem.plan"), checked.plan.name ?? "—"],
              [t("access.redeem.duration"), span(checked.duration)],
              [t("access.redeem.deadline"), date(checked.activationDeadline)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[14px] bg-paper px-3.5 py-2.5">
                <dt className="min-w-0 text-sm text-fg-muted">{label}</dt>
                <dd dir="auto" className="m-0 min-w-0 break-words text-end text-sm font-bold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-xs text-fg-subtle">{t("access.redeem.startsNote")}</p>
          {checked.next === "renew" ? (
            <>
              <p className="m-0 text-sm text-fg-muted">{t("access.redeem.renewNote", { business: `⁨${checked.businessName ?? ""}⁩` })}</p>
              <Button size="lg" block loading={renewing} onClick={() => void renew()} icon={<Icon name="check" />}>
                {renewing ? t("access.redeem.renewing") : t("access.redeem.renew", { business: `⁨${checked.businessName ?? ""}⁩` })}
              </Button>
            </>
          ) : (
            <Link href={checked.next === "register" ? "/register" : "/onboarding"} className={buttonClasses({ variant: "primary", size: "lg", block: true, className: "no-underline" })}>
              {t(checked.next === "register" ? "access.redeem.toRegister" : "access.redeem.toOnboarding")}<Icon name="forward" className="size-4" />
            </Link>
          )}
          <Button variant="secondary" size="lg" block disabled={busy || renewing} onClick={restart}>{t("access.redeem.another")}</Button>
        </div>
      ) : (
        <form method="post" noValidate onSubmit={(event) => void entry.check(event)} className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <AccessCodeFields state={entry} autoFocus />
          <div className="mt-1 grid gap-2 rounded-[16px] bg-paper p-4">
            <p className="m-0 text-sm font-semibold text-ink">{t("access.redeem.noCode")}</p>
            {contact ? (
              <a href={contact} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", size: "md", block: true, className: "no-underline" })}>
                {t("access.redeem.contact")}
              </a>
            ) : <p className="m-0 text-xs text-fg-subtle">{t("access.redeem.noContact")}</p>}
          </div>
          <p className="m-0 flex items-start justify-center gap-1.5 text-center text-xs text-fg-muted">
            <Icon name="shield" className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0">{t("subscription.manual.safety")}</span>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
