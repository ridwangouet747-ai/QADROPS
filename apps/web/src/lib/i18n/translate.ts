import type { Locale } from "./config";
import { interpolate, lookup, translatorFrom, type TranslationValues } from "./lookup";
import { ar } from "./messages/ar";
import { en } from "./messages/en";
import { fr, type Messages } from "./messages/fr";

export type { Messages };
export const dictionaries: Record<Locale, Messages> = { fr, en, ar };

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Toutes les clés valides, par exemple `inventory.line.saved`. */
export type MessageKey = Leaves<Messages>;
export type { TranslationValues };
export type Translate = (key: MessageKey, values?: TranslationValues) => string;
export { interpolate, lookup };

/** Une clé absente retombe sur le français puis sur la clé elle-même, jamais sur une chaîne vide. */
export function createTranslator(locale: Locale): Translate {
  return translatorFrom(dictionaries[locale], fr);
}
