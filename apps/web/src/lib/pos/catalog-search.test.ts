import { describe, expect, it } from "vitest";
import { filterCatalog, indexCatalog } from "./catalog-search";

const item = (name: string, overrides: Partial<{ sku: string | null; variantLabel: string; categoryId: string | null; onHand: string }> = {}) =>
  ({ name, sku: null, variantLabel: "Standard", categoryId: null, onHand: "5", ...overrides });

describe("recherche de la caisse", () => {
  const catalog = [
    item("Câble électrique", { sku: "CAB-25", categoryId: "elec" }),
    item("Clou acier", { variantLabel: "10 mm", categoryId: "quinc" }),
    item("Ciment", { onHand: "0" }),
    item("Écouteurs", { onHand: "0.5" }),
  ];
  const index = indexCatalog(catalog);

  it("ignore accents et casse, cherche aussi dans la référence et la variante", () => {
    expect(filterCatalog(index, "cable", "").map((p) => p.name)).toEqual(["Câble électrique"]);
    expect(filterCatalog(index, "  ECOUTEURS ", "").map((p) => p.name)).toEqual(["Écouteurs"]);
    expect(filterCatalog(index, "cab-25", "").map((p) => p.name)).toEqual(["Câble électrique"]);
    expect(filterCatalog(index, "10 mm", "").map((p) => p.name)).toEqual(["Clou acier"]);
  });

  it("n'affiche que les articles en stock, de la catégorie choisie, dans l'ordre du catalogue", () => {
    expect(filterCatalog(index, "", "").map((p) => p.name)).toEqual(["Câble électrique", "Clou acier", "Écouteurs"]);
    expect(filterCatalog(index, "", "quinc").map((p) => p.name)).toEqual(["Clou acier"]);
    expect(filterCatalog(index, "ciment", "")).toEqual([]);
  });

  it("rend les objets d'origine (le panier garde la même référence d'article)", () => {
    expect(filterCatalog(index, "clou", "")[0]).toBe(catalog[1]);
  });
});
