"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOutAndResetAnalytics } from "@/lib/auth/logout";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { InstallInvite } from "@/components/pwa/install-invite";
import { NetworkStatus } from "@/components/pwa/network-status";
import { PushDeviceSync } from "@/components/notifications/push-device-sync";
import { BusinessTimeZoneContext } from "@/components/business/business-time-zone";
import { track } from "@/lib/analytics/client";
import { BUSINESS_DEFAULT_TIME_ZONE, safeTimeZone } from "@/lib/i18n/format";
import { cn } from "@/components/ui/cn";
import { BusinessLogo } from "@/components/business/business-identity";
import { Icon, type IconName } from "@/components/ui/icon";

export type BusinessArea = "dashboard" | "pos" | "products" | "sales" | "customers" | "stock" | "inventory" | "suppliers" | "purchases" | "expenses" | "reports" | "settings" | "opening" | "team" | "subscription" | "cash" | "notifications" | "printing" | "install" | "imports" | "modules";

type NavItem = { key: BusinessArea; href: string; icon: IconName };
const items: NavItem[] = [
  { key: "dashboard", href: "/business/dashboard", icon: "grid" },
  { key: "pos", href: "/business/pos", icon: "cart" },
  { key: "cash", href: "/business/cash", icon: "wallet" },
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
  { key: "imports", href: "/business/imports", icon: "layers" },
  { key: "team", href: "/business/team", icon: "users" },
  { key: "subscription", href: "/business/subscription", icon: "tag" },
  { key: "printing", href: "/business/printing", icon: "printer" },
  { key: "install", href: "/business/install", icon: "download" },
  { key: "settings", href: "/business/settings", icon: "settings" },
];
// Ordre de priorité de la barre supérieure (bureau) et de la barre basse (téléphone).
const desktopPriority: BusinessArea[] = ["dashboard", "pos", "products", "sales", "stock", "inventory", "reports"];
const mobilePriority: BusinessArea[] = ["dashboard", "pos", "cash", "stock", "inventory", "products", "sales"];

