"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, FormDialog } from "@/components/ui/controls";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle } from "@/components/ui/layout";
import { intlLocale } from "@/lib/i18n/config";

/*
 * Codes d'invitation des employés (2026-11-16, docs/team-invite-codes.md). Le rôle proposé vient de la liste
 * `delegableRoles` rendue par le serveur ; le serveur refuse de toute façon un rôle que l'acteur ne peut pas
 * attribuer. Le code en clair n'apparaît qu'une fois, dans la réponse de création.
 */

type Role = "admin" | "cashier" | "stock_manager" | "accountant" | "member";
type State = "pending" | "used" | "expired" | "revoked";
type InviteCode = {
  id: string; hint: string; role: Role; displayName: string | null; createdAt: string; expiresAt: string; consumedAt: string | null;
  createdBy: string; consumedBy: string | null; state: State; canRevoke: boolean;
};
type Created = { code: string; expiresAt: string };
const errorKeys = new Set(["role_not_delegable", "business_closed", "plan_limit"]);
const stateTone: Record<State, "brand" | "success" | "neutral" | "danger"> = { pending: "brand", used: "success", expired: "neutral", revoked: "danger" };

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { code?: string };
  if (!response.ok) throw Object.assign(new Error("request"), { status: response.status, code: payload.code });
  return payload;
}

