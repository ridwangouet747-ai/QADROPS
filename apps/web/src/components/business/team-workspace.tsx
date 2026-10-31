"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, FormDialog } from "@/components/ui/controls";
import { Monogram } from "@/components/ui/data-display";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { errorMessageFor } from "@/lib/client/errors";
import { intlLocale, locales, type Locale } from "@/lib/i18n/config";
import { RequestError } from "./use-paged-list";

const roles = ["owner", "admin", "cashier", "stock_manager", "accountant", "member"] as const;
type Role = (typeof roles)[number];
const resources = ["sale", "payment", "product", "inventory", "customer", "supplier", "purchase", "expense", "report", "invitation", "business"] as const;
type Member = { memberId: string; userId: string; name: string; email: string; role: string; joinedAt: string; disabled: boolean; self: boolean };
type Invitation = { id: string; email: string; role: string | null; expiresAt: string; path: string };
type EmailStatus = "sent" | "failed" | "not_configured";
type Created = { path: string; email: string; emailStatus: EmailStatus };
type Team = { members: Member[]; invitations: Invitation[]; roles: { role: Role; permissions: Record<string, string[]> }[] };

async function send(url: string, method: string, body?: unknown) {
  let response: Response;
  try { response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }); } catch { throw new RequestError(null); }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new RequestError(response.status, payload.error);
  return payload;
}

