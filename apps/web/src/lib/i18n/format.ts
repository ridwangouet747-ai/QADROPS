import { intlLocale, type Locale } from "./config";

const decimalSeparator: Record<Locale, string> = { fr: ",", en: ".", ar: "." };

/** Formate une quantité décimale exacte (chaîne « 12.500000 ») sans passer par un flottant. */
export function formatQuantity(value: string | null, locale: Locale) {
  if (value === null) return "—";
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const trimmed = fraction?.replace(/0+$/, "");
  return `${negative ? "−" : ""}${whole}${trimmed ? `${decimalSeparator[locale]}${trimmed}` : ""}`;
}

export function formatDateTime(value: string | Date, locale: Locale) {
  return new Date(value).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value: string | Date, locale: Locale) {
  return new Date(value).toLocaleTimeString(intlLocale[locale], { hour: "2-digit", minute: "2-digit" });
}
