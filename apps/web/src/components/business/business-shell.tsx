"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOutAndResetAnalytics } from "@/lib/auth/logout";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { cn } from "@/components/ui/cn";
import { Monogram } from "@/components/ui/data-display";
import { Icon, type IconName } from "@/components/ui/icon";

export type BusinessArea = "dashboard" | "pos" | "products" | "sales" | "customers" | "stock" | "inventory" | "suppliers" | "purchases" | "expenses" | "reports" | "settings" | "opening" | "team" | "modules";

type NavItem = { key: BusinessArea; href: string; icon: IconName };
const items: NavItem[] = [
  { key: "dashboard", href: "/business/dashboard", icon: "grid" },
  { key: "pos", href: "/business/pos", icon: "cart" },
  { key: "products", href: "/business/products", icon: "box" },
  { key: "sales", href: "/business/sales", icon: "receipt" },
  { key: "customers", href: "/business/customers", icon: "users" },
  { key: "stock", href: "/business/stock", icon: "store" },
  { key: "inventory", href: "/business/inventory", icon: "clipboard" },
  { key: "suppliers", href: "/business/suppliers", icon: "truck" },
  { key: "purchases", href: "/business/purchases", icon: "download" },
  { key: "expenses", href: "/business/expenses", icon: "wallet" },
  { key: "reports", href: "/business/reports", icon: "chart" },
  { key: "opening", href: "/business/opening", icon: "flag" },
  { key: "team", href: "/business/team", icon: "users" },
  { key: "settings", href: "/business/settings", icon: "settings" },
];
// Ordre de priorité de la barre supérieure (bureau) et de la barre basse (téléphone).
const desktopPriority: BusinessArea[] = ["dashboard", "pos", "products", "sales", "stock", "inventory", "reports"];
const mobilePriority: BusinessArea[] = ["dashboard", "pos", "stock", "inventory", "products", "sales"];