export function TeamInviteCodes({ onChanged }: { onChanged?: () => void }) {
  const { t, locale } = useI18n();
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ role: "cashier" as Role, displayName: "", expiresInDays: "7" });
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<InviteCode | null>(null);
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });

  const describe = useCallback((caught: unknown) => {
    const code = (caught as { code?: string; status?: number }).code;
    const status = (caught as { status?: number }).status;
    if (code && errorKeys.has(code)) return t(`access.team.errors.${code as "role_not_delegable" | "business_closed" | "plan_limit"}`);
    if (status === 403) return t("access.team.errors.forbidden");
    return t("access.team.errors.unavailable");
  }, [t]);

  const load = useCallback(async () => {
    try {
      const body = await call("/api/business/team/codes", "GET") as { codes: InviteCode[]; delegableRoles: Role[] };
      setCodes(body.codes); setRoles(body.delegableRoles);
    } catch (caught) {
      // Rôle sans gestion d'équipe : la section n'apparaît pas.
      if ((caught as { status?: number }).status === 403) setHidden(true); else setError(describe(caught));
    }
  }, [describe]);
  useEffect(() => { void load(); }, [load]);

  const open = () => {
    setForm({ role: roles.includes("cashier") ? "cashier" : roles[0] ?? "member", displayName: "", expiresInDays: "7" });
    setCreated(null); setCopied(false); setError(""); setCreating(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const days = Math.min(30, Math.max(1, Number.parseInt(form.expiresInDays, 10) || 7));
      const result = await call("/api/business/team/codes", "POST", { role: form.role, displayName: form.displayName.trim() || undefined, expiresInDays: days }) as Created;
      setCreated({ code: result.code, expiresAt: result.expiresAt });
      await load(); onChanged?.();
    } catch (caught) { setError(describe(caught)); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!created) return;
    await navigator.clipboard?.writeText(created.code).catch(() => undefined);
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };
  const revoke = async () => {
    const row = revoking;
    if (!row) return;
    setBusy(true); setError(""); setNotice("");
    try { await call(`/api/business/team/codes/${encodeURIComponent(row.id)}/revoke`, "POST"); setNotice(t("access.team.revoked")); setRevoking(null); await load(); }
    catch (caught) { setError(describe(caught)); setRevoking(null); } finally { setBusy(false); }
  };

  if (hidden) return null;
  const joinUrl = typeof window === "undefined" ? "/join-business" : `${window.location.origin}/join-business`;
  return (
    <Card className="mt-4 grid grid-cols-1 gap-3" aria-labelledby="team-codes-title">
      <CardTitle id="team-codes-title" title={t("access.team.title")}
        aside={roles.length > 0 && <Button size="md" onClick={open} icon={<Icon name="plus" />}>{t("access.team.create")}</Button>} />
      <p className="m-0 text-sm text-fg-muted">{t("access.team.intro")}</p>
      <div className="grid gap-2 empty:hidden" aria-live="polite">
        {error && !creating && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      </div>
      {codes && codes.length === 0 && <p className="m-0 rounded-[14px] bg-paper p-4 text-sm text-fg-muted">{t("access.team.empty")}</p>}
      {codes && codes.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
          {codes.map((row) => (
            <li key={row.id} className="grid min-w-0 gap-2 rounded-[16px] border border-line p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <strong dir="ltr" className="font-mono text-sm text-ink">EQP-…-{row.hint}</strong>
                <Badge tone={stateTone[row.state]}>{t(`access.team.state.${row.state}`)}</Badge>
              </div>
              <p className="m-0 text-sm text-fg">
                {t(`roles.${row.role}`)}{row.displayName && <> · <span dir="auto">{row.displayName}</span></>}
              </p>
              <small className="text-xs text-fg-subtle">{t("access.team.createdBy", { name: `⁨${row.createdBy}⁩`, date: date(row.createdAt) })}</small>
              {row.state === "used" && row.consumedAt && <small className="text-xs text-fg-subtle">{t("access.team.usedBy", { name: `⁨${row.consumedBy ?? "—"}⁩`, date: date(row.consumedAt) })}</small>}
              {row.state === "pending" && <small className="text-xs text-fg-subtle">{t("access.team.expiresOn", { date: date(row.expiresAt) })}</small>}
              {row.canRevoke && <Button size="md" variant="secondary" className="justify-self-start" disabled={busy} onClick={() => setRevoking(row)}>{t("access.team.revoke")}</Button>}
            </li>
          ))}
        </ul>
      )}

      <FormDialog open={creating} onClose={() => !busy && setCreating(false)} labelledBy="team-code-title" title={created ? t("access.team.createdTitle") : t("access.team.create")}>
        {created ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-fg-muted">{t("access.team.createdBody", { date: date(created.expiresAt) })}</p>
            <p dir="ltr" className="m-0 rounded-[14px] bg-paper p-4 text-center font-mono text-lg font-bold tracking-[0.08em] break-all text-ink select-all">{created.code}</p>
            <Button block onClick={() => void copy()} icon={<Icon name={copied ? "check" : "clipboard"} />}>{copied ? t("access.team.copied") : t("access.team.copy")}</Button>
            <p className="m-0 text-xs text-fg-subtle">{t("access.team.shareHint", { url: `⁦${joinUrl}⁩` })}</p>
            <Button block variant="secondary" onClick={() => setCreating(false)}>{t("common.close")}</Button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="grid gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t("access.team.role")} hint={t(`roles.descriptions.${form.role}`)}>
              {(props) => <Select {...props} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>{roles.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}</Select>}
            </Field>
            <Field label={t("access.team.displayName")}>
              {(props) => <Input {...props} dir="auto" maxLength={80} autoComplete="off" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />}
            </Field>
            <Field label={t("access.team.expiresDays")}>
              {(props) => <Input {...props} type="number" inputMode="numeric" min={1} max={30} dir="ltr" value={form.expiresInDays} onChange={(event) => setForm({ ...form, expiresInDays: event.target.value })} />}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("access.team.submit")}</Button>
            </div>
          </form>
        )}
      </FormDialog>

      <ConfirmDialog open={revoking !== null} busy={busy} tone="danger" onClose={() => !busy && setRevoking(null)} confirmLabel={t("access.team.revoke")}
        title={revoking ? t("access.team.revokeTitle", { hint: revoking.hint }) : ""} onConfirm={() => void revoke()}>
        {t("access.team.revokeBody")}
      </ConfirmDialog>
    </Card>
  );
}
