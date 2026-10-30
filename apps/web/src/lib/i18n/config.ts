export const locales = ["fr", "en", "ar"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";
/** Préférence d'interface stockée côté navigateur, en attendant une préférence par utilisateur en base. */
export const localeCookie = "qadr-locale";

export const localeDirection: Record<Locale, "ltr" | "rtl"> = { fr: "ltr", en: "ltr", ar: "rtl" };

/** Les chiffres latins restent la norme des commerces ciblés, y compris en arabe. */
export const intlLocale: Record<Locale, string> = { fr: "fr-FR", en: "en-GB", ar: "ar-u-nu-latn" };

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (locales as readonly string[]).includes(value);

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : defaultLocale;
}
