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

/** Fuseau d'un commerce sans réglage particulier (colonne `business_profile.timezone`). */
export const BUSINESS_DEFAULT_TIME_ZONE = "Africa/Abidjan";

/** Fuseau utilisable par `Intl` ; un fuseau absent ou inconnu retombe sur celui par défaut au lieu de lever une erreur. */
export function safeTimeZone(value: string | null | undefined) {
  const zone = value?.trim() || BUSINESS_DEFAULT_TIME_ZONE;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { return BUSINESS_DEFAULT_TIME_ZONE; }
}

/**
 * Date et heure au fuseau du commerce, jamais à celui de l'appareil : un PC réglé en GMT+1 afficherait
 * sinon une heure de plus que ce qui s'est passé à la boutique.
 */
export function formatDateTime(value: string | Date, locale: Locale, timeZone?: string | null) {
  return new Date(value).toLocaleString(intlLocale[locale], { dateStyle: "medium", timeStyle: "short", timeZone: safeTimeZone(timeZone) });
}

export function formatTime(value: string | Date, locale: Locale, timeZone?: string | null) {
  return new Date(value).toLocaleTimeString(intlLocale[locale], { hour: "2-digit", minute: "2-digit", timeZone: safeTimeZone(timeZone) });
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
