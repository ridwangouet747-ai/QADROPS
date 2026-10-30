"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

export type BusinessArea = "dashboard" | "pos" | "products" | "sales" | "customers" | "stock" | "inventory" | "suppliers" | "purchases" | "expenses" | "reports" | "settings" | "modules";

type NavGroup = "activity" | "management" | "stock" | "supply" | "finance" | "configuration";
const items: { key: BusinessArea; href: string; icon: string; group: NavGroup }[] = [
  { key: "dashboard", href: "/business/dashboard", icon: "dashboard", group: "activity" },
  { key: "pos", href: "/business/pos", icon: "pos", group: "activity" },
  { key: "products", href: "/business/products", icon: "products", group: "management" },
  { key: "sales", href: "/business/sales", icon: "sales", group: "management" },
  { key: "customers", href: "/business/customers", icon: "customers", group: "management" },
  { key: "stock", href: "/business/stock", icon: "stock", group: "stock" },
  { key: "inventory", href: "/business/inventory", icon: "inventory", group: "stock" },
  { key: "suppliers", href: "/business/suppliers", icon: "suppliers", group: "supply" },
  { key: "purchases", href: "/business/purchases", icon: "purchases", group: "supply" },
  { key: "expenses", href: "/business/expenses", icon: "expenses", group: "finance" },
  { key: "reports", href: "/business/reports", icon: "reports", group: "finance" },
  { key: "settings", href: "/business/settings", icon: "settings", group: "configuration" },
];
const roleModules: Record<string, string[]> = {
  owner: items.map((item) => item.key), admin: items.map((item) => item.key),
  stock_manager: ["dashboard", "products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "reports"],
  accountant: ["dashboard", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "expenses", "reports"],
  cashier: ["pos", "products", "sales", "customers", "stock"],
  member: ["products", "sales", "customers", "stock", "inventory", "suppliers", "purchases"],
};
const BusinessRoleContext = createContext("member");
export const useBusinessRole = () => useContext(BusinessRoleContext);

function ModuleIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <path d="M4 13h7V4H4v9Zm9 7h7V11h-7v9ZM4 20h7v-5H4v5Zm9-11h7V4h-7v5Z" />,
    pos: <><path d="M4 8h16v12H4zM7 8V5h10v3M8 12h8M8 16h4" /></>,
    products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" /></>,
    sales: <><path d="M4 19.5h16M6.5 16v-5m5.5 5V5m5.5 11v-7" /><path d="m5.5 8 5-3 5 3 3-2" /></>,
    customers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.6-3.4 2.5-5 5.5-5s4.9 1.6 5.5 5M16 5.5a3 3 0 0 1 0 5.8M17 15c2.1.5 3.3 2.1 3.7 5" /></>,
    stock: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" /></>,
    inventory: <><path d="M5 4h14v16H5zM8 8h8M8 12h3m2 0 1.5 1.5L18 10" /></>,
    suppliers: <><path d="M3 20h18M5 20V8l7-4 7 4v12M9 20v-6h6v6M8 9h.01M12 9h.01M16 9h.01" /></>,
    purchases: <><path d="M4 5h2l2 11h10l2-8H7M10 20h.01M17 20h.01M10 12h7" /></>,
    expenses: <><path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h4" /></>,
    reports: <><path d="M4 19.5h16M6.5 16V11m5.5 5V5m5.5 11v-7" /><path d="m5.5 8 5-3 5 3 3-2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19 14 1.5 1-1.5 2.5-1.7-.6a7 7 0 0 1-1.5.8l-.3 1.8h-3l-.3-1.8a7 7 0 0 1-1.5-.8l-1.7.6-1.5-2.5 1.5-1a7 7 0 0 1 0-1.8l-1.5-1L7 8.7l1.7.6a7 7 0 0 1 1.5-.8l.3-1.8h3l.3 1.8a7 7 0 0 1 1.5.8l1.7-.6 1.5 2.5-1.5 1a7 7 0 0 1 0 1.8Z" /></>,
    modules: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.modules}</svg>;
}

