"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { locales, localeCookie, isLocale } from "@/lib/i18n/config";
import { useI18n } from "./i18n-provider";

/** Sélecteur natif : le plus fiable sur les téléphones d'entrée de gamme et pour les lecteurs d'écran. */
/** `compact` : codes courts (FR, EN, AR) pour les en-têtes étroits ; la liste garde le nom complet en infobulle. */
export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className={className}>
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={locale} disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          document.cookie = `${localeCookie}=${next}; path=/; max-age=31536000; samesite=lax`;
          startTransition(() => router.refresh());
        }}
        className={cn("min-h-11 cursor-pointer rounded-full border border-line bg-surface text-sm font-semibold text-ink hover:border-brand-tint", compact ? "px-2.5" : "px-3")}
      >
        {locales.map((code) => <option key={code} value={code} lang={code} title={t(`language.${code}`)}>{compact ? code.toUpperCase() : t(`language.${code}`)}</option>)}
      </select>
    </label>
  );
}
