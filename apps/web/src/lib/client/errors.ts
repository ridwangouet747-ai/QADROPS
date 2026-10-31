import type { Locale } from "../i18n/config";
import type { Translate } from "../i18n/translate";

/**
 * Les services métier renvoient leurs erreurs en français. En anglais et en arabe, on affiche
 * un message traduit selon le code HTTP plutôt qu'une phrase française ; le français garde le
 * message précis du serveur.
 */
export function errorMessageFor({ status, serverMessage, locale, t }: { status: number | null; serverMessage?: string; locale: Locale; t: Translate }) {
  if (locale === "fr" && serverMessage) return serverMessage;
  if (status === null) return t("errors.network");
  if (status === 401 || status === 403) return t("errors.forbidden");
  if (status === 404) return t("errors.notFound");
  if (status === 409) return t("errors.conflict");
  if (status === 400 || status === 422) return t("errors.invalid");
  return t("errors.generic");
}
