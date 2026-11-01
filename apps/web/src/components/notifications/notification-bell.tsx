"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatDateTime } from "@/lib/i18n/format";
import { track } from "@/lib/analytics/client";

export type NotificationItem = { id: string; category: string; icon: string; title: string; body: string; linkPath: string | null; createdAt: string; readAt: string | null };

const iconNames = new Set<IconName>(["cart", "wallet", "warning", "box", "shield", "tag", "info", "users", "receipt"]);
export const notificationIcon = (icon: string): IconName => (iconNames.has(icon as IconName) ? icon as IconName : "info");

/**
 * Cloche de l'en-tête : compteur des non-lues (interrogé toutes les 60 s, à la reprise de l'onglet, et
 * jamais quand l'onglet est caché) et panneau des dernières notifications.
 */
export function NotificationBell() {
  const { t, locale } = useI18n();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (response.ok) setCount(((await response.json()) as { unreadCount: number }).unreadCount);
    } catch { /* hors ligne : on garde le dernier compte */ }
  }, []);
  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => void refreshCount(), 60_000);
    document.addEventListener("visibilitychange", refreshCount);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refreshCount); };
  }, [refreshCount]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const response = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items: NotificationItem[]; unreadCount: number };
      setItems(body.items); setCount(body.unreadCount);
    } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open, load]);

  const markAll = async () => {
    await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => undefined);
    setCount(0); setItems((current) => current?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ?? null);
  };
  const markOne = (id: string) => {
    void fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) }).catch(() => undefined);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={count ? `${t("notifications.bell")} · ${t("notifications.unread", { count })}` : t("notifications.bell")}
        className="relative grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg hover:text-ink">
        <Icon name="bell" />
        {count > 0 && <span aria-hidden="true" className="numeric absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-cta px-1 text-[0.7rem] leading-5 font-bold text-white">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t("notifications.title")} className="absolute end-0 top-13 z-40 w-[min(calc(100vw-2rem),24rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="m-0 font-bold text-ink">{t("notifications.title")}</p>
            {count > 0 && <button type="button" onClick={() => void markAll()} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-brand">{t("notifications.markAll")}</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {failed ? <p className="m-0 p-4 text-sm text-danger">{t("notifications.loadFailed")}</p>
              : items === null ? <p className="m-0 p-4 text-sm text-fg-muted" role="status">…</p>
              : items.length === 0 ? <p className="m-0 p-4 text-sm text-fg-muted">{t("notifications.empty")}</p>
              : <ul className="m-0 list-none p-0">{items.map((item) => (
                <li key={item.id} className="border-b border-line last:border-0">
                  <Link href={item.linkPath ?? "/business/notifications"} onClick={() => { track("notification_opened", { category: item.category as "system", surface: "bell" }); markOne(item.id); }} className={cn("flex gap-3 px-4 py-3 no-underline hover:bg-paper", !item.readAt && "bg-brand-soft/60")}>
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={notificationIcon(item.icon)} className="size-4" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink" dir="auto">{item.title}</span>
                      <span className="block text-sm text-fg-muted" dir="auto">{item.body}</span>
                      <span className="block text-xs text-fg-subtle">{formatDateTime(item.createdAt, locale)}</span>
                    </span>
                  </Link>
                </li>
              ))}</ul>}
          </div>
          <Link href="/business/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-3 text-center text-sm font-semibold text-brand no-underline hover:bg-paper">{t("notifications.viewAll")}</Link>
        </div>
      )}
    </div>
  );
}
