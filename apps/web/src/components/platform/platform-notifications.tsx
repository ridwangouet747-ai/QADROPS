"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { intlLocale } from "@/lib/i18n/config";
import { icons, locales, pushGenericBody, pushSafeVariables, renderText, segmentActivities, segmentLifecycles, validateTemplateText, variables, type Variable } from "@/lib/notifications/catalog";
import { currentPushEndpoint, deviceLabel, enablePushOnThisDevice } from "@/lib/notifications/client";
import { PfPageHeader } from "./platform-shell";
import { PfBadge, PfButton, PfCard, PfCardHeader, PfDialog, PfEmpty, PfField, PfInput, PfNotice, PfSegmented, PfSelect, PfSkeleton, PfStat, PfTextarea, pfErrorMessage, pfRequest } from "./pf-ui";

type Template = {
  id: string | null; key: string; kind: "event" | "announcement"; category: string; icon: string; linkPath: string | null; active: boolean; builtIn: boolean; customized: boolean; version: number;
  titleFr: string; titleEn: string; titleAr: string; bodyFr: string; bodyEn: string; bodyAr: string;
};
type Activity = {
  outbox: { status: string; count: number }[]; deliveries: { status: string; count: number }[]; errors: { error: string | null; count: number }[];
  history: { id: string; eventType: string; businessName: string | null; status: string; recipientCount: number; createdAt: string }[];
  campaigns: { id: string; status: "running" | "paused" | "done" | "canceled"; templateKey: string; recipients: number; createdAt: string; segment: unknown }[];
};
type Tab = "templates" | "campaigns" | "activity";
type Draft = Omit<Template, "id" | "builtIn" | "customized" | "version">;
const suffix = { fr: "Fr", en: "En", ar: "Ar" } as const;
const emptyAnnouncement: Draft = { key: "annonce-", kind: "announcement", category: "announcement", icon: "info", linkPath: "/business/dashboard", active: true,
  titleFr: "", titleEn: "", titleAr: "", bodyFr: "", bodyEn: "", bodyAr: "" };

export function PlatformNotifications() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("templates");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "alert" | "info"; text: string } | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [devicePush, setDevicePush] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, stats] = await Promise.all([pfRequest<Template[]>("/api/platform/notifications/templates"), pfRequest<Activity>("/api/platform/notifications/activity")]);
      setTemplates(list); setActivity(stats);
    } catch (caught) { setNotice({ tone: "alert", text: pfErrorMessage(caught, t, locale) }); }
  }, [t, locale]);
  useEffect(() => { void load(); void currentPushEndpoint().then((endpoint) => setDevicePush(Boolean(endpoint))).catch(() => undefined); }, [load]);

  const run = async (task: () => Promise<string>) => {
    setBusy(true); setNotice(null);
    try { setNotice({ tone: "success", text: await task() }); void load(); } catch (caught) { setNotice({ tone: "alert", text: pfErrorMessage(caught, t, locale) }); } finally { setBusy(false); }
  };
  const processNow = () => run(async () => {
    const result = await pfRequest<{ processed: number; pushSent: number }>("/api/platform/notifications/activity", { method: "POST" });
    return t("pfNotifications.processed", { count: result.processed, sent: result.pushSent });
  });
  const test = (key: string) => run(async () => {
    const result = await pfRequest<{ pushSent: number; notifications: number }>("/api/platform/notifications/templates/test", { method: "POST", body: { key } });
    return t("pfNotifications.templates.testSent", { sent: result.pushSent, notifications: result.notifications });
  });
  const enableDevice = async () => {
    const outcome = await enablePushOnThisDevice(deviceLabel(), "platform");
    if (outcome.ok) { setDevicePush(true); setNotice({ tone: "success", text: t("pfNotifications.pushReady") }); }
    else setNotice({ tone: "alert", text: t(`notifications.settings.states.${outcome.reason}`) });
  };

  return (
    <div>
      <PfPageHeader title={t("pfNotifications.title")} description={t("pfNotifications.intro")}>
        {devicePush ? <PfBadge tone="solid">{t("pfNotifications.pushReady")}</PfBadge> : <PfButton variant="light" icon="bell" onClick={() => void enableDevice()}>{t("pfNotifications.pushThisDevice")}</PfButton>}
        <PfButton icon="activity" loading={busy} onClick={() => void processNow()}>{t("pfNotifications.processNow")}</PfButton>
      </PfPageHeader>
      {notice && <div className="mb-4"><PfNotice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</PfNotice></div>}
      <div className="mb-4"><PfSegmented label={t("pfNotifications.title")} value={tab} onChange={setTab}
        options={(["templates", "campaigns", "activity"] as const).map((value) => ({ value, label: t(`pfNotifications.tabs.${value}`) }))} /></div>
      {tab === "templates" && <Templates templates={templates} busy={busy} onEdit={setEditing} onTest={(key) => void test(key)} />}
      {tab === "campaigns" && <Campaigns templates={templates} activity={activity} onDone={(text) => { setNotice({ tone: "success", text }); void load(); }} onError={(text) => setNotice({ tone: "alert", text })} />}
      {tab === "activity" && <ActivityView activity={activity} />}
      {editing && <Editor draft={editing} creating={!templates?.some((template) => template.key === editing.key)} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setNotice({ tone: "success", text: t("pfNotifications.editor.saved") }); void load(); }} />}
    </div>
  );
}