const roleModules: Record<string, BusinessArea[]> = {
  owner: items.map((item) => item.key), admin: items.map((item) => item.key),
  stock_manager: ["dashboard", "products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "reports", "opening"],
  accountant: ["dashboard", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "expenses", "reports"],
  cashier: ["pos", "products", "sales", "customers", "stock"],
  member: ["products", "sales", "customers", "stock", "inventory", "suppliers", "purchases"],
};
const BusinessRoleContext = createContext("member");
export const useBusinessRole = () => useContext(BusinessRoleContext);

/** Logo Qadr Ops : toujours de gauche à droite, y compris en arabe. */
function Brand() {
  const { t } = useI18n();
  return (
    <Link href="/business/dashboard" aria-label={t("shell.homeLink")} dir="ltr" className="flex shrink-0 items-center gap-2.5 text-ink no-underline">
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-[13px] bg-brand-gradient text-lg font-extrabold text-white shadow-brand">Q</span>
      <span className="hidden leading-none min-[400px]:grid">
        <strong className="text-[1.05rem] font-extrabold tracking-[-0.02em]">QADR OPS</strong>
        <small className="mt-1 hidden text-[0.68rem] font-medium text-fg-subtle 2xl:block">{t("shell.tagline")}</small>
      </span>
    </Link>
  );
}

/** Menu « Plus » natif (<details>) : il s'ouvre sans JavaScript ; un clic extérieur le referme. */
function MoreMenu({ entries, active }: { entries: NavItem[]; active: BusinessArea }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  if (!entries.length) return null;
  const current = entries.some((item) => item.key === active);
  return (
    <details ref={ref} className="relative">
      <summary className={cn("flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-[0.86rem] font-semibold [&::-webkit-details-marker]:hidden", current ? "bg-brand-gradient text-white shadow-brand" : "text-night-fg hover:text-white")}>
        {t("shell.more")}<Icon name="chevronDown" className="size-4" />
      </summary>
      <ul className="absolute end-0 top-[calc(100%+10px)] z-30 m-0 grid min-w-56 list-none gap-0.5 rounded-xl border border-line bg-surface p-2 shadow-overlay">
        {entries.map((item) => (
          <li key={item.key}>
            <Link href={item.href} aria-current={item.key === active ? "page" : undefined} onClick={() => { if (ref.current) ref.current.open = false; }}
              className={cn("flex min-h-11 items-center gap-3 rounded-[12px] px-3 text-sm font-semibold no-underline", item.key === active ? "bg-brand-soft text-brand-strong" : "text-fg hover:bg-paper")}>
              <Icon name={item.icon} className="size-[18px] text-brand" />{t(`shell.items.${item.key}.label`)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function BusinessShell({ active, preview = false, children }: { active: BusinessArea; preview?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [businessName, setBusinessName] = useState<string | null>(preview ? "Commerce Démo QADR" : null);
  const [role, setRole] = useState(preview ? "owner" : "member");
  const displayName = businessName ?? t("shell.defaultBusiness");
  useEffect(() => {
    void fetch("/api/business/settings", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { settings?: { name?: string; role?: string } };
      if (data.settings?.name) setBusinessName(data.settings.name);
      if (data.settings?.role && roleModules[data.settings.role]) setRole(data.settings.role);
    }).catch(() => undefined);
  }, []);

  const allowed = useMemo(() => new Set(roleModules[role] ?? roleModules.member), [role]);
  const visible = items.filter((item) => allowed.has(item.key));
  const pick = (keys: BusinessArea[]) => keys.flatMap((key) => visible.filter((item) => item.key === key));
  const desktopMain = pick(desktopPriority);
  const desktopMore = visible.filter((item) => !desktopMain.includes(item) && item.key !== "settings");
  const mobileMain = pick(mobilePriority).slice(0, 4);
  const mobileLinks: NavItem[] = [...mobileMain, ...(visible.length > mobileMain.length ? [{ key: "modules" as const, href: "/business/modules", icon: "grid" as const }] : [])];
  const canSettings = allowed.has("settings");

  return (
    <BusinessRoleContext.Provider value={role}>
      <div className="min-h-dvh bg-canvas text-fg">
        <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/90 backdrop-blur-md">
          <div className="mx-auto flex h-[68px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:h-[76px] lg:px-8">
            <Brand />
            <nav aria-label={t("shell.modulesNavigation")} className="mx-auto hidden items-center gap-0.5 rounded-full bg-night p-1.5 shadow-raised lg:flex">
              {desktopMain.map((item) => (
                <Link key={item.key} href={item.href} aria-current={item.key === active ? "page" : undefined}
                  className={cn("flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[0.86rem] font-semibold whitespace-nowrap no-underline transition-colors",
                    item.key === active ? "bg-brand-gradient text-white shadow-brand" : "text-night-fg hover:text-white")}>
                  {item.key === active && <Icon name={item.icon} className="size-4" />}
                  {t(`shell.items.${item.key}.label`)}
                </Link>
              ))}
              <MoreMenu entries={desktopMore} active={active} />
            </nav>
            <div className="ms-auto flex items-center gap-2 lg:ms-0">
              {preview && <span className="hidden rounded-full border border-warn-line bg-warn-soft px-3 py-1.5 text-xs font-semibold text-warn 2xl:inline">{t("shell.previewBadge")}</span>}
              <LanguageSwitcher className="shrink-0" />
              {canSettings && (
                <Link href="/business/settings" aria-label={t("shell.settingsLink")} title={t("shell.settingsLink")}
                  className={cn("hidden size-11 place-items-center rounded-full border bg-surface sm:grid", active === "settings" ? "border-brand text-brand" : "border-line text-ink hover:border-brand-tint hover:text-brand")}>
                  <Icon name="settings" />
                </Link>
              )}
              <Link href="/select-business" aria-label={t("selectBusiness.switch")} className="hidden items-center gap-2.5 rounded-full border border-line bg-surface py-1 ps-1 pe-4 text-inherit no-underline hover:border-brand-tint md:flex max-w-52" title={t("selectBusiness.switch")}>
                <Monogram text={displayName} className="size-9" />
                <span className="grid min-w-0 leading-tight">
                  <small className="truncate text-[0.66rem] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-subtle">{t("shell.activeBusiness")}</small>
                  <strong dir="auto" className="truncate text-[0.84rem] text-ink">{displayName}</strong>
                </span>
              </Link>
              <button type="button" onClick={() => void signOutAndResetAnalytics().finally(() => router.push("/login"))} aria-label={t("auth.logout")} title={t("auth.logout")}
                className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink hover:border-danger-line hover:text-danger">
                <Icon name="logout" />
              </button>
            </div>
          </div>
          {preview && <p className="m-0 border-t border-warn-line bg-warn-soft px-4 py-1 text-center text-xs font-semibold text-warn 2xl:hidden">{t("shell.previewBadge")}</p>}
        </header>

        <main id="main-content" className={`business-page ${active}-page mx-auto max-w-[1440px] px-4 pt-5 pb-32 sm:px-6 lg:px-8 lg:pt-7 lg:pb-12`}>
          {children}
        </main>

        {/* Téléphone et tablette : barre basse flottante, cibles de 56 px, zone de sécurité respectée. */}
        <nav aria-label={t("shell.mainNavigation")}
          className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto grid max-w-lg auto-cols-fr grid-flow-col gap-1 rounded-[22px] bg-night p-1.5 shadow-overlay lg:hidden">
          {mobileLinks.map((item) => {
            const current = item.key === active || (item.key === "modules" && !mobileMain.some((entry) => entry.key === active));
            return (
              <Link key={item.key} href={item.href} aria-current={current ? "page" : undefined}
                className={cn("flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] px-1 text-[0.7rem] font-semibold no-underline",
                  current ? "bg-brand-gradient text-white shadow-brand" : "text-night-fg")}>
                <Icon name={item.icon} className="size-5" />
                <span className="max-w-full truncate">{item.key === "dashboard" ? t("shell.home") : t(`shell.items.${item.key}.label`)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </BusinessRoleContext.Provider>
  );
}
