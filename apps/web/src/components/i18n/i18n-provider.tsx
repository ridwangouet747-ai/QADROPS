"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localeDirection, type Locale } from "@/lib/i18n/config";
import { createTranslator, type Translate } from "@/lib/i18n/translate";

type I18nValue = { locale: Locale; dir: "ltr" | "rtl"; t: Translate };

const I18nContext = createContext<I18nValue>({ locale: "fr", dir: "ltr", t: createTranslator("fr") });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, dir: localeDirection[locale], t: createTranslator(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
