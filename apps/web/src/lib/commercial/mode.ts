/**
 * Mode de commercialisation (2026-11-16, docs/commercial-access-codes.md § 2).
 *
 * - `manual_code` (défaut, et toute valeur inconnue) : le client contacte Qadr Agency (WhatsApp), paie hors ligne,
 *   reçoit un code d'accès commercial. Aucun paiement en ligne n'est proposé ni appelé ; un retour de paiement
 *   n'active jamais rien ; le webhook GeniusPay vérifie sa signature et met l'événement en attente.
 * - `geniuspay` : paiement en ligne de l'abonnement (docs/billing-geniuspay.md), seulement si le propriétaire
 *   le décide et que les clés sont posées.
 *
 * La valeur vient uniquement du serveur (`QADR_COMMERCIAL_MODE`) ; aucun en-tête, cookie ni paramètre ne la change.
 */
export type CommercialMode = "manual_code" | "geniuspay";
type Source = Record<string, string | undefined>;

export function commercialMode(source: Source = process.env): CommercialMode {
  return source.QADR_COMMERCIAL_MODE?.trim().toLowerCase() === "geniuspay" ? "geniuspay" : "manual_code";
}

/**
 * Un code commercial est-il exigé pour créer un compte de commerçant puis un commerce ?
 * Oui en mode `manual_code` sur tout déploiement (Vercel Production ou Preview, ou `NODE_ENV=production`).
 * En développement local et dans les tests, il ne l'est que si `QADR_ACCESS_CODE=required` (les parcours
 * existants des tests continuent de créer des commerces sans code). `QADR_ACCESS_CODE=optional` n'a aucun
 * effet sur un déploiement.
 */
export function accessCodeRequired(source: Source = process.env): boolean {
  if (commercialMode(source) !== "manual_code") return false;
  const deployed = source.VERCEL_ENV === "production" || source.VERCEL_ENV === "preview" || source.NODE_ENV === "production";
  if (deployed) return true;
  return source.QADR_ACCESS_CODE?.trim().toLowerCase() === "required";
}

/** Numéro WhatsApp de Qadr Agency, format international sans « + » (8 à 15 chiffres) ; `null` s'il manque ou s'il est invalide. */
export function whatsappNumber(source: Source = process.env): string | null {
  const raw = source.QADR_WHATSAPP_NUMBER?.trim();
  if (!raw) return null;
  const digits = raw.replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^00/, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Lien WhatsApp avec un message prérempli, ou `null` : jamais de lien vers un numéro inventé ou absent. */
export function whatsappLink(message: string, source: Source = process.env): string | null {
  const number = whatsappNumber(source);
  return number ? whatsappHref(number, message) : null;
}

/** Lien `wa.me` pour un numéro déjà validé côté serveur (utilisable dans le navigateur). */
export function whatsappHref(number: string, message: string): string | null {
  return /^[1-9]\d{7,14}$/.test(number) ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}
