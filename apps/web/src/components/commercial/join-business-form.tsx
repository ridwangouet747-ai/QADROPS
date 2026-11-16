"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { TurnstileWidget, turnstileSiteKey } from "@/components/auth/turnstile-widget";
import { BusinessLogo } from "@/components/business/business-identity";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { turnstileHeader } from "@/lib/auth/turnstile";
import { intlLocale } from "@/lib/i18n/config";

/*
 * Page /join-business (2026-11-16, docs/team-invite-codes.md). L'employé saisit le code EQP-… remis par son
 * responsable, voit le commerce et le rôle, puis crée son propre accès : nom, nom d'utilisateur, mot de passe.
 * Aucune adresse e-mail. Le rôle vient du code côté serveur ; rien de ce formulaire ne peut le changer.
 */

type Role = "admin" | "cashier" | "stock_manager" | "accountant" | "member";
type Checked = { businessName: string; logo: string | null; role: Role; displayName: string | null; expiresAt: string };
type ErrorKey = "invalid" | "already_used" | "expired" | "revoked" | "commercial_code" | "business_closed" | "plan_limit" | "username_taken"
  | "validation" | "rate_limited" | "turnstile" | "network" | "unavailable";
const known = new Set<string>(["invalid", "already_used", "expired", "revoked", "commercial_code", "business_closed", "plan_limit", "username_taken", "rate_limited"]);

function asError(status: number, code: unknown): ErrorKey {
  if (code === "turnstile_failed") return "turnstile";
  if (typeof code === "string" && known.has(code)) return code as ErrorKey;
  if (status === 400 || status === 422) return "validation";
  return "unavailable";
}

/** Saisie tolérante : majuscules, espaces → tirets, rien d'autre que lettres, chiffres et tirets. */
const normalize = (value: string) => value.toUpperCase().replace(/[\s_]+/g, "-").replace(/[^A-Z0-9-]/g, "").replace(/-{2,}/g, "-").slice(0, 40);

export function JoinBusinessForm() {
  const { t, locale } = useI18n();
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", confirm: "" });
  const [joined, setJoined] = useState<{ username: string; signedIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | "mismatch" | null>(null);
  const [security, setSecurity] = useState<{ token: string | null; resetKey: number }>({ token: null, resetKey: 0 });
  const sending = useRef(false);
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "long" });
  const needsToken = Boolean(turnstileSiteKey) && !security.token;

  const post = async (path: string, body: unknown) => {
    if (sending.current) return null;
    sending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(path, {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json", ...(security.token ? { [turnstileHeader]: security.token } : {}) },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (response.ok && payload) return payload;
      setError(response.status >= 500 || !payload ? "unavailable" : asError(response.status, payload.code));
      return null;
    } catch { setError("network"); return null; } finally {
      sending.current = false; setBusy(false);
      // Un jeton Turnstile ne sert qu'une fois.
      setSecurity((current) => ({ token: null, resetKey: current.resetKey + 1 }));
    }
  };

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (needsToken) { setError("turnstile"); return; }
    const result = await post("/api/public/team-codes/check", { code: code.replace(/-+$/, "") });
    if (result) { setChecked(result as unknown as Checked); setForm((current) => ({ ...current, name: current.name || (result.displayName as string | null) || "" })); }
  };

  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) { setError("mismatch"); return; }
    if (needsToken) { setError("turnstile"); return; }
    const result = await post("/api/public/team-codes/accept", { code: code.replace(/-+$/, ""), name: form.name, username: form.username, password: form.password });
    if (result) setJoined({ username: String(result.username ?? form.username), signedIn: result.signedIn === true });
  };

  const restart = () => { setChecked(null); setJoined(null); setError(null); setCode(""); };
  const errorText = error === "mismatch" ? t("access.join.mismatch") : error ? t(`access.join.errors.${error}`) : "";
  const errorAlert = error && <Alert tone={error === "network" || error === "unavailable" || error === "rate_limited" ? "warning" : "danger"}>{errorText}</Alert>;
  const turnstile = <TurnstileWidget action="team-join" resetKey={security.resetKey} onToken={(token) => setSecurity((current) => ({ ...current, token }))} />;

  return (
    <AuthShell title={t("access.join.title")} intro={joined || checked ? undefined : t("access.join.intro")}
      footer={!joined && <span>{t("access.join.login")} <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-strong no-underline">{t("access.join.loginLink")}</Link></span>}>
      {joined && checked ? (
        <div className="grid gap-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-brand"><Icon name="check" className="size-6" /></span>
            <p className="m-0 text-lg font-bold text-ink">{t("access.join.joinedTitle")}</p>
          </div>
          <p className="m-0 text-sm text-fg-muted">{t("access.join.joinedBody", { business: `⁨${checked.businessName}⁩`, username: `⁦${joined.username}⁩` })}</p>
          <Link href={joined.signedIn ? "/business/dashboard" : "/login"} className={buttonClasses({ variant: "primary", size: "lg", block: true, className: "no-underline" })}>
            {joined.signedIn ? t("access.join.open") : t("access.join.signIn")}
          </Link>
        </div>
      ) : checked ? (
        <form method="post" noValidate onSubmit={(event) => void join(event)} className="grid gap-4">
          <div className="flex items-center gap-3 rounded-[16px] bg-paper p-3">
            <BusinessLogo name={checked.businessName} logo={checked.logo} className="size-12" />
            <div className="min-w-0">
              <p className="m-0 text-sm text-fg">{t("access.join.found", { business: `⁨${checked.businessName}⁩`, role: t(`roles.${checked.role}`) })}</p>
              <p className="m-0 text-xs text-fg-subtle">{t("access.join.expires", { date: date(checked.expiresAt) })}</p>
            </div>
          </div>
          {errorAlert}
          <Field label={t("access.join.name")}>
            {(props) => <Input {...props} autoFocus required dir="auto" maxLength={80} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
          </Field>
          <Field label={t("access.join.username")} hint={t("access.join.usernameHint")}>
            {(props) => <Input {...props} required dir="ltr" maxLength={30} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/[^a-z0-9._]/g, "") })} />}
          </Field>
          <Field label={t("access.join.password")} hint={t("access.join.passwordHint")}>
            {(props) => <Input {...props} required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />}
          </Field>
          <Field label={t("access.join.confirm")}>
            {(props) => <Input {...props} required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} />}
          </Field>
          {turnstile}
          <Button type="submit" size="lg" block loading={busy} disabled={needsToken || form.name.trim().length < 2 || form.username.length < 3 || form.password.length < 8}>
            {busy ? t("access.join.joining") : t("access.join.submit")}
          </Button>
          <Button variant="secondary" size="lg" block disabled={busy} onClick={restart}>{t("access.join.change")}</Button>
        </form>
      ) : (
        <form method="post" noValidate onSubmit={(event) => void check(event)} className="grid gap-4">
          {errorAlert}
          <Field label={t("access.join.label")} hint={t("access.join.hint")}>
            {(props) => <Input {...props} autoFocus value={code} onChange={(event) => { setCode(normalize(event.target.value)); if (error) setError(null); }}
              dir="ltr" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={40}
              placeholder="EQP-XXXX-XXXX-XXXX" className="text-center font-mono text-base tracking-[0.08em] sm:text-lg" aria-invalid={error ? true : undefined} />}
          </Field>
          {turnstile}
          <Button type="submit" size="lg" block loading={busy} disabled={code.length < 8 || needsToken} icon={<Icon name="users" />}>
            {busy ? t("access.join.checking") : t("access.join.check")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
