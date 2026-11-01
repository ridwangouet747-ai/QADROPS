"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Segmented } from "@/components/ui/controls";
import { Alert, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { formatDateTime } from "@/lib/i18n/format";
import { track } from "@/lib/analytics/client";
import { currentPushEndpoint, deviceLabel, enablePushOnThisDevice, pushSupport, removeDevice, type PushSupport } from "@/lib/notifications/client";
import { notificationIcon, type NotificationItem } from "./notification-bell";

const categories = ["commercial", "security", "subscription", "system", "announcement"] as const;
type Category = (typeof categories)[number];
type Preferences = {
  locale: "fr" | "en" | "ar"; pushEnabled: boolean; categories: Record<Category, { inApp: boolean; push: boolean }>;
  quietStartMinute: number | null; quietEndMinute: number | null;
  devices: { id: string; deviceLabel: string | null; createdAt: string; lastSuccessAt: string | null }[];
};

export function NotificationsWorkspace() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"inbox" | "settings">("inbox");
  return (
    <div>
      <PageHeader title={t("notifications.title")}>{t("notifications.intro")}</PageHeader>
      <div className="mb-4"><Segmented label={t("notifications.title")} value={tab} onChange={setTab} options={[{ value: "inbox", label: t("notifications.tabs.inbox") }, { value: "settings", label: t("notifications.tabs.settings") }]} /></div>
      {tab === "inbox" ? <Inbox /> : <Settings />}
    </div>
  );
}

