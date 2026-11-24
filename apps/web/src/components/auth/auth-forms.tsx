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
import { loginMode } from "@/lib/auth/login-identifier";
import { turnstileHeader } from "@/lib/auth/turnstile";
import { announceAccountChange } from "@/lib/client/data-cache";
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


/** Après connexion : invitation ou page demandée, sinon commerce actif, choix du commerce, ou création. */
export async function routeAfterSignIn(push: (url: string) => void, next: string | null) {
  // Nouveau compte dans ce navigateur : les autres onglets oublient les données gardées de l'ancien.
  announceAccountChange();
  const response = await fetch("/api/account/me", { cache: "no-store" });
  const me = await response.json() as { businesses?: { id: string; disabled: boolean }[]; activeBusinessId?: string | null };
  const usable = (me.businesses ?? []).filter((row) => !row.disabled);
  if (next && (next.startsWith("/invitations/") || next.startsWith("/platform"))) return push(next);
  if (me.activeBusinessId) return push(next ?? "/business/dashboard");
  if (usable.length === 1) {
    await fetch("/api/account/active-business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: usable[0]!.id }) });
    return push(next ?? "/business/dashboard");
  }
  if (usable.length > 1) return push("/select-business");
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

/** Fournisseurs sociaux réellement configurés côté serveur : aucun bouton n'est affiché sans identifiants. */
function useSocialProviders() {
  const [providers, setProviders] = useState<{ google: boolean; apple: boolean }>({ google: false, apple: false });
  useEffect(() => {
    fetch("/api/account/capabilities", { cache: "no-store" }).then((response) => response.json() as Promise<{ socialProviders?: { google?: boolean; apple?: boolean } }>)
      .then((body) => setProviders({ google: Boolean(body.socialProviders?.google), apple: Boolean(body.socialProviders?.apple) })).catch(() => undefined);
  }, []);
  return providers;
}

/**
 * « Continuer avec Google / Apple » : flux OAuth de Better Auth (aucun secret dans le navigateur). Retour sur
 * /login?social=1, qui reprend l'orientation habituelle ; un nouveau compte part vers la création du commerce.
 */
function SocialButtons({ next, onError }: { next: string | null; onError: (message: string) => void }) {
  const { t } = useI18n();
  const providers = useSocialProviders();
  const [busy, setBusy] = useState<"google" | "apple" | null>(null);
  if (!providers.google && !providers.apple) return null;
  const start = async (provider: "google" | "apple") => {
    setBusy(provider);
    const back = `/login?social=1${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await authClient.signIn.social({ provider, callbackURL: back, newUserCallbackURL: "/onboarding", errorCallbackURL: "/login?social_error=1" })
      .catch(() => ({ error: { message: "network" } }));
    if (error) { onError(t("auth.social.failed")); setBusy(null); }
  };
  return (
    <div className="grid gap-3">
      {providers.google && <Button type="button" variant="secondary" size="lg" block loading={busy === "google"} onClick={() => void start("google")}>{t("auth.social.google")}</Button>}
      {providers.apple && <Button type="button" variant="secondary" size="lg" block loading={busy === "apple"} onClick={() => void start("apple")}>{t("auth.social.apple")}</Button>}
      <p className="m-0 text-center text-sm text-fg-subtle">{t("auth.social.or")}</p>
    </div>
  );
}

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Un seul champ « E-mail ou nom d'utilisateur » (2026-11-19). Avant, la page s'ouvrait sur un onglet e-mail
  // (`type="email"`) : après sa déconnexion, un employé invité par code (compte sans e-mail) y tapait son nom
  // d'utilisateur et le navigateur bloquait l'envoi. Un « @ » désigne une adresse, sinon un nom d'utilisateur.
  const [identifier, setIdentifier] = useState("");
  const mode = loginMode(identifier);
  const [password, setPassword] = useState("");
  const socialError = params.get("social_error") ? (params.get("error") === "account_not_linked" ? t("auth.social.notLinked") : t("auth.social.failed")) : "";
  const [error, setError] = useState(params.get("expired") ? t("auth.login.expired") : socialError);
  const [busy, setBusy] = useState(false);
  const security = useSecurityCheck();
  // Retour d'une connexion Google ou Apple réussie : même orientation qu'après une connexion par mot de passe.
  useEffect(() => {
    if (params.get("social") === "1") void routeAfterSignIn(router.push, next);
  }, [params, router.push, next]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!security.ready) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    if (mode === "username") {
      const status = await fetch("/api/account/sign-in/username", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", ...(security.token ? { [turnstileHeader]: security.token } : {}) },
        body: JSON.stringify({ username: identifier.trim().toLowerCase(), password }),
      }).then(async (response) => response.ok ? 200 : (await response.json().catch(() => ({})) as { code?: string }).code === "turnstile_failed" ? -1 : response.status).catch(() => 0);
      if (status !== 200) {
        setError(status === -1 ? t("auth.turnstile.failed") : status === 429 ? t("auth.login.throttled") : status === 401 ? t("auth.login.failed") : t("errors.generic")); setBusy(false); security.renew(); return;
      }
      await routeAfterSignIn(router.push, next);
      return;
    }
    const { error: failure } = await authClient.signIn.email({ email: identifier.trim(), password, fetchOptions: securityHeaders(security.token) });
    if (failure) {
      // 429 : limite du compte ou de l'adresse atteinte ; « mot de passe incorrect » ferait réessayer en vain.
      setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : failure.status === 429 ? t("auth.login.throttled") : t("auth.login.failed")); setBusy(false); security.renew(); return;
    }
    await routeAfterSignIn(router.push, next);
  };
  return (
    <AuthShell title={t("auth.login.title")} intro={t("auth.login.intro")}
      footer={<>{t("auth.login.noAccount")} <Link href={next?.startsWith("/invitations/") ? `/register?next=${encodeURIComponent(next)}` : "/redeem-code"} className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("auth.login.register")}</Link>
        <span className="block">{t("access.redeem.employee")} <Link href="/join-business" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("access.redeem.employeeLink")}</Link></span>
        {/* Accès discret à l'espace d'administration : seule la page de connexion dédiée est exposée. */}
        <span className="mt-1 flex flex-wrap justify-center gap-x-4"><Link href="/privacy" className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-fg-subtle no-underline hover:text-ink">{t("privacy.footer")}</Link><Link href="/platform/login" className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-fg-subtle no-underline hover:text-ink">{t("auth.login.adminAccess")}</Link></span></>}>
      <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <SocialButtons next={next} onError={setError} />
        <Field label={t("access.signIn.identifier")} hint={t("access.signIn.identifierHint")}>{(props) => <Input {...props} name="identifier" dir="ltr" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254} value={identifier} onChange={(event) => setIdentifier(event.target.value)} />}</Field>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="login-password" className="text-sm font-semibold text-ink">{t("auth.password")}</label>
            <Link href={mode === "username" && identifier.trim() ? "/recover-account" : "/forgot-password"} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-strong no-underline">{t("auth.login.forgot")}</Link>
          </div>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <TurnstileWidget action="login" onToken={security.setToken} resetKey={security.resetKey} />
        <Button type="submit" size="lg" block loading={busy} disabled={!security.ready}>{busy ? t("auth.login.submitting") : t("auth.login.submit")}</Button>
      </form>
    </AuthShell>
  );
}

/** Nom d'utilisateur saisi : mêmes règles que le serveur (usernameSchema), en minuscules. */
export const cleanUsername = (value: string) => value.trim().toLowerCase();

/** Appel JSON d'une route publique protégée par Turnstile : statut et code d'erreur stable, 0 si le réseau manque. */
export async function postProtected(path: string, token: string | null, body: Record<string, unknown>) {
  try {
    const response = await fetch(path, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", ...(token ? { [turnstileHeader]: token } : {}) }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as { code?: string; recoveryCode?: string };
    return { status: response.status, code: payload.code, recoveryCode: payload.recoveryCode };
  } catch {
    return { status: 0, code: undefined, recoveryCode: undefined };
  }
}

/**
 * Code de secours montré une seule fois (compte sans e-mail, mission CTO du 2026-11-17, § 7). Le bouton pour
 * continuer reste inactif tant que le titulaire n'a pas confirmé l'avoir noté.
 */
export function RecoveryCodeNotice({ code, title, intro, action, onContinue }: { code: string; title: string; intro: string; action: string; onContinue: () => void }) {
  return <AuthShell title={title} intro={intro}><RecoveryCodePanel code={code} action={action} onContinue={onContinue} /></AuthShell>;
}

/** Contenu de l'affichage du code de secours, sans cadre de page (réutilisé par l'inscription en cinq étapes). */
export function RecoveryCodePanel({ code, action, onContinue }: { code: string; action: string; onContinue: () => void }) {
  const { t } = useI18n();
  const [noted, setNoted] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
      <div className="grid gap-4">
        <p className="m-0 select-all rounded-xl border border-line bg-paper px-4 py-4 text-center font-mono text-[1.15rem] font-bold tracking-[0.12em] text-ink [overflow-wrap:anywhere]" dir="ltr" aria-label={t("auth.recovery.codeLabel")}>{code}</p>
        <Button type="button" variant="secondary" block icon={<Icon name="clipboard" />}
          onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false))}>
          {copied ? t("auth.recovery.copied") : t("auth.recovery.copy")}
        </Button>
        <Alert tone="info">{t("auth.recovery.keepSafe")}</Alert>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
          <input type="checkbox" className="size-5 accent-brand" checked={noted} onChange={(event) => setNoted(event.target.checked)} />{t("auth.recovery.confirm")}
        </label>
        <Button type="button" size="lg" block disabled={!noted} onClick={onContinue}>{action}</Button>
      </div>
  );
}

export function RegisterForm() {
  const { t } = useI18n();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const security = useSecurityCheck();
  // E-mail facultatif (mission CTO du 2026-11-17, § 7) : sans adresse, le compte est identifié par son nom
  // d'utilisateur ; aucune adresse n'est inventée (user.email reste vide).
  const withoutEmail = form.email.trim() === "";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!security.ready) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    if (withoutEmail) {
      const result = await postProtected("/api/account/sign-up/username", security.token, { name: form.name.trim(), username: cleanUsername(form.username), password: form.password });
      if (result.status === 201 && result.recoveryCode) { setRecoveryCode(result.recoveryCode); return; }
      setError(result.code === "turnstile_failed" ? t("auth.turnstile.failed") : result.code === "username_taken" ? t("auth.register.usernameTaken")
        : result.status === 429 ? t("auth.register.throttled") : result.status === 400 ? t("auth.register.invalid") : result.status === 0 ? t("errors.generic") : t("auth.register.failedWithoutEmail"));
      setBusy(false); security.renew(); return;
    }
    const { error: failure } = await authClient.signUp.email({ name: form.name.trim(), email: form.email.trim(), password: form.password, fetchOptions: securityHeaders(security.token) });
    if (failure) { setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : t("auth.register.failed")); setBusy(false); security.renew(); return; }
    router.push(next ?? "/onboarding");
  };
  if (recoveryCode) {
    return <RecoveryCodeNotice code={recoveryCode} title={t("auth.recovery.savedTitle")} intro={t("auth.recovery.savedIntro", { username: cleanUsername(form.username) })}
      action={t("auth.recovery.continue")} onContinue={() => router.push(next ?? "/onboarding")} />;
  }
  return (
    <AuthShell title={t("auth.register.title")} intro={t("auth.register.intro")}
      footer={<>{t("auth.register.haveAccount")} <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("auth.register.login")}</Link></>}>
      <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <SocialButtons next={next} onError={setError} />
        <Field label={t("auth.name")}>{(props) => <Input {...props} dir="auto" required maxLength={100} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <Field label={t("auth.register.emailOptional")} hint={t("auth.register.emailHint")}>{(props) => <Input {...props} type="email" dir="ltr" autoComplete="email" inputMode="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
        {withoutEmail && (
          <Field label={t("access.signIn.username")} hint={t("auth.register.usernameHint")}>{(props) => <Input {...props} dir="ltr" required minLength={3} maxLength={30} pattern="[A-Za-z0-9._]+" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />}</Field>
        )}
        <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
          {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="new-password" />}
        </Field>
        <TurnstileWidget action="register" onToken={security.setToken} resetKey={security.resetKey} />
        <Button type="submit" size="lg" block loading={busy} disabled={!security.ready}>{busy ? t("auth.register.submitting") : t("auth.register.submit")}</Button>
      </form>
    </AuthShell>
  );
}

/** Mot de passe oublié sans e-mail : nom d'utilisateur + code de secours + nouveau mot de passe (page /recover-account). */
export function RecoverAccountForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", code: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nextCode, setNextCode] = useState<string | null>(null);
  const security = useSecurityCheck();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!security.ready) { setError(t("auth.turnstile.required")); return; }
    setBusy(true); setError("");
    const result = await postProtected("/api/account/recover", security.token, { username: cleanUsername(form.username), recoveryCode: form.code, newPassword: form.password });
    if (result.status === 200 && result.recoveryCode) { setNextCode(result.recoveryCode); return; }
    setError(result.code === "turnstile_failed" ? t("auth.turnstile.failed") : result.status === 429 ? t("auth.recovery.throttled") : result.status === 401 ? t("auth.recovery.failed") : result.status === 400 ? t("auth.recovery.invalid") : t("errors.generic"));
    setBusy(false); security.renew();
  };
  if (nextCode) {
    return <RecoveryCodeNotice code={nextCode} title={t("auth.recovery.doneTitle")} intro={t("auth.recovery.doneIntro")} action={t("auth.recovery.toLogin")}
      onContinue={() => router.push("/login?mode=username")} />;
  }
  return (
    <AuthShell title={t("auth.recovery.title")} intro={t("auth.recovery.intro")}
      footer={<Link href="/login?mode=username" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("auth.forgot.back")}</Link>}>
      <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("access.signIn.username")}>{(props) => <Input {...props} dir="ltr" required minLength={3} maxLength={30} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />}</Field>
        <Field label={t("auth.recovery.codeLabel")} hint={t("auth.recovery.codeHint")}>{(props) => <Input {...props} dir="ltr" required maxLength={64} autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="font-mono uppercase" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />}</Field>
        <Field label={t("auth.recovery.newPassword")} hint={t("auth.passwordHint")}>
          {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="new-password" />}
        </Field>
        <TurnstileWidget action="password-reset" onToken={security.setToken} resetKey={security.resetKey} />
        <Button type="submit" size="lg" block loading={busy} disabled={!security.ready}>{busy ? t("auth.recovery.submitting") : t("auth.recovery.submit")}</Button>
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
    if (failure) {
      const throttled = "status" in failure && failure.status === 429;
      setError(turnstileRejected(failure) ? t("auth.turnstile.failed") : throttled ? t("auth.forgot.throttled") : t("errors.generic")); security.renew(); return;
    }
    setSent(true);
  };
  return (
    <AuthShell title={t("auth.forgot.title")} intro={available ? t("auth.forgot.intro") : undefined}
      footer={<><Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("auth.forgot.back")}</Link>
        <span className="block">{t("auth.recovery.withoutEmail")} <Link href="/recover-account" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("auth.recovery.forgotLink")}</Link></span></>}>
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
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid" | "throttled">(token ? "idle" : "invalid");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setState("busy");
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    // Trop d'essais (429) : le lien n'est pas consommé, il reste utilisable ; seul un refus du jeton l'invalide.
    setState(!error ? "done" : error.status === 429 ? "throttled" : "invalid");
  };
  return (
    <AuthShell title={t("auth.reset.title")} intro={t("auth.reset.intro")}
      footer={<Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("auth.forgot.back")}</Link>}>
      {state === "done" ? <Alert tone="success">{t("auth.reset.done")}</Alert> : (
        <form method="post" onSubmit={(event) => void submit(event)} className="grid gap-4">
          {state === "invalid" && <Alert tone="danger">{t("auth.reset.invalid")}</Alert>}
          {state === "throttled" && <Alert tone="warning">{t("auth.reset.throttled")}</Alert>}
          <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
            {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} value={password} onChange={setPassword} autoComplete="new-password" />}
          </Field>
          <Button type="submit" size="lg" block loading={state === "busy"} disabled={!token}>{t("auth.reset.submit")}</Button>
        </form>
      )}
    </AuthShell>
  );
}
