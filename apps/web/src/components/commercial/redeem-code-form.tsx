"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { TurnstileWidget, turnstileSiteKey } from "@/components/auth/turnstile-widget";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { turnstileHeader } from "@/lib/auth/turnstile";
import { whatsappHref } from "@/lib/commercial/mode";
import { intlLocale } from "@/lib/i18n/config";
import { finalizeCode, isPlausibleCode, normalizeCodeInput, redeemPromotionCode } from "@/lib/subscription/redeem-outcome";

/*
 * Page /redeem-code (2026-11-16, docs/commercial-access-codes.md) : « Vous avez un code Qadr Agency ? ».
 * Le navigateur ne décide de rien : le serveur vérifie le code (sans le consommer), pose un laissez-passer HttpOnly
 * et indique l'étape suivante. Le renouvellement d'un commerce existant passe par la route de son abonnement,
 * avec la session : le code ne s'applique jamais à un autre commerce que celui de la session.
 */

type Checked = {
  plan: { code: string | null; name: string | null }; duration: { unit: "day" | "month"; value: number }; activationDeadline: string;
  next: "register" | "onboarding" | "renew"; businessName: string | null;
};
const knownErrors = new Set(["invalid", "already_used", "expired", "revoked", "invite_code", "incompatible_subscription", "business_suspended", "forbidden", "rate_limited", "network", "unavailable"]);
type ErrorKey = "invalid" | "already_used" | "expired" | "revoked" | "invite_code" | "incompatible_subscription" | "business_suspended" | "forbidden" | "rate_limited" | "turnstile" | "network" | "unavailable";
const asError = (code: unknown): ErrorKey => (code === "turnstile_failed" ? "turnstile" : typeof code === "string" && knownErrors.has(code) ? code as ErrorKey : "unavailable");