export function TeamWorkspace() {
  const { t, locale } = useI18n();
  const [team, setTeam] = useState<Team | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: "", role: "cashier" as Role, emailLocale: "fr" as Locale });
  const [created, setCreated] = useState<Created | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [disabling, setDisabling] = useState<Member | null>(null);
  const [copied, setCopied] = useState("");

  const describe = useCallback((caught: unknown) => caught instanceof RequestError ? errorMessageFor({ status: caught.status, serverMessage: caught.message, locale, t }) : t("errors.generic"), [locale, t]);
  const load = useCallback(async () => {
    try { setTeam(await send("/api/business/team", "GET") as unknown as Team); }
    catch (caught) { if (caught instanceof RequestError && caught.status === 403) setForbidden(true); else setError(describe(caught)); }
  }, [describe]);
  useEffect(() => {
    void load();
    fetch("/api/account/capabilities").then((response) => response.json() as Promise<{ emailConfigured?: boolean }>).then((body) => setEmailConfigured(Boolean(body.emailConfigured))).catch(() => undefined);
  }, [load]);

  const self = team?.members.find((row) => row.self);
  const isOwner = self?.role === "owner";
  const date = (value: string) => new Date(value).toLocaleDateString(intlLocale[locale], { dateStyle: "medium" });
  const link = (path: string) => `${window.location.origin}${path}`;
  const copy = async (path: string) => { await navigator.clipboard?.writeText(link(path)).catch(() => undefined); setCopied(path); setTimeout(() => setCopied(""), 2500); };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await load(); } catch (caught) { setError(describe(caught)); } finally { setBusy(false); }
  };
  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const email = invite.email.trim();
      const result = await send("/api/business/team/invitations", "POST", { email, role: invite.role, emailLocale: invite.emailLocale }) as { invitation: { path: string; emailStatus?: EmailStatus } };
      setCreated({ path: result.invitation.path, email, emailStatus: result.invitation.emailStatus ?? "not_configured" }); setNotice(t("team.invited")); await load();
    } catch (caught) { setError(describe(caught)); } finally { setBusy(false); }
  };

  if (forbidden) return <><PageHeader title={t("team.title")}>{t("team.intro")}</PageHeader><EmptyState icon="users" title={t("team.forbidden")} /></>;
  return (
    <div>
      <PageHeader title={t("team.title")} actions={<Button onClick={() => { setInvite({ email: "", role: "cashier", emailLocale: "fr" }); setCreated(null); setInviting(true); }} icon={<Icon name="plus" />}>{t("team.invite")}</Button>}>{t("team.intro")}</PageHeader>
      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {error && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error}</Alert>}
        {notice && !inviting && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="grid grid-cols-1 gap-3" aria-labelledby="team-members-title">
          <CardTitle id="team-members-title" title={t("team.members")} aside={<Badge>{team ? team.members.length : "—"}</Badge>} />
          {!team ? [0, 1, 2].map((index) => <Skeleton key={index} className="h-20 rounded-[16px]" />) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {team.members.map((row) => {
                const locked = row.self || (row.role === "owner" && !isOwner);
                return (
                  <li key={row.memberId} className={cn("grid gap-3 rounded-[16px] border p-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-center", row.disabled ? "border-danger-line bg-danger-soft/40" : "border-line")}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Monogram text={row.name} />
                      <div className="min-w-0">
                        <strong dir="auto" className="block truncate text-sm text-ink">{row.name}</strong>
                        <small dir="ltr" className="block truncate text-start text-xs text-fg-subtle rtl:text-end">{row.email}</small>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.self && <Badge tone="brand">{t("team.you")}</Badge>}
                          <Badge tone={row.disabled ? "danger" : "success"}>{row.disabled ? t("team.disabled") : t("team.active")}</Badge>
                        </div>
                      </div>
                    </div>
                    <Select aria-label={t("team.roleLabel", { name: row.name })} value={row.role} disabled={locked || busy}
                      onChange={(event) => void run(() => send(`/api/business/team/members/${encodeURIComponent(row.memberId)}`, "PATCH", { role: event.target.value }), t("team.roleChanged", { name: row.name }))}>
                      {roles.filter((role) => role !== "owner" || isOwner || row.role === "owner").map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
                    </Select>
                    {!locked && (row.disabled
                      ? <Button variant="secondary" disabled={busy} onClick={() => void run(() => send(`/api/business/team/members/${encodeURIComponent(row.memberId)}/access`, "POST", { disabled: false }), t("team.accessEnabled", { name: row.name }))}>{t("team.enable")}</Button>
                      : <Button variant="danger" disabled={busy} onClick={() => setDisabling(row)}>{t("team.disable")}</Button>)}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card tone="night" className="grid grid-cols-1 gap-3" aria-labelledby="team-invitations-title">
          <CardTitle inverse id="team-invitations-title" title={t("team.pending")} aside={<Badge tone="night">{team ? team.invitations.length : "—"}</Badge>} />
          {team && team.invitations.length === 0 && <p className="m-0 rounded-[14px] bg-night-soft p-4 text-sm text-night-fg">{t("team.noPending")}</p>}
          <ul className="m-0 grid list-none gap-2 p-0">
            {team?.invitations.map((row) => (
              <li key={row.id} className="grid gap-2 rounded-[16px] bg-night-soft/70 p-3">
                <div className="min-w-0">
                  <strong dir="ltr" className="block truncate text-start text-sm text-white rtl:text-end">{row.email}</strong>
                  <small className="text-xs text-night-fg">{t(`roles.${(row.role ?? "member") as Role}`)} · {t("team.expiresOn", { date: date(row.expiresAt) })}</small>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copy(row.path)} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-white px-3.5 text-sm font-semibold text-brand-strong">
                    <Icon name={copied === row.path ? "check" : "clipboard"} className="size-4" />{copied === row.path ? t("team.copied") : t("team.copyLink")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void run(() => send(`/api/business/team/invitations/${encodeURIComponent(row.id)}`, "DELETE"), t("team.canceled"))}
                    className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-night-line bg-transparent px-3.5 text-sm font-semibold text-white hover:bg-night-soft">{t("team.cancel")}</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {team && (
        <Card className="mt-4" aria-labelledby="team-permissions-title">
          <CardTitle id="team-permissions-title" title={t("team.permissions")} />
          <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2 xl:grid-cols-3">
            {team.roles.map(({ role, permissions }) => (
              <li key={role} className="rounded-[16px] border border-line p-3">
                <strong className="block text-sm text-ink">{t(`roles.${role}`)}</strong>
                <p className="m-0 mt-0.5 mb-2 text-xs text-fg-subtle">{t(`roles.descriptions.${role}`)}</p>
                <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0 text-xs">
                  {resources.map((resource) => {
                    const actions = permissions[resource] ?? [];
                    const level = actions.length === 0 ? "none" : actions.length === 1 && actions[0] === "read" ? "readOnly" : "full";
                    return (
                      <li key={resource} className="flex items-center gap-1.5">
                        <Icon name={level === "none" ? "close" : level === "readOnly" ? "search" : "check"} className={cn("size-3.5", level === "none" ? "text-fg-subtle" : level === "readOnly" ? "text-info" : "text-ok")} />
                        <span className="truncate text-fg">{t(`roles.resources.${resource}`)}</span>
                        <span className="sr-only">{t(`roles.${level}`)}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <FormDialog open={inviting} onClose={() => !busy && setInviting(false)} labelledBy="invite-title" title={t("team.inviteTitle")}>
        {created ? (
          <div className="grid gap-4">
            <Alert tone="success">{t("team.invited")}</Alert>
            {created.emailStatus === "sent" && <Alert tone="info">{t("team.emailSent", { email: created.email })}</Alert>}
            {created.emailStatus === "failed" && <Alert tone="warning">{t("team.emailFailed")}</Alert>}
            {created.emailStatus === "not_configured" && <p className="m-0 text-sm text-fg-muted">{t("team.shareNoEmail")}</p>}
            <p dir="ltr" className="m-0 rounded-[14px] bg-paper p-3 font-mono text-xs break-all text-fg">{link(created.path)}</p>
            <Button block variant={created.emailStatus === "sent" ? "secondary" : "primary"} onClick={() => void copy(created.path)} icon={<Icon name={copied === created.path ? "check" : "clipboard"} />}>{copied === created.path ? t("team.copied") : t("team.copyLink")}</Button>
          </div>
        ) : (
          <form onSubmit={(event) => void submitInvite(event)} className="grid gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t("team.inviteEmail")}>{(props) => <Input {...props} type="email" dir="ltr" required autoFocus autoComplete="off" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} />}</Field>
            <Field label={t("team.inviteRole")} hint={t(`roles.descriptions.${invite.role}`)}>
              {(props) => <Select {...props} value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })}>{roles.filter((role) => role !== "owner" || isOwner).map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}</Select>}
            </Field>
            {emailConfigured && (
              <Field label={t("team.emailLanguage")} hint={t("team.emailLanguageHint")}>
                {(props) => <Select {...props} value={invite.emailLocale} onChange={(event) => setInvite({ ...invite, emailLocale: event.target.value as Locale })}>{locales.map((code) => <option key={code} value={code} lang={code}>{t(`language.${code}`)}</option>)}</Select>}
              </Field>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setInviting(false)} disabled={busy}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("team.inviteSubmit")}</Button>
            </div>
          </form>
        )}
      </FormDialog>

      <ConfirmDialog open={disabling !== null} busy={busy} tone="danger" onClose={() => !busy && setDisabling(null)} confirmLabel={t("team.disable")}
        title={disabling ? t("team.disableTitle", { name: disabling.name }) : ""}
        onConfirm={() => { const row = disabling; if (row) void run(() => send(`/api/business/team/members/${encodeURIComponent(row.memberId)}/access`, "POST", { disabled: true }), t("team.accessDisabled", { name: row.name })).then(() => setDisabling(null)); }}>
        {disabling ? t("team.disableBody", { name: disabling.name }) : ""}
      </ConfirmDialog>
    </div>
  );
}
