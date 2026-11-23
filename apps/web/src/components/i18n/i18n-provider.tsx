"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localeDirection, type Locale } from "@/lib/i18n/config";
import { translatorFrom } from "@/lib/i18n/lookup";
import type { Messages } from "@/lib/i18n/messages/fr";
import type { Translate } from "@/lib/i18n/translate";

type I18nValue = { locale: Locale; dir: "ltr" | "rtl"; t: Translate };

// Hors fournisseur (jamais dans l'application : la mise en page racine l'installe), la clé reste lisible.
const I18nContext = createContext<I18nValue>({ locale: "fr", dir: "ltr", t: translatorFrom({}) });

/**
 * Reçoit du serveur le seul dictionnaire de la langue active : le navigateur ne télécharge jamais les deux autres.
 * `messages.test.ts` garantit que fr, en et ar ont exactement les mêmes clés, d'où l'absence de repli sur le
 * français ici (le serveur, lui, le garde dans `createTranslator`).
 */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, dir: localeDirection[locale], t: translatorFrom(messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
