"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { signOutAndResetAnalytics } from "@/lib/auth/logout";
import { localeCookie, locales, isLocale } from "@/lib/i18n/config";
import { PfAvatar, PfDialog, PfIconButton, pfFocus, pfRequest } from "./pf-ui";

export type PlatformSection = "overview" | "businesses" | "subscriptions" | "plans" | "promotions" | "audit" | "settings";

const items: { key: PlatformSection; href: string; icon: IconName }[] = [
  { key: "overview", href: "/platform", icon: "grid" },
  { key: "businesses", href: "/platform/businesses", icon: "store" },
  { key: "subscriptions", href: "/platform/subscriptions", icon: "receipt" },
  { key: "plans", href: "/platform/plans", icon: "layers" },
  { key: "promotions", href: "/platform/promotions", icon: "tag" },
  { key: "audit", href: "/platform/audit", icon: "activity" },
  { key: "settings", href: "/platform/settings", icon: "settings" },
];

type Self = { name: string; email: string } | null;

function NavList({ active, onNavigate }: { active: PlatformSection; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1 p-0">
      {items.map((item) => {
        const current = item.key === active;
        return (
          <li key={item.key}>
            <Link href={item.href} onClick={onNavigate} aria-current={current ? "page" : undefined}
              className={cn("flex min-h-11 items-center gap-3 rounded-full px-4 text-[0.88rem] font-medium no-underline transition-colors duration-200", pfFocus,
                current ? "bg-pf-ink text-white" : "text-pf-fg hover:bg-pf-chip")}>
              <Icon name={item.icon} className="size-[18px]" />
              <span className="truncate">{t(`platform.nav.${item.key}`)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function LanguagePill() {
  const { t, locale } = useI18n();
  const router = useRouter();
  return (
    <label className="relative flex min-h-11 items-center rounded-full border border-white bg-pf-card shadow-pf-card">
      <span className="sr-only">{t("language.label")}</span>
      <Icon name="globe" className="pointer-events-none absolute start-3.5 size-4 text-pf-muted" />
      <select value={locale} onChange={(event) => {
        const next = event.target.value;
        if (!isLocale(next)) return;
        document.cookie = `${localeCookie}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }} className={cn("min-h-11 cursor-pointer appearance-none rounded-full border-0 bg-transparent ps-10 pe-4 text-[0.82rem] font-semibold text-pf-ink", pfFocus)}>
        {locales.map((code) => <option key={code} value={code} lang={code}>{t(`language.${code}`)}</option>)}
      </select>
    </label>
  );
}

/**
 * Cadre de la console Qadr Ops Platform : grand plan blanc cassé translucide, navigation latérale en
 * pilules, profil en bas de colonne. Sur téléphone, la navigation passe dans un menu.
 */
export function PlatformShell({ active, preview, children }: { active: PlatformSection; preview?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [self, setSelf] = useState<Self>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    pfRequest<{ self: Self }>("/api/platform/settings").then((settings) => setSelf(settings.self)).catch(() => undefined);
  }, []);
  const logout = () => void signOutAndResetAnalytics().finally(() => router.push("/login"));

  return (
    <div className="min-h-dvh bg-pf-backdrop font-sans text-pf-fg lg:p-5">
      <a href="#platform-main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-pf-ink focus:px-4 focus:py-2 focus:text-white">{t("platform.common.skip")}</a>
      <div className="mx-auto flex min-h-dvh max-w-[1560px] gap-5 border-white/70 bg-pf-canvas lg:min-h-[calc(100dvh-40px)] lg:rounded-[36px] lg:border lg:p-4 lg:shadow-pf-frame">
        <aside className="sticky top-4 hidden h-[calc(100dvh-72px)] w-[232px] shrink-0 flex-col rounded-[28px] border border-white bg-pf-glass p-3 shadow-pf-card backdrop-blur-md lg:flex">
          <Link href="/platform" dir="ltr" className={cn("mb-6 flex items-center gap-2.5 rounded-full px-2 pt-2 text-pf-ink no-underline", pfFocus)}>
            <span className="grid size-10 place-items-center rounded-full bg-pf-ink text-lg font-bold text-white">Q</span>
            <span className="leading-tight"><strong className="block text-[0.95rem] tracking-[-0.02em]">QADR OPS</strong><span className="text-[0.72rem] text-pf-muted">{t("platform.brand")}</span></span>
          </Link>
          <nav aria-label={t("platform.nav.label")}><NavList active={active} /></nav>
          <div className="mt-auto rounded-[24px] bg-pf-card p-4 text-center shadow-pf-card">
            <div className="flex justify-center"><PfAvatar name={self?.name ?? "Q A"} size="lg" /></div>
            <strong className="mt-2 block truncate text-[0.88rem] text-pf-ink">{self?.name ?? "…"}</strong>
            <span className="block text-[0.74rem] text-pf-muted">{t("platform.superAdmin")}</span>
            <button type="button" onClick={logout} className={cn("mt-3 inline-flex min-h-9 cursor-pointer appearance-none items-center gap-1.5 rounded-full border border-pf-line bg-transparent px-3 text-[0.76rem] font-semibold text-pf-fg hover:border-pf-line-strong", pfFocus)}>
              <Icon name="logout" className="size-4" />{t("platform.common.logout")}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 px-4 pt-4 lg:px-2 lg:pt-1">
            <Link href="/platform" dir="ltr" className={cn("flex items-center gap-2 text-pf-ink no-underline lg:hidden", pfFocus)}>
              <span className="grid size-10 place-items-center rounded-full bg-pf-ink text-lg font-bold text-white">Q</span>
              <strong className="text-[0.95rem] tracking-[-0.02em]">QADR OPS</strong>
            </Link>
            <span className="hidden items-center gap-2 rounded-full border border-white bg-pf-card px-4 py-2 text-[0.78rem] font-semibold text-pf-muted shadow-pf-card lg:inline-flex">
              <Icon name="shield" className="size-4 text-pf-ink" />{t("platform.console")}
            </span>
            <div className="flex items-center gap-2">
              <div className="hidden sm:block"><LanguagePill /></div>
              <span className="hidden items-center gap-2 rounded-full border border-white bg-pf-card py-1 ps-1 pe-4 shadow-pf-card lg:inline-flex">
                <PfAvatar name={self?.name ?? "Q A"} size="sm" />
                <span className="max-w-40 truncate text-[0.8rem] font-semibold text-pf-ink">{self?.name ?? "…"}</span>
              </span>
              <PfIconButton icon="menu" label={t("platform.nav.label")} className="lg:hidden" onClick={() => setMenu(true)} />
            </div>
          </header>
          {preview && <p className="mx-4 mt-3 mb-0 rounded-full bg-pf-ink px-4 py-1.5 text-center text-[0.76rem] font-semibold text-white lg:mx-2">{t("platform.previewBanner")}</p>}
          <main id="platform-main" className="min-w-0 flex-1 px-4 pt-5 pb-10 lg:px-2">{children}</main>
        </div>
      </div>

      <PfDialog open={menu} onClose={() => setMenu(false)} title={t("platform.nav.label")}>
        <nav aria-label={t("platform.nav.label")}><NavList active={active} onNavigate={() => setMenu(false)} /></nav>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-pf-line pt-4">
          <LanguagePill />
          <button type="button" onClick={logout} className={cn("inline-flex min-h-11 cursor-pointer appearance-none items-center gap-2 rounded-full border border-pf-line bg-pf-card px-4 text-sm font-semibold text-pf-ink", pfFocus)}>
            <Icon name="logout" className="size-4" />{t("platform.common.logout")}
          </button>
        </div>
      </PfDialog>
    </div>
  );
}

/** En-tête de page : très grand titre noir, description, commandes alignées à droite. */
export function PfPageHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h1 className="m-0 text-[2.4rem] leading-[0.98] font-bold tracking-[-0.05em] text-pf-ink sm:text-[3.2rem]">{title}</h1>
        <p className="m-0 mt-3 text-[0.95rem] text-pf-muted">{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}
