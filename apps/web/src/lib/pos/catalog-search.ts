import { parseQuantityInput } from "@/lib/client/quantity";

/**
 * Recherche de la caisse, sans base : le catalogue est indexé une fois (texte normalisé, stock lu une fois), puis
 * chaque frappe ne fait qu'une comparaison de chaînes par article. Avant (mesure du 2026-11-21), chaque frappe
 * renormalisait tout le catalogue (NFD + suppression des accents) et relisait chaque quantité.
 */
type Searchable = { name: string; sku: string | null; variantLabel: string; categoryId: string | null; onHand: string };
export type CatalogEntry<T extends Searchable> = { item: T; key: string; inStock: boolean };

export const normalizeSearch = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

export function indexCatalog<T extends Searchable>(items: readonly T[]): CatalogEntry<T>[] {
  return items.map((item) => ({ item, key: normalizeSearch(`${item.name} ${item.sku ?? ""} ${item.variantLabel}`), inStock: (parseQuantityInput(item.onHand) ?? 0n) > 0n }));
}

/** Articles en stock, de la catégorie choisie, dont le nom, la référence ou la variante contient la recherche. */
export function filterCatalog<T extends Searchable>(index: readonly CatalogEntry<T>[], search: string, categoryId: string): T[] {
  const needle = normalizeSearch(search.trim());
  const result: T[] = [];
  for (const entry of index) {
    if (entry.inStock && (!categoryId || entry.item.categoryId === categoryId) && (!needle || entry.key.includes(needle))) result.push(entry.item);
  }
  return result;
}
