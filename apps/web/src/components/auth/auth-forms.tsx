"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { controlClasses, Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/components/ui/cn";
import { authClient } from "@/lib/auth/client";
import { turnstileHeader } from "@/lib/auth/turnstile";
import { safeNext } from "@/lib/client/redirect";
import { AuthShell } from "./auth-shell";
import { TurnstileWidget, turnstileSiteKey } from "./turnstile-widget";

/** Jeton Turnstile envoyé en en-tête aux routes Better Auth protégées (jamais stocké). */
export const securityHeaders = (token: string | null) => (token ? { headers: { [turnstileHeader]: token } } : undefined);
export const turnstileRejected = (failure: { code?: string; message?: string }) => failure.code === "TURNSTILE_FAILED" || failure.message === "TURNSTILE_FAILED";

/** État partagé des formulaires protégés : jeton courant et relance du widget après chaque envoi. */
function useSecurityCheck() {
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  return { token, setToken, resetKey, ready: !turnstileSiteKey || Boolean(token), renew: () => setResetKey((value) => value + 1) };
}


/** Après connexion : invitation ou page demandée, sinon commerce actif, choix du commerce, création ou plateforme. */
export async function routeAfterSignIn(push: (url: string) => void, next: string | null) {
  const response = await fetch("/api/account/me", { cache: "no-store" });
  const me = await response.json() as { businesses?: { id: string; disabled: boolean }[]; activeBusinessId?: string | null; isPlatformAdmin?: boolean };
  const usable = (me.businesses ?? []).filter((row) => !row.disabled);
  if (next && (next.startsWith("/invitations/") || next.startsWith("/platform"))) return push(next);
  if (me.activeBusinessId) return push(next ?? "/business/dashboard");
  if (usable.length === 1) {
    await fetch("/api/account/active-business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: usable[0]!.id }) });
    return push(next ?? "/business/dashboard");
  }
  if (usable.length > 1) return push("/select-business");
  if (me.isPlatformAdmin) return push("/platform");
  return push("/onboarding");
}

export function PasswordInput({ id, value, onChange, autoComplete, describedBy, invalid }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string; describedBy?: string; invalid?: boolean }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={visible ? "text" : "password"} required minLength={8} maxLength={128} autoComplete={autoComplete} value={value} dir="ltr"
        aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} className={cn(controlClasses, "pe-12")} />
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={visible}
        className="absolute inset-y-0 end-0 grid w-12 cursor-pointer place-items-center border-0 bg-transparent text-fg-subtle hover:text-ink">
        <Icon name={visible ? "eyeOff" : "eye"} className="size-[18px]" />
      </button>
    </div>
  );
}

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("expired") ? t("auth.login.expired") : "");
  const [busy, setBusy] = useState(false);
  const security = useSecurityCheck();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!security.ready) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    const { error: failure } = await authClient.signIn.email({ email: email.trim(), password, fetchOptions: securityHeaders(security.token) });
    if (failure) { setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : t("auth.login.failed")); setBusy(false); security.renew(); return; }
    await routeAfterSignIn(router.push, next);
  };
  return (
    <AuthShell title={t("auth.login.title")} intro={t("auth.login.intro")}
      footer={<>{t("auth.login.noAccount")} <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-strong no-underline">{t("auth.login.register")}</Link></>}>
      <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("auth.email")}>{(props) => <Input {...props} type="email" dir="ltr" required autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />}</Field>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="login-password" className="text-sm font-semibold text-ink">{t("auth.password")}</label>
            <Link href="/forgot-password" className="text-sm font-semibold text-brand-strong no-underline">{t("auth.login.forgot")}</Link>
          </div>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <TurnstileWidget action="login" onToken={security.setToken} resetKey={security.resetKey} />
        <Button type="submit" size="lg" block loading={busy} disabled={!security.ready}>{busy ? t("auth.login.submitting") : t("auth.login.submit")}</Button>
      </form>
    </AuthShell>
  );
}

