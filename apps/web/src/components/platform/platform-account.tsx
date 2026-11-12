"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { PfButton, PfCard, PfCardHeader, PfField, PfInput, PfNotice, PfRequestError, pfErrorMessage, pfRequest } from "./pf-ui";

type Notice = { tone: "alert" | "success"; text: string } | null;
const OWNER_MIN_PASSWORD_LENGTH = 12;
const usernamePattern = /^[a-z0-9][a-z0-9._]{2,29}$/;
const knownCodes = ["invalid_current_password", "same_password", "username_taken", "too_many_attempts", "validation", "preview_unavailable"] as const;

/**
 * Identifiants du propriétaire (2026-11-12) : il change lui-même son mot de passe et son nom d'utilisateur.
 * Le mot de passe actuel est exigé pour les deux. Rien n'est gardé après l'envoi : les champs sont vidés.
 * En aperçu local, le compte de démonstration n'a pas d'identifiants : les formulaires sont désactivés.
 */
export function PlatformAccount({ username, preview, defaultPassword, onUsernameChanged }: {
  username: string | null; preview: boolean; defaultPassword: boolean; onUsernameChanged: (username: string) => void;
}) {
  const { t, locale } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameNotice, setUsernameNotice] = useState<Notice>(null);
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [warned, setWarned] = useState(defaultPassword);

  const failure = (error: unknown): Notice => {
    const code = error instanceof PfRequestError ? knownCodes.find((known) => known === error.code) : undefined;
    return { tone: "alert", text: code ? t(`platform.settings.account.errors.${code}`) : pfErrorMessage(error, t, locale) };
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < OWNER_MIN_PASSWORD_LENGTH) return setPasswordNotice({ tone: "alert", text: t("platform.settings.account.errors.tooShort") });
    if (next !== confirm) return setPasswordNotice({ tone: "alert", text: t("platform.settings.account.errors.mismatch") });
    setPasswordBusy(true); setPasswordNotice(null);
    try {
      await pfRequest("/api/platform/account/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setPasswordNotice({ tone: "success", text: t("platform.settings.account.passwordSaved") });
      setWarned(false);
    } catch (error) {
      setPasswordNotice(failure(error));
    }
    setCurrent(""); setNext(""); setConfirm(""); setPasswordBusy(false);
  };

  const submitUsername = async (event: FormEvent) => {
    event.preventDefault();
    const wanted = newUsername.trim().toLowerCase();
    if (!usernamePattern.test(wanted)) return setUsernameNotice({ tone: "alert", text: t("platform.settings.account.errors.invalidUsername") });
    setUsernameBusy(true); setUsernameNotice(null);
    try {
      const result = await pfRequest<{ username: string }>("/api/platform/account/username", { method: "POST", body: { currentPassword: usernamePassword, username: wanted } });
      setUsernameNotice({ tone: "success", text: t("platform.settings.account.usernameSaved") });
      onUsernameChanged(result.username);
      setNewUsername("");
    } catch (error) {
      setUsernameNotice(failure(error));
    }
    setUsernamePassword(""); setUsernameBusy(false);
  };

  return (
    <PfCard id="compte">
      <PfCardHeader title={t("platform.settings.account.title")} caption={t("platform.settings.account.caption")} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {preview && <PfNotice>{t("platform.settings.account.preview")}</PfNotice>}
        {warned && !preview && <PfNotice tone="alert">{t("platform.settings.account.defaultPassword")}</PfNotice>}

        <form method="post" onSubmit={(event) => void submitPassword(event)} className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {passwordNotice && <PfNotice tone={passwordNotice.tone}>{passwordNotice.text}</PfNotice>}
          <PfField label={t("platform.settings.account.currentPassword")}>
            {(props) => <PfInput {...props} type="password" dir="ltr" required maxLength={128} autoComplete="current-password" disabled={preview}
              value={current} onChange={(event) => setCurrent(event.target.value)} />}
          </PfField>
          <PfField label={t("platform.settings.account.newPassword")} hint={t("platform.settings.account.passwordHint")}>
            {(props) => <PfInput {...props} type="password" dir="ltr" required minLength={OWNER_MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" disabled={preview}
              value={next} onChange={(event) => setNext(event.target.value)} />}
          </PfField>
          <PfField label={t("platform.settings.account.confirmPassword")}>
            {(props) => <PfInput {...props} type="password" dir="ltr" required minLength={OWNER_MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" disabled={preview}
              value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
          </PfField>
          <PfButton type="submit" loading={passwordBusy} disabled={preview} className="justify-self-start">{t("platform.settings.account.savePassword")}</PfButton>
        </form>

        <form method="post" onSubmit={(event) => void submitUsername(event)} className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-pf-line pt-6">
          <div>
            <h3 className="m-0 text-[0.92rem] font-semibold text-pf-ink">{t("platform.settings.account.username")}</h3>
            {username && <p className="m-0 mt-1 text-[0.8rem] text-pf-muted">{t("platform.settings.account.currentUsername", { username })}</p>}
          </div>
          {usernameNotice && <PfNotice tone={usernameNotice.tone}>{usernameNotice.text}</PfNotice>}
          <PfField label={t("platform.settings.account.newUsername")} hint={t("platform.settings.account.usernameHint")}>
            {(props) => <PfInput {...props} dir="ltr" required minLength={3} maxLength={30} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={preview}
              value={newUsername} onChange={(event) => setNewUsername(event.target.value)} />}
          </PfField>
          <PfField label={t("platform.settings.account.currentPassword")}>
            {(props) => <PfInput {...props} type="password" dir="ltr" required maxLength={128} autoComplete="current-password" disabled={preview}
              value={usernamePassword} onChange={(event) => setUsernamePassword(event.target.value)} />}
          </PfField>
          <PfButton type="submit" variant="light" loading={usernameBusy} disabled={preview} className="justify-self-start">{t("platform.settings.account.saveUsername")}</PfButton>
        </form>
      </div>
    </PfCard>
  );
}
