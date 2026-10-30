import type { Locale } from "../i18n/config";
import { formatQuantity } from "../i18n/format";

export const MICROS = 1_000_000n;

/** Lit une saisie « 12 », « 2,5 » ou « 2.5 » (6 décimales max) en micro-unités exactes, ou null si invalide. */
export function parseQuantityInput(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:[.,](\d{1,6}))?$/.exec(value.trim());
  return match ? BigInt(match[1]!) * MICROS + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}

/** Format attendu par l'API : point décimal, sans séparateur de milliers. */
export function toApiQuantity(value: string) {
  return value.trim().replace(",", ".");
}

export function microsToQuantity(micros: bigint) {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  return `${negative ? "-" : ""}${absolute / MICROS}.${(absolute % MICROS).toString().padStart(6, "0")}`;
}

/** Ajoute un pas entier à une saisie, sans jamais descendre sous zéro ; une saisie invalide repart de zéro. */
export function stepQuantity(value: string, step: 1 | -1, locale: Locale) {
  const current = parseQuantityInput(value) ?? 0n;
  const next = current + BigInt(step) * MICROS;
  return formatQuantity(microsToQuantity(next < 0n ? 0n : next), locale);
}
