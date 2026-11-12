"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/components/ui/cn";
import { safeNext } from "@/lib/client/redirect";
import { PfButton, PfField, PfInput, PfNotice, pfFocus } from "./pf-ui";

type Step = "password" | "code";
type Factor = "totp" | "backup";

/**
 * Connexion du propriétaire de la plateforme (missions 13 et 14, second facteur facultatif depuis le 2026-11-12) :
 * 1. nom d'utilisateur et mot de passe → `POST /api/platform/auth/sign-in`. Sans second facteur, la console
 *    s'ouvre aussitôt (`step: "done"`) ; si le mot de passe est encore celui de départ, on arrive sur Paramètres ;
 * 2. seulement si le second facteur est activé (`step: "two_factor"`, cookie de défi de 5 minutes) : code de
 *    l'application d'authentification ou code de secours → `POST /api/platform/auth/verify`.
 * Aucun secret côté navigateur ; erreurs génériques (aucune indication sur l'existence du compte).
 */
export function PlatformLoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requested = safeNext(params.get("next"));
  const next = requested?.startsWith("/platform") && !requested.startsWith("/platform/login") ? requested : "/platform";
  const [step, setStep] = useState<Step>("password");
  const [factor, setFactor] = useState<Factor>("totp");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(params.get("next") ? t("platform.login.expired") : "");
  const [busy, setBusy] = useState(false);

  const post = (path: string, body: unknown) => fetch(path, {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body),
  });

  const restart = () => { setStep("password"); setFactor("totp"); setCode(""); setError(""); };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await post("/api/platform/auth/sign-in", { username: username.trim(), password });
      if (response.ok) {
        const result = await response.json().catch(() => ({})) as { step?: string; defaultPassword?: boolean };
        if (result.step === "done") {
          setPassword("");
          router.replace(result.defaultPassword ? "/platform/settings?password=default" : next);
          router.refresh();
          return;
        }
        setStep("code"); setCode("");
      }
      else if (response.status === 429) setError(t("platform.login.throttled"));
      else setError(t("platform.login.failed"));
    } catch {
      setError(t("platform.login.network"));
    }
    setPassword(""); setBusy(false);
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const value = factor === "totp" ? code.replace(/\s+/g, "") : code.trim();
      const response = await post("/api/platform/auth/verify", factor === "totp" ? { code: value } : { backupCode: value });
      if (response.ok) { setCode(""); router.replace(next); router.refresh(); return; }
      setError(response.status === 429 ? t("platform.login.throttled") : t("platform.login.codeFailed"));
    } catch {
      setError(t("platform.login.network"));
    }
    setCode(""); setBusy(false);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-pf-backdrop px-4 py-8 font-sans text-pf-fg">
      <div className="w-full max-w-[420px] rounded-[28px] border border-white bg-pf-canvas p-6 shadow-pf-frame sm:p-8">
        <BrandLogo tone="mono" labelClassName="leading-tight" nameClassName="block text-[0.95rem] tracking-[-0.02em] text-pf-ink" tagline={<span className="text-[0.72rem] text-pf-muted">{t("platform.brand")}</span>} />
        {step === "password" ? (
          <>
            <h1 className="mt-6 mb-1 text-[1.6rem] leading-tight font-bold tracking-[-0.03em] text-pf-ink">{t("platform.login.title")}</h1>
            <p className="m-0 text-sm text-pf-muted">{t("platform.login.intro")}</p>
            <form method="post" onSubmit={(event) => void submitPassword(event)} className="mt-6 grid gap-4">
              {error && <PfNotice tone="alert">{error}</PfNotice>}
              <PfField label={t("platform.login.username")}>
                {(props) => <PfInput {...props} name="username" dir="ltr" required minLength={3} maxLength={30} autoComplete="username" autoCapitalize="none" spellCheck={false}
                  value={username} onChange={(event) => setUsername(event.target.value)} />}
              </PfField>
              <PfField label={t("platform.login.password")}>
                {(props) => (
                  <div className="relative">
                    <PfInput {...props} name="password" type={visible ? "text" : "password"} dir="ltr" required maxLength={128} autoComplete="current-password"
                      value={password} onChange={(event) => setPassword(event.target.value)} className="pe-12" />
                    <button type="button" onClick={() => setVisible((current) => !current)} aria-pressed={visible} aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
                      className={cn("absolute inset-y-0 end-0 grid w-12 cursor-pointer appearance-none place-items-center rounded-e-[16px] border-0 bg-transparent text-pf-muted hover:text-pf-ink", pfFocus)}>
                      <Icon name={visible ? "eyeOff" : "eye"} className="size-[18px]" />
                    </button>
                  </div>
                )}
              </PfField>
              <PfButton type="submit" loading={busy} className="w-full">{busy ? t("platform.login.submitting") : t("platform.login.submit")}</PfButton>
            </form>
          </>
        ) : (
          <>
            <h1 className="mt-6 mb-1 text-[1.6rem] leading-tight font-bold tracking-[-0.03em] text-pf-ink">{t("platform.login.codeTitle")}</h1>
            <p className="m-0 text-sm text-pf-muted">{factor === "totp" ? t("platform.login.codeIntro") : t("platform.login.backupIntro")}</p>
            <form method="post" onSubmit={(event) => void submitCode(event)} className="mt-6 grid gap-4">
              {error && <PfNotice tone="alert">{error}</PfNotice>}
              <PfField label={factor === "totp" ? t("platform.login.code") : t("platform.login.backupCode")}>
                {(props) => factor === "totp"
                  ? <PfInput {...props} key="totp" name="code" dir="ltr" required autoFocus inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7}
                    autoComplete="one-time-code" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} className="text-center text-lg tracking-[0.3em] tabular-nums" />
                  : <PfInput {...props} key="backup" name="backupCode" dir="ltr" required autoFocus minLength={8} maxLength={40} autoComplete="off"
                    autoCapitalize="none" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />}
              </PfField>
              <PfButton type="submit" loading={busy} className="w-full">{busy ? t("platform.login.verifying") : t("platform.login.verify")}</PfButton>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => { setFactor((current) => current === "totp" ? "backup" : "totp"); setCode(""); setError(""); }}
                  className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-full border-0 bg-transparent px-1 text-[0.82rem] font-semibold text-pf-ink underline-offset-4 hover:underline", pfFocus)}>
                  {factor === "totp" ? t("platform.login.useBackup") : t("platform.login.useCode")}
                </button>
                <button type="button" onClick={restart}
                  className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-full border-0 bg-transparent px-1 text-[0.82rem] text-pf-muted underline-offset-4 hover:underline", pfFocus)}>
                  {t("platform.login.restart")}
                </button>
              </div>
            </form>
          </>
        )}
        <p className="mt-5 mb-0 text-[0.76rem] text-pf-muted">{t("platform.login.notice")}</p>
        <Link href="/login" className={cn("mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[0.82rem] font-semibold text-pf-ink no-underline", pfFocus)}>
          <Icon name="back" className="size-4 rtl:-scale-x-100" />{t("platform.login.back")}
        </Link>
      </div>
    </main>
  );
}
