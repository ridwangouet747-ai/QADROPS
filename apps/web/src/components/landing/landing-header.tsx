"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icon";
import { BrandLogo } from "@/components/brand/brand-logo";

const sections = ["features", "day", "sectors", "pricing", "faq"] as const;

/**
 * En-tête fixe : transparent en haut du hero, blanc dès que la page défile. Sur téléphone, un bouton
 * ouvre la liste des sections (fermée par Échap ou au choix d'un lien). La navigation complète n'apparaît
 * qu'à partir de 1280 px : à 1024 px, cinq liens et deux boutons ne tiennent pas en français.
 */
export function LandingHeader() {
  const { t } = useI18n();
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Transparent seulement tout en haut de la page : dès que le contenu du hero passe dessous, le fond blanc
  // évite que les liens se superposent au texte.
  useEffect(() => {
    const update = () => setSolid(window.scrollY > 16);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const light = solid || open;
  return (
    <header className={cn("fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,color] duration-300", light ? "bg-surface/92 text-ink shadow-[0_1px_0_var(--color-line)] backdrop-blur-md" : "bg-transparent text-white")}>
      <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[76rem] items-center gap-3 px-5 sm:px-8">
        <Link href="/" aria-label={t("landing.home")} className="inline-flex min-h-11 items-center rounded-full text-current no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-qadr-300">
          <BrandLogo priority casing="title" variant="compact" markClassName="h-9 w-auto shrink-0" nameClassName="font-display text-[1.2rem] font-bold tracking-[-0.02em] whitespace-nowrap max-[359px]:sr-only" />
        </Link>
        <nav aria-label={t("landing.nav.label")} className="ms-4 hidden xl:block">
          <ul className="m-0 flex list-none gap-0.5 p-0">
            {sections.map((key) => (
              <li key={key}>
                <a href={`#${key}`} className={cn("inline-flex min-h-11 items-center rounded-full px-3.5 text-[0.92rem] font-semibold no-underline transition-colors", light ? "text-fg-muted hover:bg-surface-muted hover:text-ink" : "text-qadr-100 hover:bg-white/10 hover:text-white")}>{t(`landing.nav.${key}`)}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LanguageSwitcher />
          <Link href="/login" className={cn("hidden min-h-11 items-center rounded-full px-3.5 text-[0.92rem] font-semibold whitespace-nowrap no-underline sm:inline-flex", light ? "text-brand-strong hover:bg-brand-soft" : "text-white hover:bg-white/10")}>{t("landing.login")}</Link>
          <Link href="/register" className={cn("hidden min-h-11 items-center rounded-full px-5 text-[0.92rem] font-semibold whitespace-nowrap no-underline transition-colors sm:inline-flex", light ? "bg-brand text-white hover:bg-brand-strong" : "bg-white text-qadr-900 hover:bg-qadr-100")}>{t("landing.register")}</Link>
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}
            className={cn("grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border xl:hidden", light ? "border-line bg-surface text-ink" : "border-white/30 bg-white/10 text-white")}>
            <Icon name={open ? "close" : "menu"} label={open ? t("landing.nav.close") : t("landing.nav.menu")} />
          </button>
        </div>
      </div>
      <div id={panelId} hidden={!open} className="border-t border-line bg-surface xl:hidden">
        <nav aria-label={t("landing.nav.label")} className="mx-auto w-full max-w-[76rem] px-5 py-3 sm:px-8">
          <ul className="m-0 grid list-none gap-1 p-0">
            {sections.map((key) => (
              <li key={key}><a href={`#${key}`} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-xl px-3 font-semibold text-ink no-underline hover:bg-surface-muted">{t(`landing.nav.${key}`)}</a></li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:hidden">
            <Link href="/register" className="flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white no-underline">{t("landing.register")}</Link>
            <Link href="/login" className="flex min-h-12 items-center justify-center rounded-full border border-line font-semibold text-brand-strong no-underline">{t("landing.login")}</Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