export function BusinessShell({ active, preview = false, children }: { active: BusinessArea; preview?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const [businessName, setBusinessName] = useState<string | null>(preview ? "Commerce Démo QADR" : null);
  const [role, setRole] = useState(preview ? "owner" : "member");
  const displayName = businessName ?? t("shell.defaultBusiness");
  const label = (key: BusinessArea) => t(`shell.items.${key}.label`);
  const detail = (key: BusinessArea) => t(`shell.items.${key}.detail`);
  useEffect(() => {
    void fetch("/api/business/settings", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { settings?: { name?: string; role?: string } };
      if (data.settings?.name) setBusinessName(data.settings.name);
      if (data.settings?.role && roleModules[data.settings.role]) setRole(data.settings.role);
    }).catch(() => undefined);
  }, []);
  const visibleItems = useMemo(() => items.filter((item) => (roleModules[role] ?? roleModules.member).includes(item.key)), [role]);
  const groups = [...new Set(visibleItems.map((item) => item.group))];
  const mainMobile = visibleItems.filter((item) => ["dashboard", "pos", "stock", "reports"].includes(item.key)).slice(0, 4);
  const mobileLinks = [...mainMobile, ...(visibleItems.length > mainMobile.length ? [{ key: "modules" as const, href: "/business/modules", icon: "modules", group: "configuration" as const }] : [])];

  return <BusinessRoleContext.Provider value={role}><div className="business-app-shell">
    <aside className="business-sidebar" aria-label={t("shell.navigation")}>
      <Link className="business-brand" href="/business/dashboard" aria-label={t("shell.homeLink")}><span className="business-brand-mark" aria-hidden="true">Q</span><span className="business-brand-copy"><strong dir="ltr">QADR <em>OPS</em></strong><small>{t("shell.brandSubtitle")}</small></span></Link>
      <div className="business-workspace-card"><span className="business-workspace-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span><span className="business-workspace-copy"><small>{t("shell.activeBusiness")}</small><strong>{displayName}</strong></span></div>
      <nav className="business-navigation" aria-label={t("shell.modulesNavigation")}>{groups.map((group) => <section className="business-navigation-group" key={group}><p className="business-navigation-label">{t(`shell.groups.${group}`)}</p>{visibleItems.filter((item) => item.group === group).map((item) => <Link key={item.key} href={item.href} className="business-nav-link" aria-current={active === item.key ? "page" : undefined}><ModuleIcon name={item.icon} /><span className="business-nav-copy"><strong>{label(item.key)}</strong><small>{detail(item.key)}</small></span>{active === item.key && <span className="business-nav-indicator" aria-hidden="true" />}</Link>)}</section>)}</nav>
      <div className="business-sidebar-footer"><span className="business-sidebar-footer-mark" aria-hidden="true">Q</span><span><strong>QADR OPS</strong><small>{t("shell.tagline")}</small></span></div>
    </aside>
    <div className="business-main-column">
      <header className="business-appbar"><Link className="business-mobile-brand" href="/business/dashboard" aria-label={t("shell.homeLink")} dir="ltr">QADR <span>OPS</span></Link><p className="business-breadcrumb"><span>{displayName}</span><span aria-hidden="true">/</span><strong>{label(active)}</strong></p>{preview ? <span className="business-preview-badge">{t("shell.previewBadge")}</span> : <span className="business-appbar-context">{t("shell.secureSpace")}</span>}<LanguageSwitcher className="shrink-0" /></header>
      <main className={`business-page ${active}-page`} id="main-content"><div className="business-content">{children}</div></main>
      <nav className="business-mobile-nav" aria-label={t("shell.mainNavigation")}>{mobileLinks.map((item) => <Link key={item.key} href={item.href} aria-current={item.key === active || (item.key === "modules" && !mainMobile.some((entry) => entry.key === active)) ? "page" : undefined}><ModuleIcon name={item.icon} /><span>{label(item.key)}</span></Link>)}</nav>
    </div>
  </div></BusinessRoleContext.Provider>;
}