export function RegisterForm() {
  const { t } = useI18n();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const security = useSecurityCheck();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!security.ready) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    const { error: failure } = await authClient.signUp.email({ name: form.name.trim(), email: form.email.trim(), password: form.password, fetchOptions: securityHeaders(security.token) });
    if (failure) { setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : t("auth.register.failed")); setBusy(false); security.renew(); return; }
    router.push(next ?? "/onboarding");
  };
  return (
    <AuthShell title={t("auth.register.title")} intro={t("auth.register.intro")}
      footer={<>{t("auth.register.haveAccount")} <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-strong no-underline">{t("auth.register.login")}</Link></>}>
      <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("auth.name")}>{(props) => <Input {...props} dir="auto" required maxLength={100} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <Field label={t("auth.email")}>{(props) => <Input {...props} type="email" dir="ltr" required autoComplete="email" inputMode="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
        <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
          {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="new-password" />}
        </Field>
        <TurnstileWidget action="register" onToken={security.setToken} resetKey={security.resetKey} />
        <Button type="submit" size="lg" block loading={busy} disabled={!security.ready}>{busy ? t("auth.register.submitting") : t("auth.register.submit")}</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const security = useSecurityCheck();
  useEffect(() => {
    fetch("/api/account/capabilities", { cache: "no-store" }).then((response) => response.json() as Promise<{ emailConfigured?: boolean }>)
      .then((body) => setAvailable(Boolean(body.emailConfigured))).catch(() => setAvailable(false));
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!security.ready) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    // Réponse identique qu'un compte existe ou non : rien n'est révélé. Seul un refus Turnstile ou une
    // panne (indépendants du compte) sont signalés.
    const { error: failure } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password", fetchOptions: securityHeaders(security.token) })
      .catch(() => ({ error: { message: "network" } as { code?: string; message?: string } }));
    setBusy(false);
    if (failure) { setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : t("errors.generic")); security.renew(); return; }
    setSent(true);
  };
  return (
    <AuthShell title={t("auth.forgot.title")} intro={available ? t("auth.forgot.intro") : undefined}
      footer={<Link href="/login" className="font-semibold text-brand-strong no-underline">{t("auth.forgot.back")}</Link>}>
      {available === null ? <p className="m-0 text-sm text-fg-muted">{t("common.loading")}</p>
        : !available ? <Alert tone="info">{t("auth.forgot.unavailable")}</Alert>
        : sent ? <Alert tone="success">{t("auth.forgot.sent")}</Alert>
        : (
          <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t("auth.email")}>{(props) => <Input {...props} type="email" dir="ltr" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />}</Field>
            <TurnstileWidget action="password-reset" onToken={security.setToken} resetKey={security.resetKey} />
            <Button type="submit" size="lg" block loading={busy} disabled={!security.ready}>{t("auth.forgot.submit")}</Button>
          </form>
        )}
    </AuthShell>
  );
}

export function ResetPasswordForm() {
  const { t } = useI18n();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid">(token ? "idle" : "invalid");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setState("busy");
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setState(error ? "invalid" : "done");
  };
  return (
    <AuthShell title={t("auth.reset.title")} intro={t("auth.reset.intro")}
      footer={<Link href="/login" className="font-semibold text-brand-strong no-underline">{t("auth.forgot.back")}</Link>}>
      {state === "done" ? <Alert tone="success">{t("auth.reset.done")}</Alert> : (
        <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
          {state === "invalid" && <Alert tone="danger">{t("auth.reset.invalid")}</Alert>}
          <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
            {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} value={password} onChange={setPassword} autoComplete="new-password" />}
          </Field>
          <Button type="submit" size="lg" block loading={state === "busy"} disabled={!token}>{t("auth.reset.submit")}</Button>
        </form>
      )}
    </AuthShell>
  );
}