function Inbox() {
  const { t, locale } = useI18n();
  const [unread, setUnread] = useState(false);
  const [category, setCategory] = useState<"" | Category>("");
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (before?: string) => {
    setFailed(false);
    const query = new URLSearchParams({ limit: "20" });
    if (unread) query.set("unread", "true");
    if (category) query.set("category", category);
    if (before) query.set("before", before);
    try {
      const response = await fetch(`/api/notifications?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items: NotificationItem[]; nextBefore: string | null };
      setItems((current) => (before ? [...(current ?? []), ...body.items] : body.items)); setNext(body.nextBefore);
    } catch { setFailed(true); }
  }, [unread, category]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const markAll = async () => {
    await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => undefined);
    void load();
  };
  const markOne = (id: string) => void fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) }).catch(() => undefined);

  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented label={t("notifications.filters.label")} value={unread ? "unread" : "all"} onChange={(value) => setUnread(value === "unread")}
          options={[{ value: "all", label: t("notifications.filters.all") }, { value: "unread", label: t("notifications.filters.unread") }]} />
        <Field className="min-w-48" label={t("notifications.filters.category")}>{(props) => (
          <Select {...props} value={category} onChange={(event) => setCategory(event.target.value as "" | Category)}>
            <option value="">{t("notifications.filters.anyCategory")}</option>
            {categories.map((value) => <option key={value} value={value}>{t(`notifications.categories.${value}`)}</option>)}
          </Select>
        )}</Field>
        <Button variant="ghost" className="ms-auto" onClick={() => void markAll()} icon={<Icon name="check" />}>{t("notifications.markAll")}</Button>
      </div>
      {failed && <Alert tone="danger">{t("notifications.loadFailed")} <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-inherit underline" onClick={() => void load()}>{t("common.retry")}</button></Alert>}
      {items === null ? <Skeleton className="h-40 rounded-[16px]" /> : items.length === 0 ? <EmptyState icon="bell" title={unread ? t("notifications.emptyUnread") : t("notifications.empty")} /> : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.linkPath ?? "/business/notifications"} onClick={() => { track("notification_opened", { category: item.category as "system", surface: "inbox" }); markOne(item.id); }}
                className={cn("flex gap-3 rounded-[16px] border p-3.5 no-underline", item.readAt ? "border-line bg-surface" : "border-brand-tint bg-brand-soft/60")}>
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={notificationIcon(item.icon)} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold text-ink" dir="auto">{item.title}</span>
                    <span className="text-xs text-fg-subtle">{formatDateTime(item.createdAt, locale)}</span>
                  </span>
                  <span className="block text-sm text-fg-muted" dir="auto">{item.body}</span>
                  <span className="block text-xs text-fg-subtle">{t(`notifications.categories.${(categories as readonly string[]).includes(item.category) ? item.category as Category : "system"}`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next && <Button variant="secondary" onClick={() => void load(next)}>{t("notifications.loadMore")}</Button>}
    </Card>
  );
}

const minuteToTime = (minute: number | null, fallback: string) => (minute === null ? fallback : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
const timeToMinute = (value: string) => { const [h, m] = value.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

function Settings() {
  const { t, locale } = useI18n();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<PushSupport>("supported");
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [quiet, setQuiet] = useState({ enabled: false, from: "22:00", to: "07:00" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/preferences", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as Preferences;
      setPreferences(body);
      setQuiet({ enabled: body.quietStartMinute !== null, from: minuteToTime(body.quietStartMinute, "22:00"), to: minuteToTime(body.quietEndMinute, "07:00") });
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); setSupport(pushSupport()); void currentPushEndpoint().then(setThisEndpoint).catch(() => undefined); }, [load]);

  if (failed) return <Alert tone="danger">{t("notifications.loadFailed")}</Alert>;
  if (!preferences) return <Skeleton className="h-64 rounded-xl" />;

  const enable = async () => {
    setBusy(true); setNotice(null);
    const outcome = await enablePushOnThisDevice(deviceLabel());
    setBusy(false);
    track("push_enabled", outcome.ok ? { result: "success", reason: "none" } : { result: "failure", reason: outcome.reason });
    if (!outcome.ok) { setNotice({ tone: "warning", text: t(`notifications.settings.states.${outcome.reason}`) }); return; }
    setThisEndpoint(await currentPushEndpoint()); void load();
  };
  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/notifications/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
        locale: preferences.locale, pushEnabled: preferences.pushEnabled, categories: preferences.categories,
        quietStartMinute: quiet.enabled ? timeToMinute(quiet.from) : null, quietEndMinute: quiet.enabled ? timeToMinute(quiet.to) : null,
      }) });
      if (!response.ok) throw new Error(String(response.status));
      setNotice({ tone: "success", text: t("notifications.settings.saved") });
    } catch { setNotice({ tone: "danger", text: t("notifications.settings.saveFailed") }); } finally { setBusy(false); }
  };
  const setCategory = (category: Category, channel: "inApp" | "push", value: boolean) =>
    setPreferences({ ...preferences, categories: { ...preferences.categories, [category]: { ...preferences.categories[category], [channel]: value } } });
  const transactional = (category: Category) => category === "security" || category === "subscription";
  const unavailable = support !== "supported" ? support : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className="grid gap-4" aria-labelledby="push-title">
        <CardTitle id="push-title" title={t("notifications.settings.pushTitle")} aside={<span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="bell" /></span>} />
        <p className="m-0 text-sm text-fg-muted">{t("notifications.settings.pushLead")}</p>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {unavailable ? <Alert tone="warning">{t(`notifications.settings.states.${unavailable}`)}</Alert>
          : thisEndpoint ? <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ok"><Icon name="check" className="size-4" />{t("notifications.settings.enabled")}</p>
          : <Button variant="cta" size="lg" block loading={busy} onClick={() => void enable()} icon={<Icon name="bell" />}>{t("notifications.settings.enable")}</Button>}
        <div>
          <p className="m-0 mb-2 text-xs font-semibold text-fg-subtle">{t("notifications.settings.devices")}</p>
          {preferences.devices.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("notifications.settings.noDevices")}</p> : (
            <ul className="m-0 grid list-none gap-2 p-0">{preferences.devices.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-paper px-3 py-2">
                <span className="min-w-0 text-sm"><span className="block font-semibold text-ink">{device.deviceLabel ?? "—"}</span>
                  <span className="block text-xs text-fg-subtle">{t("notifications.settings.since", { date: formatDateTime(device.createdAt, locale) })}</span></span>
                <Button variant="ghost" onClick={async () => { await removeDevice(device.id, false); void load(); }}>{t("notifications.settings.removeDevice")}</Button>
              </li>
            ))}</ul>
          )}
        </div>
      </Card>

      <Card className="grid gap-4" aria-labelledby="categories-title">
        <CardTitle id="categories-title" title={t("notifications.settings.categoriesTitle")} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-sm">
            <thead><tr className="text-xs text-fg-subtle"><th scope="col" className="py-2 text-start font-semibold" /><th scope="col" className="py-2 text-center font-semibold">{t("notifications.settings.inApp")}</th><th scope="col" className="py-2 text-center font-semibold">{t("notifications.settings.push")}</th></tr></thead>
            <tbody>{categories.map((category) => (
              <tr key={category} className="border-t border-line">
                <th scope="row" className="py-2.5 text-start font-semibold text-ink">{t(`notifications.categories.${category}`)}</th>
                <td className="py-2.5 text-center">{transactional(category) ? <span className="text-xs text-fg-subtle">{t("notifications.settings.alwaysOn")}</span>
                  : <input type="checkbox" className="size-5 accent-[var(--color-brand)]" aria-label={`${t(`notifications.categories.${category}`)} · ${t("notifications.settings.inApp")}`}
                    checked={preferences.categories[category].inApp} onChange={(event) => setCategory(category, "inApp", event.target.checked)} />}</td>
                <td className="py-2.5 text-center"><input type="checkbox" className="size-5 accent-[var(--color-brand)]" aria-label={`${t(`notifications.categories.${category}`)} · ${t("notifications.settings.push")}`}
                  checked={preferences.categories[category].push} onChange={(event) => setCategory(category, "push", event.target.checked)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <fieldset className="m-0 grid gap-3 rounded-[16px] border border-line p-3.5">
          <legend className="px-1 text-sm font-semibold text-ink">{t("notifications.settings.quietTitle")}</legend>
          <p className="m-0 text-sm text-fg-muted">{t("notifications.settings.quietLead")}</p>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" className="size-5 accent-[var(--color-brand)]" checked={quiet.enabled} onChange={(event) => setQuiet({ ...quiet, enabled: event.target.checked })} />{t("notifications.settings.quietEnabled")}</label>
          {quiet.enabled && <div className="grid grid-cols-2 gap-3">
            <Field label={t("notifications.settings.quietFrom")}>{(props) => <Input {...props} type="time" value={quiet.from} onChange={(event) => setQuiet({ ...quiet, from: event.target.value })} />}</Field>
            <Field label={t("notifications.settings.quietTo")}>{(props) => <Input {...props} type="time" value={quiet.to} onChange={(event) => setQuiet({ ...quiet, to: event.target.value })} />}</Field>
          </div>}
        </fieldset>
        <Field label={t("notifications.settings.language")}>{(props) => (
          <Select {...props} value={preferences.locale} onChange={(event) => setPreferences({ ...preferences, locale: event.target.value as Preferences["locale"] })}>
            <option value="fr">Français</option><option value="en">English</option><option value="ar">العربية</option>
          </Select>
        )}</Field>
        <Button variant="primary" size="lg" block loading={busy} onClick={() => void save()}>{t("notifications.settings.save")}</Button>
      </Card>
    </div>
  );
}
