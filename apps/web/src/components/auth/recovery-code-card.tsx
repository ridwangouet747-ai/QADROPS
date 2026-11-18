"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { PasswordInput, RecoveryCodePanel } from "@/components/auth/auth-forms";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";

/**
 * Code de secours du compte connecté (docs/authentication.md § 12.1). Affiché seulement pour un compte sans
 * adresse e-mail : c'est son unique moyen de retrouver l'accès. Un nouveau code exige le mot de passe actuel et
 * remplace l'ancien ; il n'est montré qu'une fois.
 */
export function RecoveryCodeCard() {
  const { t } = useI18n();
  const [state, setState] = useState<{ present: boolean; hasEmail: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/recovery-code", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<{ present: boolean; hasEmail: boolean }> : null))
      .then((body) => { if (body) setState(body); }).catch(() => undefined);
  }, []);

  if (!state || state.hasEmail) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/recovery-code", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: password }) });
      const body = await response.json().catch(() => ({})) as { recoveryCode?: string; code?: string };
      if (response.ok && body.recoveryCode) { setCode(body.recoveryCode); setState({ ...state, present: true }); return; }
      setError(response.status === 403 ? t("auth.recovery.wrongPassword") : response.status === 429 ? t("auth.recovery.throttled") : t("errors.generic"));
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPassword(""); setBusy(false);
    }
  };

  return (
    <section className="mt-6 min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby="recovery-code-title">
      <h2 id="recovery-code-title" className="m-0 text-lg font-bold text-ink">{t("auth.recovery.cardTitle")}</h2>
      <p className="m-0 mt-1 text-sm text-fg-muted">{state.present ? t("auth.recovery.cardPresent") : t("auth.recovery.cardMissing")}</p>
      <div className="mt-4 max-w-md">
        {code ? <RecoveryCodePanel code={code} action={t("auth.recovery.cardDone")} onContinue={() => setCode(null)} /> : (
          <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t("auth.recovery.currentPassword")}>
              {(props) => <PasswordInput id={props.id} describedBy={props["aria-describedby"]} autoComplete="current-password" value={password} onChange={setPassword} />}
            </Field>
            <Button type="submit" loading={busy} disabled={password.length === 0}>{t("auth.recovery.cardSubmit")}</Button>
          </form>
        )}
      </div>
    </section>
  );
}
