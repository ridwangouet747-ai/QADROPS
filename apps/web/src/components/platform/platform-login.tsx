"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/components/ui/cn";
import { safeNext } from "@/lib/client/redirect";
import { PfButton, PfField, PfInput, PfNotice, pfFocus } from "./pf-ui";

/**
 * Connexion du propriétaire de la plateforme (nom d'utilisateur et mot de passe). Aucun secret côté
 * navigateur : le formulaire appelle `POST /api/platform/auth/sign-in`, qui renvoie seulement le cookie de
 * session. Les erreurs restent génériques (aucune indication sur l'existence du compte).
 */
export function PlatformLoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requested = safeNext(params.get("next"));
  const next = requested?.startsWith("/platform") && !requested.startsWith("/platform/login") ? requested : "/platform";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(params.get("next") ? t("platform.login.expired") : "");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/platform/auth/sign-in", {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (response.ok) { setPassword(""); router.replace(next); router.refresh(); return; }
      setError(response.status === 429 ? t("platform.login.throttled") : t("platform.login.failed"));
    } catch {
      setError(t("platform.login.network"));
    }
    setPassword(""); setBusy(false);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-pf-backdrop px-4 py-8 font-sans text-pf-fg">
      <div className="w-full max-w-[420px] rounded-[28px] border border-white bg-pf-canvas p-6 shadow-pf-frame sm:p-8">
        <div className="flex items-center gap-2.5" dir="ltr">
          <span className="grid size-10 place-items-center rounded-full bg-pf-ink text-lg font-bold text-white">Q</span>
          <span className="leading-tight"><strong className="block text-[0.95rem] tracking-[-0.02em] text-pf-ink">QADR OPS</strong><span className="text-[0.72rem] text-pf-muted">{t("platform.brand")}</span></span>
        </div>
        <h1 className="mt-6 mb-1 text-[1.6rem] leading-tight font-bold tracking-[-0.03em] text-pf-ink">{t("platform.login.title")}</h1>
        <p className="m-0 text-sm text-pf-muted">{t("platform.login.intro")}</p>
        <form method="post" onSubmit={(event) => void submit(event)} className="mt-6 grid gap-4">
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
        <p className="mt-5 mb-0 text-[0.76rem] text-pf-muted">{t("platform.login.notice")}</p>
        <Link href="/login" className={cn("mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[0.82rem] font-semibold text-pf-ink no-underline", pfFocus)}>
          <Icon name="back" className="size-4 rtl:-scale-x-100" />{t("platform.login.back")}
        </Link>
      </div>
    </main>
  );
}