function Templates({ templates, busy, onEdit, onTest }: { templates: Template[] | null; busy: boolean; onEdit: (draft: Draft) => void; onTest: (key: string) => void }) {
  const { t } = useI18n();
  if (!templates) return <PfSkeleton className="h-64" />;
  return (
    <PfCard>
      <PfCardHeader title={t("pfNotifications.tabs.templates")} action={<PfButton size="sm" variant="light" icon="plus" onClick={() => onEdit(emptyAnnouncement)}>{t("pfNotifications.templates.create")}</PfButton>} />
      <ul className="m-0 mt-4 grid list-none gap-2 p-0">
        {templates.map((template) => (
          <li key={template.key} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-pf-line bg-pf-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 font-semibold text-pf-ink" dir="auto">{template.titleFr}</p>
              <p className="m-0 text-[0.78rem] text-pf-muted"><code>{template.key}</code> · {t(`pfNotifications.templates.kinds.${template.kind}`)} · {t(`notifications.categories.${template.category as "system"}`)}</p>
            </div>
            <PfBadge tone={template.active ? "solid" : "outline"}>{template.active ? t("pfNotifications.templates.active") : t("pfNotifications.templates.inactive")}</PfBadge>
            <PfBadge tone="muted" dot={false}>{template.customized ? t("pfNotifications.templates.customized") : t("pfNotifications.templates.builtIn")}</PfBadge>
            <PfButton size="sm" variant="light" icon="edit" onClick={() => onEdit({ key: template.key, kind: template.kind, category: template.category, icon: template.icon, linkPath: template.linkPath, active: template.active,
              titleFr: template.titleFr, titleEn: template.titleEn, titleAr: template.titleAr, bodyFr: template.bodyFr, bodyEn: template.bodyEn, bodyAr: template.bodyAr })}>{t("pfNotifications.templates.edit")}</PfButton>
            <PfButton size="sm" icon="bell" disabled={busy} onClick={() => onTest(template.key)}>{t("pfNotifications.templates.test")}</PfButton>
          </li>
        ))}
      </ul>
    </PfCard>
  );
}

