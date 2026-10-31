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

/** Montant XOF entier (chaîne ou bigint) formaté sans flottant : « 12 500 F CFA », isolé pour le texte bidirectionnel. */
export function formatXof(value: string | bigint | null | undefined, locale: Locale) {
  if (value === null || value === undefined || value === "") return "—";
  try {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    // Isolation bidirectionnelle (LRI … PDI) : « 19 000 F CFA » reste dans le bon ordre au milieu d'une phrase arabe.
    return `\u2066${new Intl.NumberFormat(intlLocale[locale]).format(amount)} F CFA\u2069`;
  } catch {
    return "—";
  }
}
