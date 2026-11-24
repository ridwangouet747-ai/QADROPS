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

/*
 * Formateurs `Intl` créés une fois par combinaison (mission performance du 2026-11-24). En créer un par appel
 * coûtait cher dans les listes : chaque ligne d'historique en fabriquait deux (contrôle du fuseau + date), chaque
 * carte de la caisse un pour le prix, ce qui ralentissait la saisie sur les téléphones modestes.
 */
const zones = new Map<string, string>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** Fuseau utilisable par `Intl` ; un fuseau absent ou inconnu retombe sur celui par défaut au lieu de lever une erreur. */
export function safeTimeZone(value: string | null | undefined) {
  const zone = value?.trim() || BUSINESS_DEFAULT_TIME_ZONE;
  let checked = zones.get(zone);
  if (checked === undefined) {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); checked = zone; } catch { checked = BUSINESS_DEFAULT_TIME_ZONE; }
    zones.set(zone, checked);
  }
  return checked;
}

function dateFormat(locale: Locale, timeZone: string, kind: "dateTime" | "time") {
  const key = `${locale}|${timeZone}|${kind}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale[locale], kind === "dateTime"
      ? { dateStyle: "medium", timeStyle: "short", timeZone }
      : { hour: "2-digit", minute: "2-digit", timeZone });
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * Date et heure au fuseau du commerce, jamais à celui de l'appareil : un PC réglé en GMT+1 afficherait
 * sinon une heure de plus que ce qui s'est passé à la boutique.
 */
export function formatDateTime(value: string | Date, locale: Locale, timeZone?: string | null) {
  return dateFormat(locale, safeTimeZone(timeZone), "dateTime").format(new Date(value));
}

export function formatTime(value: string | Date, locale: Locale, timeZone?: string | null) {
  return dateFormat(locale, safeTimeZone(timeZone), "time").format(new Date(value));
}

function numberFormat(locale: Locale) {
  let format = numberFormats.get(locale);
  if (!format) { format = new Intl.NumberFormat(intlLocale[locale]); numberFormats.set(locale, format); }
  return format;
}

/** Montant XOF entier (chaîne ou bigint) formaté sans flottant : « 12 500 F CFA », isolé pour le texte bidirectionnel. */
export function formatXof(value: string | bigint | null | undefined, locale: Locale) {
  if (value === null || value === undefined || value === "") return "—";
  try {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    // Isolation bidirectionnelle (LRI … PDI) : « 19 000 F CFA » reste dans le bon ordre au milieu d'une phrase arabe.
    return `⁦${numberFormat(locale).format(amount)} F CFA⁩`;
  } catch {
    return "—";
  }
}