function Editor({ draft, creating, onClose, onSaved }: { draft: Draft; creating: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<Draft>(draft);
  const [lang, setLang] = useState<(typeof locales)[number]>("fr");
  const [focus, setFocus] = useState<"title" | "body">("body");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const titleKey = `title${suffix[lang]}` as const;
  const bodyKey = `body${suffix[lang]}` as const;
  const sample = Object.fromEntries(variables.map((name) => [name, t(`pfNotifications.editor.sample.${name}`)])) as Record<Variable, string>;
  const problems = validateTemplateText(form);
  const insert = (name: Variable) => {
    if (focus === "title" && !pushSafeVariables.has(name)) return;
    const field = focus === "title" ? titleKey : bodyKey;
    setForm({ ...form, [field]: `${form[field]}{{${name}}}` });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try { await pfRequest("/api/platform/notifications/templates", { method: "POST", body: form }); onSaved(); }
    catch (caught) { setError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  return (
    <PfDialog open wide onClose={onClose} title={creating ? t("pfNotifications.editor.titleNew") : t("pfNotifications.editor.titleEdit", { key: draft.key })}>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        {error && <PfNotice tone="alert">{error}</PfNotice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <PfField label={t("pfNotifications.editor.key")} hint={t("pfNotifications.editor.keyHint")}>{(props) => <PfInput {...props} dir="ltr" value={form.key} disabled={!creating} onChange={(event) => setForm({ ...form, key: event.target.value.toLowerCase() })} />}</PfField>
          <PfField label={t("pfNotifications.editor.icon")}>{(props) => <PfSelect {...props} value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>{icons.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</PfSelect>}</PfField>
          <PfField label={t("pfNotifications.editor.link")} hint={t("pfNotifications.editor.linkHint")}>{(props) => <PfInput {...props} dir="ltr" value={form.linkPath ?? ""} onChange={(event) => setForm({ ...form, linkPath: event.target.value || null })} />}</PfField>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-pf-ink"><input type="checkbox" className="size-5" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />{t("pfNotifications.editor.active")}</label>
        <PfSegmented label={t("pfNotifications.editor.title")} value={lang} onChange={setLang} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }, { value: "ar", label: "العربية" }]} />
        <PfField label={t("pfNotifications.editor.title")}>{(props) => <PfInput {...props} dir={lang === "ar" ? "rtl" : "ltr"} maxLength={120} value={form[titleKey]} onFocus={() => setFocus("title")} onChange={(event) => setForm({ ...form, [titleKey]: event.target.value })} />}</PfField>
        <PfField label={t("pfNotifications.editor.body")}>{(props) => <PfTextarea {...props} dir={lang === "ar" ? "rtl" : "ltr"} maxLength={500} value={form[bodyKey]} onFocus={() => setFocus("body")} onChange={(event) => setForm({ ...form, [bodyKey]: event.target.value })} />}</PfField>
        <div>
          <p className="m-0 text-[0.82rem] font-semibold text-pf-ink">{t("pfNotifications.editor.variables")}</p>
          <p className="m-0 mb-2 text-[0.76rem] text-pf-muted">{t("pfNotifications.editor.variablesHint")}</p>
          <div className="flex flex-wrap gap-1.5">{variables.map((name) => (
            <button key={name} type="button" onClick={() => insert(name)} disabled={focus === "title" && !pushSafeVariables.has(name)}
              className="cursor-pointer rounded-full border border-pf-line bg-pf-card px-3 py-1 text-[0.76rem] font-semibold text-pf-ink disabled:cursor-not-allowed disabled:opacity-40">{t(`pfNotifications.variables.${name}`)}</button>
          ))}</div>
        </div>
        {problems.length > 0 && <PfNotice tone="alert">{problems.join(" · ")}</PfNotice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[18px] bg-pf-panel p-4 text-white" dir={lang === "ar" ? "rtl" : "ltr"}>
            <p className="m-0 text-[0.72rem] font-semibold text-white/60">{t("pfNotifications.editor.previewPush")}</p>
            <p className="m-0 mt-2 font-semibold">{renderText(form[titleKey], sample) || "—"}</p>
            <p className="m-0 text-sm text-white/75">{pushGenericBody[lang]}</p>
          </div>
          <div className="rounded-[18px] border border-pf-line bg-pf-card p-4" dir={lang === "ar" ? "rtl" : "ltr"}>
            <p className="m-0 text-[0.72rem] font-semibold text-pf-muted">{t("pfNotifications.editor.previewApp")}</p>
            <p className="m-0 mt-2 font-semibold text-pf-ink">{renderText(form[titleKey], sample) || "—"}</p>
            <p className="m-0 text-sm text-pf-muted">{renderText(form[bodyKey], sample) || "—"}</p>
          </div>
        </div>
        <PfButton type="submit" loading={busy} disabled={problems.length > 0}>{t("pfNotifications.editor.save")}</PfButton>
      </form>
    </PfDialog>
  );
}

function Campaigns({ templates, activity, onDone, onError }: { templates: Template[] | null; activity: Activity | null; onDone: (text: string) => void; onError: (text: string) => void }) {
  const { t, locale } = useI18n();
  const announcements = (templates ?? []).filter((template) => template.kind === "announcement" && template.id && template.active);
  const [templateId, setTemplateId] = useState("");
  const [activity_, setActivity] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "all">("owner");
  const [busy, setBusy] = useState(false);
  const chosen = templateId || announcements[0]?.id || "";
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await pfRequest("/api/platform/notifications/campaigns", { method: "POST", body: { templateId: chosen, segment: {
        ...(activity_ ? { activities: [activity_] } : {}), ...(lifecycle ? { subscriptionStatuses: [lifecycle] } : {}), roles: [role] } } });
      onDone(t("pfNotifications.campaigns.sent"));
    } catch (caught) { onError(pfErrorMessage(caught, t, locale)); } finally { setBusy(false); }
  };
  const act = async (id: string, action: "pause" | "resume" | "cancel") => {
    try { await pfRequest(`/api/platform/notifications/campaigns/${encodeURIComponent(id)}`, { method: "POST", body: { action } }); onDone(t(`pfNotifications.campaigns.${action}`)); }
    catch (caught) { onError(pfErrorMessage(caught, t, locale)); }
  };
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] [&>*]:min-w-0">
      <PfCard>
        <PfCardHeader title={t("pfNotifications.campaigns.create")} />
        {announcements.length === 0 ? <div className="mt-4"><PfEmpty title={t("pfNotifications.campaigns.noTemplate")} /></div> : (
          <form className="mt-4 grid gap-3" onSubmit={send}>
            <PfField label={t("pfNotifications.campaigns.template")}>{(props) => <PfSelect {...props} value={chosen} onChange={(event) => setTemplateId(event.target.value)}>{announcements.map((template) => <option key={template.id!} value={template.id!}>{template.titleFr}</option>)}</PfSelect>}</PfField>
            <p className="m-0 text-[0.82rem] font-semibold text-pf-ink">{t("pfNotifications.campaigns.segment")}</p>
            <PfField label={t("pfNotifications.campaigns.activities")}>{(props) => <PfSelect {...props} value={activity_} onChange={(event) => setActivity(event.target.value)}>
              <option value="">{t("pfNotifications.campaigns.allActivities")}</option>{segmentActivities.map((value) => <option key={value} value={value}>{t(`pfNotifications.campaigns.activityLabels.${value}`)}</option>)}</PfSelect>}</PfField>
            <PfField label={t("pfNotifications.campaigns.lifecycles")}>{(props) => <PfSelect {...props} value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}>
              <option value="">{t("pfNotifications.campaigns.anyLifecycle")}</option>{segmentLifecycles.map((value) => <option key={value} value={value}>{t(`pfNotifications.campaigns.lifecycleLabels.${value}`)}</option>)}</PfSelect>}</PfField>
            <PfField label={t("pfNotifications.campaigns.roles")}>{(props) => <PfSelect {...props} value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
              <option value="owner">{t("pfNotifications.campaigns.roleOwners")}</option><option value="admin">{t("pfNotifications.campaigns.roleAdmins")}</option><option value="all">{t("pfNotifications.campaigns.roleAll")}</option></PfSelect>}</PfField>
            <PfButton type="submit" icon="bell" loading={busy}>{t("pfNotifications.campaigns.send")}</PfButton>
          </form>
        )}
      </PfCard>
      <PfCard>
        <PfCardHeader title={t("pfNotifications.tabs.campaigns")} />
        {!activity ? <PfSkeleton className="mt-4 h-40" /> : activity.campaigns.length === 0 ? <div className="mt-4"><PfEmpty title={t("pfNotifications.campaigns.empty")} /></div> : (
          <ul className="m-0 mt-4 grid list-none gap-2 p-0">{activity.campaigns.map((campaign) => (
            <li key={campaign.id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-pf-line bg-pf-card px-4 py-3">
              <div className="min-w-0 flex-1"><p className="m-0 font-semibold text-pf-ink"><code>{campaign.templateKey}</code></p>
                <p className="m-0 text-[0.78rem] text-pf-muted">{new Date(campaign.createdAt).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" })} · {t("pfNotifications.campaigns.recipients", { count: campaign.recipients })}</p></div>
              <PfBadge tone={campaign.status === "running" ? "solid" : campaign.status === "canceled" ? "alert" : "muted"}>{t(`pfNotifications.campaigns.statuses.${campaign.status}`)}</PfBadge>
              {campaign.status === "running" && campaign.recipients === 0 && <PfButton size="sm" variant="light" onClick={() => void act(campaign.id, "pause")}>{t("pfNotifications.campaigns.pause")}</PfButton>}
              {campaign.status === "paused" && <PfButton size="sm" variant="light" onClick={() => void act(campaign.id, "resume")}>{t("pfNotifications.campaigns.resume")}</PfButton>}
              {(campaign.status === "paused" || (campaign.status === "running" && campaign.recipients === 0)) && <PfButton size="sm" variant="light" onClick={() => void act(campaign.id, "cancel")}>{t("pfNotifications.campaigns.cancel")}</PfButton>}
            </li>
          ))}</ul>
        )}
      </PfCard>
    </div>
  );
}

