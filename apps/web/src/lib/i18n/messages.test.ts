import { describe, expect, it } from "vitest";
import { locales } from "./config";
import { formatQuantity } from "./format";
import { createTranslator, dictionaries, interpolate } from "./translate";

function leafKeys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

function placeholders(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("traductions", () => {
  const reference = leafKeys(dictionaries.fr).sort();

  it.each(locales)("la langue %s possède exactement les clés du français, sans texte vide", (locale) => {
    expect(leafKeys(dictionaries[locale]).sort()).toEqual(reference);
    const t = createTranslator(locale);
    for (const key of reference) expect(t(key as never).trim()).not.toBe("");
  });

  it.each(locales)("la langue %s conserve les mêmes variables {…} que le français", (locale) => {
    const fr = createTranslator("fr");
    const t = createTranslator(locale);
    for (const key of reference) expect(placeholders(t(key as never))).toEqual(placeholders(fr(key as never)));
  });

  it("remplace les variables connues et laisse les autres visibles", () => {
    expect(interpolate("{counted}/{total} comptés", { counted: 3, total: 10 })).toBe("3/10 comptés");
    expect(interpolate("Bonjour {nom}", {})).toBe("Bonjour {nom}");
  });

  it("formate une quantité exacte selon la langue sans flottant", () => {
    expect(formatQuantity("12.500000", "fr")).toBe("12,5");
    expect(formatQuantity("12.500000", "en")).toBe("12.5");
    expect(formatQuantity("-3.000000", "ar")).toBe("−3");
    expect(formatQuantity("9007199254740993.000001", "fr")).toBe("9007199254740993,000001");
    expect(formatQuantity(null, "fr")).toBe("—");
  });
});
