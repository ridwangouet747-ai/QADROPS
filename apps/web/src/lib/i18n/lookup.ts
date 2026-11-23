/**
 * Recherche et interpolation des messages, sans importer aucun dictionnaire. Le navigateur n'en reçoit qu'un, celui
 * de la langue active (transmis par la mise en page racine) : importer `translate.ts` côté client embarquerait les
 * trois langues dans un fragment partagé par toutes les pages (≈ 117 Ko compressés, mesure du 2026-11-21).
 */
export type TranslationValues = Record<string, string | number>;

export function lookup(messages: unknown, key: string): string | undefined {
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

/** Une clé absente retombe sur le dictionnaire de repli (s'il est fourni), puis sur la clé elle-même. */
export function translatorFrom(messages: unknown, fallback?: unknown) {
  return (key: string, values?: TranslationValues) =>
    interpolate(lookup(messages, key) ?? (fallback === undefined ? undefined : lookup(fallback, key)) ?? key, values);
}
