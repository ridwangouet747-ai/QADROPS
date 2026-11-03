"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { TurnstileWidget, turnstileSiteKey } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { turnstileHeader } from "@/lib/auth/turnstile";
import { intlLocale } from "@/lib/i18n/config";
import { BUSINESS_DEFAULT_TIME_ZONE, formatXof } from "@/lib/i18n/format";
import type { SignupPromotion } from "@/lib/onboarding/wizard";

/** Réponse « valide » de POST /api/public/campaigns/check (contrat : docs/promotions.md). */
export type CampaignCheck = {
  valid: true; code: string; description: { fr: string; en: string; ar: string }; endsAt: string | null;
  advantage: { grantDays: number | null; discountPercent: number | null; discountXof: string | null };
  plans: { code: string; name: string }[];
  plan: { code: string; name: string; discountAmountXof: string | null } | null;
};

/** Résumé lisible de l'avantage (« 21 jours offerts · Remise de 20 % »), partagé avec l'écran de bienvenue. */
export function useAdvantageLabel() {
  const { t, locale } = useI18n();
  return (advantage: CampaignCheck["advantage"]) => [
    advantage.grantDays ? t("wizard.promo.days", { days: advantage.grantDays }) : null,
    advantage.discountPercent ? t("wizard.promo.percent", { percent: advantage.discountPercent }) : null,
    advantage.discountXof ? t("wizard.promo.fixed", { amount: formatXof(advantage.discountXof, locale) }) : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Lien discret « Vous avez un code promotionnel ? » de l'étape récapitulative. La vérification est
 * publique (Turnstile + limite par IP) et ne consomme rien : seul le serveur applique l'avantage, à la
 * création du commerce. Le code retenu remonte au parent par `onChange` ; un refus le retire.
 */
export function PromoCodeBox({ value, onChange, initialCode = "", initialPlan = "", disabled = false }: {
  value: SignupPromotion | null; onChange: (value: SignupPromotion | null) => void;
  initialCode?: string; initialPlan?: string; disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const advantageLabel = useAdvantageLabel();
  const [open, setOpen] = useState(Boolean(value || initialCode));
  const [code, setCode] = useState(value?.code ?? initialCode);
  const [result, setResult] = useState<CampaignCheck | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [security, setSecurity] = useState<{ token: string | null; resetKey: number }>({ token: null, resetKey: 0 });

  const remove = () => { setResult(null); setCode(""); setError(""); onChange(null); };

  const check = async () => {
    const typed = code.trim().toUpperCase();
    if (!typed) { setError(t("wizard.promo.empty")); return; }
    if (turnstileSiteKey && !security.token) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    const plan = value?.planCode || initialPlan.trim().toUpperCase();
    let response: Response;
    try {
      response = await fetch("/api/public/campaigns/check", {
        method: "POST", cache: "no-store",
        headers: { "content-type": "application/json", ...(security.token ? { [turnstileHeader]: security.token } : {}) },
        body: JSON.stringify({ code: typed, ...(plan ? { planCode: plan } : {}) }),
      });
    } catch {
      setBusy(false); setError(t("wizard.promo.network")); return;
    } finally {
      // Un jeton Turnstile ne sert qu'une fois : on en redemande un après chaque essai.
      setSecurity((current) => ({ token: null, resetKey: current.resetKey + 1 }));
    }
    setBusy(false);
    const body = await response.json().catch(() => ({})) as Partial<CampaignCheck> & { valid?: boolean; code?: string };
    if (response.status === 429) { setError(t("wizard.promo.rateLimited")); return; }
    if (response.status === 400 && body.code === "turnstile_failed") { setError(t("auth.turnstile.failed")); return; }
    if (!response.ok || body.valid !== true) { setResult(null); onChange(null); setError(t("wizard.promo.invalid")); return; }
    const valid = body as CampaignCheck;
    setResult(valid);
    setCode(valid.code);
    const planCode = valid.plan?.code ?? (valid.plans.length === 1 ? valid.plans[0]!.code : undefined);
    onChange({ code: valid.code, ...(planCode ? { planCode } : {}) });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={disabled}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start border-0 bg-transparent p-0 text-sm font-semibold text-brand-strong hover:underline disabled:cursor-not-allowed disabled:opacity-60">
        <Icon name="tag" className="size-4" />{t("wizard.promo.link")}
      </button>
    );
  }

  const selectedPlan = value?.planCode;
  const date = (iso: string) => new Date(iso).toLocaleDateString(intlLocale[locale], { dateStyle: "long", timeZone: BUSINESS_DEFAULT_TIME_ZONE });

  return (
    <section aria-labelledby="promo-title" className="grid gap-3 rounded-[16px] border border-line bg-surface-muted p-4">
      <h2 id="promo-title" className="m-0 flex items-center gap-2 text-[0.95rem] font-semibold text-ink"><Icon name="tag" className="size-4" />{t("wizard.promo.title")}</h2>

      {result ? (
        <div className="grid gap-3" role="status" aria-live="polite">
          <div className="rounded-[12px] border border-line bg-surface p-3">
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-ok"><Icon name="success" className="size-4" />{t("wizard.promo.valid")} <span dir="ltr" className="font-mono text-ink">{result.code}</span></p>
            <p className="m-0 mt-1 text-[0.95rem] font-semibold text-ink">{advantageLabel(result.advantage)}</p>
            <p dir="auto" className="m-0 mt-1 text-sm text-fg-muted">{result.description[locale]}</p>
            {result.plan?.discountAmountXof && result.plan.discountAmountXof !== "0" && (
              <p className="m-0 mt-1 text-sm text-fg-muted">{t("wizard.promo.amountOn", { amount: formatXof(result.plan.discountAmountXof, locale), plan: `⁨${result.plan.name}⁩` })}</p>
            )}
            {result.endsAt && <p className="m-0 mt-1 text-[0.8rem] text-fg-subtle">{t("wizard.promo.until", { date: date(result.endsAt) })}</p>}
          </div>
          {result.plans.length > 1 && (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold text-ink">{t("wizard.promo.plan")}</legend>
              {!selectedPlan && <p className="m-0 text-sm text-fg-muted">{t("wizard.promo.choosePlan")}</p>}
              <div className="flex flex-wrap gap-2">
                {result.plans.map((plan) => (
                  <label key={plan.code} className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[0.86rem] font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40", selectedPlan === plan.code ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand-tint")}>
                    <input type="radio" name="promo-plan" value={plan.code} checked={selectedPlan === plan.code} disabled={disabled}
                      onChange={() => onChange({ code: result.code, planCode: plan.code })} className="sr-only" />
                    <span dir="auto">{plan.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {result.plans.length === 1 && <p className="m-0 text-sm text-fg-muted">{t("wizard.promo.onPlan", { plan: `⁨${result.plans[0]!.name}⁩` })}</p>}
          <p className="m-0 text-[0.8rem] text-fg-muted">{t("wizard.promo.applyNote")}</p>
          <Button variant="ghost" className="justify-self-start" onClick={remove} disabled={disabled} icon={<Icon name="close" />}>{t("wizard.promo.remove")}</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {value && !error && <p className="m-0 text-sm text-fg-muted" role="status">{t("wizard.promo.applyNote")}</p>}
          <Field label={t("wizard.promo.label")} hint={t("wizard.promo.hint")} error={error || undefined}>
            {(props) => (
              <Input {...props} value={code} dir="ltr" maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                placeholder={t("wizard.promo.placeholder")} disabled={disabled || busy}
                onChange={(event) => { setCode(event.target.value); setError(""); if (value) onChange(null); }}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void check(); } }} />
            )}
          </Field>
          <TurnstileWidget action="promotion-check" resetKey={security.resetKey} onToken={(token) => setSecurity((current) => ({ ...current, token }))} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} disabled={disabled || (Boolean(turnstileSiteKey) && !security.token)} onClick={() => void check()} icon={<Icon name="check" />}>
              {busy ? t("wizard.promo.checking") : t("wizard.promo.check")}
            </Button>
            {(value || code) && <Button variant="ghost" onClick={remove} disabled={disabled || busy}>{t("wizard.promo.remove")}</Button>}
          </div>
        </div>
      )}
    </section>
  );
}

/** Message de l'écran de bienvenue selon le résultat renvoyé par POST /api/account/businesses. */
export function PromotionOutcome({ outcome }: { outcome: SignupOutcome }) {
  const { t, locale } = useI18n();
  if (!outcome) return null;
  if (outcome.status === "unavailable") return <Alert tone="warning">{t("wizard.promo.unavailable")}</Alert>;
  const plan = `⁨${outcome.plan.name}⁩`;
  const trial = outcome.grantDays && outcome.endsAt
    ? t("wizard.promo.appliedUntil", { plan, date: new Date(outcome.endsAt).toLocaleDateString(intlLocale[locale], { dateStyle: "long", timeZone: BUSINESS_DEFAULT_TIME_ZONE }) })
    : null;
  // La remise n'est jamais encaissée ici : elle est conservée pour la première facture.
  const discount = outcome.discountAmountXof !== "0" ? t("wizard.promo.appliedPending", { plan }) : null;
  return <Alert tone="success">{[trial, discount].filter(Boolean).join(" ") || t("wizard.promo.appliedPending", { plan })}</Alert>;
}

export type SignupOutcome =
  | null
  | { status: "unavailable" }
  | { status: "applied"; code: string; plan: { code: string; name: string }; grantDays: number | null; subscriptionStatus: string; endsAt: string | null; discountAmountXof: string };