const roleModules: Record<string, BusinessArea[]> = {
  owner: items.map((item) => item.key), admin: items.map((item) => item.key),
  stock_manager: ["dashboard", "products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "reports", "opening", "imports", "install"],
  accountant: ["dashboard", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "expenses", "reports", "cash", "subscription", "install"],
  cashier: ["pos", "cash", "products", "sales", "customers", "stock", "printing", "install"],
  member: ["products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "subscription", "install"],
};
const BusinessRoleContext = createContext("member");
export const useBusinessRole = () => useContext(BusinessRoleContext);

type ActiveBusiness = { name: string; logo: string | null; role: string; timezone: string | null; lifecycle: string };

/**
 * Identité du commerce actif, en tête de l’en-tête à toutes les largeurs (mission CTO du 2026-11-14) : logo du
 * commerçant (ou initiale) et nom complet, tronqué seulement à la largeur disponible, avec le nom entier en
 * infobulle. Un clic ouvre le choix du commerce. Qadr Ops reste nommé en petit sous le nom.
 */
function BusinessIdentity({ business }: { business: ActiveBusiness | null }) {
  const { t } = useI18n();
  if (!business) {
    return (
      <span className="flex min-w-0 items-center gap-2.5" aria-hidden="true">
        <span className="size-10 shrink-0 animate-pulse rounded-[12px] bg-surface-muted" />
        <span className="h-4 w-28 animate-pulse rounded-full bg-surface-muted" />
      </span>
    );
  }
  return (
    <Link href="/select-business" title={business.name} aria-label={t("shell.businessSwitch", { business: business.name })}
      className="group flex min-w-12 max-w-[58vw] items-center gap-2.5 rounded-[14px] py-1 pe-2 text-inherit no-underline sm:min-w-13 sm:max-w-[20rem] lg:max-w-[11rem] xl:max-w-[17rem] 2xl:max-w-[22rem]">
      <BusinessLogo name={business.name} logo={business.logo} className="size-10 sm:size-11" />
      <span className="grid min-w-0 leading-tight">
        <strong dir="auto" className="truncate text-[0.98rem] font-bold tracking-[-0.01em] text-ink group-hover:text-brand-strong sm:text-[1.05rem]">{business.name}</strong>
        {/* Le texte se tronque seul : la flèche reste visible même quand la place manque (« Géré avec Qadr Ops » à 390 px). */}
        <small className="flex min-w-0 items-center gap-1 text-[0.72rem] font-medium text-fg-subtle"><span className="truncate">{t("shell.poweredBy")}</span><Icon name="chevronDown" className="size-3.5 shrink-0" /></small>
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

/**
 * `initialRole` : rôle lu par la garde serveur de la page, affiché avant la réponse de `/api/account/me` pour
 * que menus et boutons réservés ne décalent pas la page à leur arrivée. Indication d'affichage seulement.
 */
export function BusinessShell({ active, preview = false, initialRole = null, children }: { active: BusinessArea; preview?: boolean; initialRole?: string | null; children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [business, setBusiness] = useState<ActiveBusiness | null>(preview ? { name: "Commerce Démo QADR", logo: null, role: "owner", timezone: null, lifecycle: "active" } : null);
  const role = business?.role ?? (initialRole && roleModules[initialRole] ? initialRole : "member");
  const timeZone = safeTimeZone(business?.timezone ?? BUSINESS_DEFAULT_TIME_ZONE);
  useEffect(() => {
    const features = ["dashboard", "pos", "stock", "inventory", "reports", "cash", "sales", "notifications", "printing", "subscription", "team"] as const;
    const feature = features.find((item) => item === active);
    if (feature) track("feature_viewed", { feature });
  }, [active]);
  useEffect(() => {
    // /api/account/me répond à tous les rôles (les réglages du commerce exigent business:read, que la caisse n’a pas).
    const load = () => void fetch("/api/account/me", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { businesses?: (ActiveBusiness & { active: boolean })[] };
      const active = data.businesses?.find((item) => item.active);
      if (active) setBusiness({ name: active.name, logo: active.logo, role: roleModules[active.role] ? active.role : "member", timezone: active.timezone, lifecycle: active.lifecycle });
    }).catch(() => undefined);
    load();
    // Nom ou logo modifiés dans les réglages : l’en-tête se met à jour sans recharger la page.
    window.addEventListener("qadr:business-updated", load);
    return () => window.removeEventListener("qadr:business-updated", load);
  }, []);

  // Commerce sans droit d’usage : seuls l’abonnement et l’installation restent proposés (le serveur refuse le reste).
  const pending = business?.lifecycle === "pending";
  const allowed = useMemo(() => new Set(pending ? (["subscription", "install"] as BusinessArea[]) : roleModules[role] ?? roleModules.member), [pending, role]);
  const visible = items.filter((item) => allowed.has(item.key));
  const pick = (keys: BusinessArea[]) => keys.flatMap((key) => visible.filter((item) => item.key === key));
  const desktopMain = pending ? visible : pick(desktopPriority);
  const desktopMore = visible.filter((item) => !desktopMain.includes(item) && item.key !== "settings");
  const mobileMain = pending ? visible : pick(mobilePriority).slice(0, 4);
  const mobileLinks: NavItem[] = [...mobileMain, ...(visible.length > mobileMain.length ? [{ key: "modules" as const, href: "/business/modules", icon: "grid" as const }] : [])];
  const canSettings = allowed.has("settings");

  return (
    <BusinessRoleContext.Provider value={role}>
      <BusinessTimeZoneContext.Provider value={timeZone}>
      <div className="min-h-dvh bg-canvas text-fg">
        <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/90 backdrop-blur-md">
          <div className="mx-auto flex h-[68px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:h-[76px] lg:px-8">
            <BusinessIdentity business={business} />
            <nav aria-label={t("shell.modulesNavigation")} className="mx-auto hidden items-center gap-0.5 rounded-full bg-night p-1.5 shadow-raised lg:flex">
              {desktopMain.map((item) => (
                <Link key={item.key} href={item.href} aria-current={item.key === active ? "page" : undefined}
                  className={cn("flex min-h-10 items-center gap-1.5 rounded-full px-2.5 text-[0.86rem] xl:px-3.5 font-semibold whitespace-nowrap no-underline transition-colors",
                    item.key === active ? "bg-brand-gradient text-white shadow-brand" : "text-night-fg hover:text-white")}>
                  {item.key === active && <Icon name={item.icon} className="size-4" />}
                  {t(`shell.items.${item.key}.label`)}
                </Link>
              ))}
              <MoreMenu entries={desktopMore} active={active} />
            </nav>
            {/* Les boutons de droite gardent leur taille ; c’est le nom du commerce (tronqué, nom complet en infobulle) qui cède la place, jusqu’à ne laisser que le logo. */}
            <div className="ms-auto flex shrink-0 items-center gap-2 lg:ms-0">
              {preview && <span className="hidden rounded-full border border-warn-line bg-warn-soft px-3 py-1.5 text-xs font-semibold text-warn 2xl:inline">{t("shell.previewBadge")}</span>}
              <LanguageSwitcher compact className="shrink-0 xl:hidden" />
              <LanguageSwitcher className="hidden shrink-0 xl:block" />
              <NotificationBell />
              {canSettings && (
                <Link href="/business/settings" aria-label={t("shell.settingsLink")} title={t("shell.settingsLink")}
                  className={cn("hidden size-11 place-items-center rounded-full border bg-surface sm:grid", active === "settings" ? "border-brand text-brand" : "border-line text-ink hover:border-brand-tint hover:text-brand")}>
                  <Icon name="settings" />
                </Link>
              )}
              <button type="button" onClick={() => void signOutAndResetAnalytics().finally(() => router.push("/login"))} aria-label={t("auth.logout")} title={t("auth.logout")}
                className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink hover:border-danger-line hover:text-danger">
                <Icon name="logout" />
              </button>
            </div>
          </div>
          {preview && <p className="m-0 border-t border-warn-line bg-warn-soft px-4 py-1 text-center text-xs font-semibold text-warn 2xl:hidden">{t("shell.previewBadge")}</p>}
          <NetworkStatus />
          {preview ? null : <PushDeviceSync />}
        </header>
        <InstallInvite />

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
      </BusinessTimeZoneContext.Provider>
    </BusinessRoleContext.Provider>
  );
}