function ActivityView({ activity }: { activity: Activity | null }) {
  const { t, locale } = useI18n();
  if (!activity) return <PfSkeleton className="h-64" />;
  const label = (status: string) => t(`pfNotifications.activity.statuses.${status as "done"}`);
  const total = (rows: { count: number }[]) => rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PfStat label={t("pfNotifications.activity.events")} value={total(activity.outbox)} hint={activity.outbox.map((row) => `${label(row.status)} ${row.count}`).join(" · ")} icon="activity" />
        <PfStat label={t("pfNotifications.activity.deliveries")} value={total(activity.deliveries)} hint={activity.deliveries.map((row) => `${label(row.status)} ${row.count}`).join(" · ")} icon="bell" />
        <PfStat label={t("pfNotifications.activity.errors")} value={total(activity.errors)} hint={activity.errors.length ? activity.errors.map((row) => `${row.error ?? "?"} ×${row.count}`).join(" · ") : t("pfNotifications.activity.noErrors")} icon="warning" />
      </div>
      <PfCard>
        <PfCardHeader title={t("pfNotifications.activity.history")} />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[0.84rem]">
            <thead><tr className="text-[0.74rem] text-pf-muted">{(["event", "business", "status", "recipients", "date"] as const).map((key) => <th key={key} scope="col" className="py-2 text-start font-semibold">{t(`pfNotifications.activity.columns.${key}`)}</th>)}</tr></thead>
            <tbody>{activity.history.map((row) => (
              <tr key={row.id} className="border-t border-pf-line">
                <td className="py-2.5"><code>{row.eventType}</code></td><td className="py-2.5" dir="auto">{row.businessName ?? "—"}</td>
                <td className="py-2.5"><PfBadge tone={row.status === "failed" ? "alert" : row.status === "done" ? "solid" : "muted"}>{label(row.status)}</PfBadge></td>
                <td className="numeric py-2.5">{row.recipientCount}</td><td className="py-2.5 text-pf-muted">{new Date(row.createdAt).toLocaleString(intlLocale[locale], { dateStyle: "short", timeStyle: "short" })}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </PfCard>
    </div>
  );
}
