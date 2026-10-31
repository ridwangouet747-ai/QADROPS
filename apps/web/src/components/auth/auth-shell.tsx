"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * Mise en page des écrans de compte : panneau bleu nuit de marque sur ordinateur, carte blanche
 * de formulaire ; sur téléphone, seul le formulaire, plein écran, sous un en-tête compact.
 */
export function AuthShell({ title, intro, children, footer, wide = false }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const benefits: [IconName, string][] = [["cart", t("auth.benefits.sell")], ["box", t("auth.benefits.stock")], ["users", t("auth.benefits.team")]];
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-night-gradient p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="absolute -end-24 -top-24 size-80 rounded-full bg-brand/30 blur-3xl" />
        <Link href="/" dir="ltr" className="relative flex items-center gap-3 text-white no-underline">
          <span className="grid size-11 place-items-center rounded-[14px] bg-brand-gradient text-xl font-extrabold shadow-brand">Q</span>
          <strong className="text-xl font-extrabold tracking-[-0.02em]">QADR OPS</strong>
        </Link>
        <div className="relative mt-auto max-w-md">
          <p className="m-0 text-[2.1rem] leading-tight font-bold tracking-[-0.03em]">{t("auth.tagline")}</p>
          <ul className="m-0 mt-8 grid list-none gap-3 p-0">
            {benefits.map(([icon, label]) => (
              <li key={label} className="flex items-center gap-3 rounded-[16px] bg-night-soft/70 p-3 text-night-fg">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-gradient text-white"><Icon name={icon} className="size-5" /></span>
                <span className="text-sm font-semibold text-white">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="flex min-h-dvh flex-col px-4 py-5 sm:px-8 lg:min-h-0 lg:px-12">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" dir="ltr" aria-label="QADR OPS" className="flex items-center gap-2.5 text-ink no-underline lg:invisible">
            <span className="grid size-10 place-items-center rounded-[13px] bg-brand-gradient text-lg font-extrabold text-white shadow-brand">Q</span>
            <strong className="text-[1.05rem] font-extrabold tracking-[-0.02em]">QADR OPS</strong>
          </Link>
          <LanguageSwitcher />
        </div>
        <div className={`mx-auto my-auto w-full py-8 ${wide ? "max-w-2xl" : "max-w-md"}`}>
          <h1 className="m-0 text-[1.9rem] leading-tight font-bold tracking-[-0.03em] text-ink sm:text-[2.2rem]">{title}</h1>
          {intro && <p className="m-0 mt-2 text-[0.95rem] text-fg-muted">{intro}</p>}
          <div className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">{children}</div>
          {footer && <div className="mt-5 text-center text-sm text-fg-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
