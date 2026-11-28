"use client";

import { useRef, useState, type FormEvent } from "react";
import { TurnstileWidget, turnstileSiteKey } from "@/components/auth/turnstile-widget";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { turnstileHeader } from "@/lib/auth/turnstile";
import type { Translate } from "@/lib/i18n/translate";
import { finalizeCode, isPlausibleCode, normalizeCommercialCodeInput } from "@/lib/subscription/redeem-outcome";

/*
 * Saisie et vérification d'un code d'accès Qadr Agency, partagées par /redeem-code et l'étape d'inscription
 * (docs/commercial-access-codes.md). Le navigateur ne décide de rien : `POST /api/public/access-codes/check` vérifie
 * le code sans le consommer et pose le laissez-passer HttpOnly que l'inscription et la création du commerce exigent.
 */

/** Durée d'un code : jours, mois calendaires, ou accès permanent (`lifetime`, valeur nulle : aucune durée inventée). */
export type AccessCodeDuration = { unit: "day" | "month" | "lifetime"; value: number | null };
export const accessDurationLabel = (t: Translate, duration: AccessCodeDuration) => duration.unit === "lifetime" || duration.value === null
  ? t("access.lifetime") : t(duration.unit === "month" ? "access.durationMonths" : "access.durationDays", { count: duration.value });

export type CheckedAccessCode = {
  plan: { code: string | null; name: string | null }; duration: AccessCodeDuration; activationDeadline: string;
  next: "register" | "onboarding" | "renew"; businessName: string | null;
};
const knownErrors = new Set(["invalid", "already_used", "expired", "revoked", "invite_code", "incompatible_subscription", "business_suspended", "forbidden", "rate_limited", "network", "unavailable"]);
export type AccessCodeError = "invalid" | "already_used" | "expired" | "revoked" | "invite_code" | "incompatible_subscription" | "business_suspended" | "forbidden" | "rate_limited" | "turnstile" | "network" | "unavailable" | "malformed";
export const asAccessCodeError = (code: unknown): AccessCodeError =>
  (code === "turnstile_failed" ? "turnstile" : typeof code === "string" && knownErrors.has(code) ? code as AccessCodeError : "unavailable");
export const isTransientAccessCodeError = (error: AccessCodeError) => error === "network" || error === "unavailable" || error === "rate_limited";

export function useAccessCodeCheck(onChecked: (checked: CheckedAccessCode, code: string) => void) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccessCodeError | null>(null);
  const [security, setSecurity] = useState<{ token: string | null; resetKey: number }>({ token: null, resetKey: 0 });
  const sending = useRef(false);

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
      const body = await response.json().catch(() => null) as (CheckedAccessCode & { valid?: boolean; code?: string }) | null;
      if (response.ok && body?.valid) onChecked(body, final);
      else setError(response.status >= 500 || !body ? "unavailable" : asAccessCodeError(body.code));
    } catch { setError("network"); } finally {
      sending.current = false; setBusy(false);
      // Un jeton Turnstile ne sert qu'une fois.
      setSecurity((current) => ({ token: null, resetKey: current.resetKey + 1 }));
    }
  };

  const errorText = error === "malformed" ? t("access.redeem.malformed") : error ? t(`access.redeem.errors.${error}`) : "";
  return { code, setCode, busy, error, setError, errorText, security, setSecurity, check, sending };
}

/** Champ du code, contrôle de sécurité et bouton « Vérifier ». */
export function AccessCodeFields({ state, autoFocus = false }: { state: ReturnType<typeof useAccessCodeCheck>; autoFocus?: boolean }) {
  const { t } = useI18n();
  const { code, setCode, busy, error, setError, errorText, security, setSecurity } = state;
  return (
    <>
      {error && <Alert tone={isTransientAccessCodeError(error) ? "warning" : "danger"}>{errorText}</Alert>}
      {/* Taille et marge du champ en style : `cn` ne départage pas deux classes concurrentes (px-4 et text-base de base).
          Les 24 caractères du code tiennent ainsi en entier dans le champ dès 320 px. */}
      <Field label={t("access.redeem.label")} hint={t("access.redeem.hint")}>
        {(props) => <Input {...props} autoFocus={autoFocus} value={code} onChange={(event) => { setCode(normalizeCommercialCodeInput(event.target.value)); if (error) setError(null); }}
          dir="ltr" inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={80}
          placeholder="QADR-XXXX-XXXX-XXXX-XXXX" className="min-w-0 text-center font-mono tracking-[0.04em] sm:tracking-[0.08em]"
          style={{ fontSize: "clamp(0.85rem, 3.6vw, 1.125rem)", paddingInline: "0.5rem" }} aria-invalid={error ? true : undefined} />}
      </Field>
      <TurnstileWidget action="access-code" resetKey={security.resetKey} onToken={(token) => setSecurity((current) => ({ ...current, token }))} />
      <Button type="submit" size="lg" block loading={busy} disabled={code.length < 3 || (Boolean(turnstileSiteKey) && !security.token)} icon={<Icon name="shield" />}>
        {busy ? t("access.redeem.checking") : t("access.redeem.submit")}
      </Button>
    </>
  );
}
