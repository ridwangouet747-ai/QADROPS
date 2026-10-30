import type { Locale } from "./config";
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
export type TranslationValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

export function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function interpolate(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** Une clé absente retombe sur le français puis sur la clé elle-même, jamais sur une chaîne vide. */
export function createTranslator(locale: Locale): Translate {
  const messages = dictionaries[locale];
  return (key, values) => interpolate(lookup(messages, key) ?? lookup(fr, key) ?? key, values);
}