export function RedeemCodeForm() {
  const { t, locale } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | "malformed" | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [renewed, setRenewed] = useState<{ endsAt: string | null } | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [security, setSecurity] = useState<{ token: string | null; resetKey: number }>({ token: null, resetKey: 0 });
  const sending = useRef(false);
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "long" });
  const span = (duration: Checked["duration"]) => t(duration.unit === "month" ? "access.durationMonths" : "access.durationDays", { count: duration.value });

  useEffect(() => {
    fetch("/api/public/access-codes/pass", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((body: { whatsapp?: string | null } | null) => setWhatsapp(body?.whatsapp ?? null)).catch(() => undefined);
  }, []);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    const final = finalizeCode(code);
    setCode(final);
    if (!isPlausibleCode(final)) { setError("malformed"); return; }
    if (turnstileSiteKey && !security.token) { setError("turnstile"); return; }
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/public/access-codes/check", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", ...(security.token ? { [turnstileHeader]: security.token } : {}) },
        body: JSON.stringify({ code: final }),
      });
      const body = await response.json().catch(() => null) as (Checked & { valid?: boolean; code?: string }) | null;
      if (response.ok && body?.valid) setChecked(body);
      else setError(response.status >= 500 || !body ? "unavailable" : asError(body.code));
    } catch { setError("network"); } finally {
      sending.current = false; setBusy(false);
      // Un jeton Turnstile ne sert qu'une fois.
      setSecurity((current) => ({ token: null, resetKey: current.resetKey + 1 }));
    }
  };

  const renew = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    const outcome = await redeemPromotionCode(code, null);
    sending.current = false; setBusy(false);
    if (outcome.ok) { setRenewed({ endsAt: outcome.result.endsAt ?? null }); return; }
    setError(outcome.reason === "network" ? "network" : asError(outcome.reason));
  };

  const restart = () => { setChecked(null); setRenewed(null); setError(null); setCode(""); };
  const contact = whatsapp ? whatsappHref(whatsapp, t("access.redeem.whatsappMessage")) : null;
  const errorText = error === "malformed" ? t("access.redeem.malformed") : error ? t(`access.redeem.errors.${error}`) : "";

  return (
    <AuthShell title={t("access.redeem.title")} intro={t("access.redeem.intro")}
      footer={(
        <div className="grid gap-1">
          <span>{t("access.redeem.login")} <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("access.redeem.loginLink")}</Link></span>
          <span>{t("access.redeem.employee")} <Link href="/join-business" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("access.redeem.employeeLink")}</Link></span>
        </div>
      )}>
      {renewed && checked ? (
        <div className="grid gap-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-brand"><Icon name="check" className="size-6" /></span>
            <p className="m-0 text-lg font-bold text-ink">{t("access.redeem.renewedTitle")}</p>
          </div>
          {renewed.endsAt && <p className="m-0 text-sm text-fg-muted">{t("access.redeem.renewedBody", { business: `⁨${checked.businessName ?? ""}⁩`, date: date(renewed.endsAt) })}</p>}
          <Link href="/business/dashboard" className={buttonClasses({ variant: "primary", size: "lg", block: true, className: "no-underline" })}>{t("access.redeem.openSpace")}</Link>
        </div>
      ) : checked ? (
        <div className="grid gap-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="shield" className="size-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-lg font-bold text-ink">{t("access.redeem.validTitle")}</p>
              <p dir="ltr" className="m-0 truncate font-mono text-sm text-fg-muted">{code}</p>
            </div>
          </div>
          {error && <Alert tone={error === "network" || error === "unavailable" || error === "rate_limited" ? "warning" : "danger"}>{errorText}</Alert>}
          <dl className="m-0 grid gap-2">
            {[
              [t("access.redeem.plan"), checked.plan.name ?? "—"],
              [t("access.redeem.duration"), span(checked.duration)],
              [t("access.redeem.deadline"), date(checked.activationDeadline)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 rounded-[14px] bg-paper px-3.5 py-2.5">
                <dt className="text-sm text-fg-muted">{label}</dt>
                <dd dir="auto" className="m-0 text-end text-sm font-bold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-xs text-fg-subtle">{t("access.redeem.startsNote")}</p>
          {checked.next === "renew" ? (
            <>
              <p className="m-0 text-sm text-fg-muted">{t("access.redeem.renewNote", { business: `⁨${checked.businessName ?? ""}⁩` })}</p>
              <Button size="lg" block loading={busy} onClick={() => void renew()} icon={<Icon name="check" />}>
                {busy ? t("access.redeem.renewing") : t("access.redeem.renew", { business: `⁨${checked.businessName ?? ""}⁩` })}
              </Button>
            </>
          ) : (
            <Link href={checked.next === "register" ? "/register" : "/onboarding"} className={buttonClasses({ variant: "primary", size: "lg", block: true, className: "no-underline" })}>
              {t(checked.next === "register" ? "access.redeem.toRegister" : "access.redeem.toOnboarding")}<Icon name="forward" className="size-4" />
            </Link>
          )}
          <Button variant="secondary" size="lg" block disabled={busy} onClick={restart}>{t("access.redeem.another")}</Button>
        </div>
      ) : (
        <form method="post" noValidate onSubmit={(event) => void check(event)} className="grid gap-4">
          {error && <Alert tone={error === "network" || error === "unavailable" || error === "rate_limited" ? "warning" : "danger"}>{errorText}</Alert>}
          <Field label={t("access.redeem.label")} hint={t("access.redeem.hint")}>
            {(props) => <Input {...props} autoFocus value={code} onChange={(event) => { setCode(normalizeCodeInput(event.target.value)); if (error) setError(null); }}
              dir="ltr" inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={48}
              placeholder="QADR-XXXX-XXXX-XXXX-XXXX" className="text-center font-mono text-base tracking-[0.08em] sm:text-lg" aria-invalid={error ? true : undefined} />}
          </Field>
          <TurnstileWidget action="access-code" resetKey={security.resetKey} onToken={(token) => setSecurity((current) => ({ ...current, token }))} />
          <Button type="submit" size="lg" block loading={busy} disabled={code.length < 3 || (Boolean(turnstileSiteKey) && !security.token)} icon={<Icon name="shield" />}>
            {busy ? t("access.redeem.checking") : t("access.redeem.submit")}
          </Button>
          <div className="mt-1 grid gap-2 rounded-[16px] bg-paper p-4">
            <p className="m-0 text-sm font-semibold text-ink">{t("access.redeem.noCode")}</p>
            {contact ? (
              <a href={contact} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", size: "md", block: true, className: "no-underline" })}>
                {t("access.redeem.contact")}
              </a>
            ) : <p className="m-0 text-xs text-fg-subtle">{t("access.redeem.noContact")}</p>}
          </div>
          <Badge tone="neutral" className="justify-self-center"><Icon name="shield" className="size-3.5" />{t("subscription.manual.safety")}</Badge>
        </form>
      )}
    </AuthShell>
  );
}
