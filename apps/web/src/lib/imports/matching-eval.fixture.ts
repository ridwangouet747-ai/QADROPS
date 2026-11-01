import type { CatalogEntry } from "./adapt";

/*
 * Jeu d'évaluation du rapprochement (mission 11, phase 3). SYNTHÉTIQUE : écrit à la main d'après les catalogues
 * visés (quincaillerie, alimentation générale, téléphonie, vêtements), sans aucune donnée de client réel.
 * Il ne remplace pas une évaluation sur de vrais fichiers de commerçants (voir docs/imports.md).
 * `expected` : clé du produit attendu, ou null si la ligne décrit un produit absent du catalogue.
 */

export const EVAL_CATALOG: CatalogEntry[] = [
  ["ciment50", "Ciment CIMAF 50 kg", "CIM50"], ["ciment25", "Ciment CIMAF 25 kg", null], ["tole3", "Tôle ondulée 3 m", null], ["tole2", "Tôle ondulée 2 m", null],
  ["fer8", "Fer à béton 8 mm", null], ["fer10", "Fer à béton 10 mm", null], ["pointe10", "Pointes 10 cm", null], ["pointe5", "Pointes 5 cm", null],
  ["peinture5", "Peinture blanche 5 L", null], ["peinture20", "Peinture blanche 20 L", null], ["brouette", "Brouette renforcée", null], ["pelle", "Pelle ronde", null],
  ["pvc100", "Tuyau PVC 100", null], ["pvc50", "Tuyau PVC 50", null], ["robinet", "Robinet laiton 1/2", null], ["cable", "Câble électrique 2,5 mm²", null],
  ["ampoule", "Ampoule LED 9 W", null], ["cadenas", "Cadenas 40 mm", null], ["riz", "Riz parfumé 25 kg", null], ["huile", "Huile végétale 5 L", null],
  ["sucre", "Sucre en morceaux 1 kg", null], ["savon", "Savon de Marseille", null], ["lait", "Lait en poudre 400 g", null], ["chargeur", "Chargeur USB-C 20 W", null],
  ["ecouteurs", "Écouteurs Bluetooth", null], ["coque", "Coque iPhone 13", null], ["carte", "Carte mémoire 32 Go", null], ["tecno", "Tecno Spark 10", null],
  ["tshirt", "T-shirt coton blanc M", null], ["pagne", "Pagne wax 6 yards", null], ["riz_ar", "أرز 25 كغ", null], ["sucre_ar", "سكر 1 كغ", null],
].map(([variantId, name, sku]) => ({ variantId: variantId!, name: name!, sku: sku ?? null, aliases: variantId === "savon" ? ["Savon Marseille"] : [] }));

export type EvalCase = { input: string; sku?: string; expected: string | null; kind: "same" | "variant_spelling" | "different" };

export const EVAL_CASES: EvalCase[] = [
  // Même produit, écrit autrement (casse, accents, espaces, unités collées, alias, référence).
  { input: "CIMENT CIMAF 50KG", expected: "ciment50", kind: "same" }, { input: "ciment cimaf 50 kg ", expected: "ciment50", kind: "same" },
  { input: "Tole ondulee 3 m", expected: "tole3", kind: "same" }, { input: "Fer a beton 8 mm", expected: "fer8", kind: "same" },
  { input: "POINTES 10 CM", expected: "pointe10", kind: "same" }, { input: "Peinture Blanche 20 L", expected: "peinture20", kind: "same" },
  { input: "Brouette renforcee", expected: "brouette", kind: "same" }, { input: "Câble électrique 2.5 mm²", expected: "cable", kind: "same" },
  { input: "Savon marseille", expected: "savon", kind: "same" }, { input: "أرز 25 كغ", expected: "riz_ar", kind: "same" },
  { input: "سكر ١ كغ", expected: "sucre_ar", kind: "same" }, { input: "Sac ciment", sku: "cim50", expected: "ciment50", kind: "same" },
  { input: "Ampoule led 9w", expected: "ampoule", kind: "same" }, { input: "Riz parfume 25 kg", expected: "riz", kind: "same" },
  { input: "Huile vegetale 5l", expected: "huile", kind: "same" }, { input: "Sucre en morceaux 1kg", expected: "sucre", kind: "same" },
  { input: "Lait en poudre 400g", expected: "lait", kind: "same" }, { input: "Coque iphone 13", expected: "coque", kind: "same" },
  { input: "Carte memoire 32 go", expected: "carte", kind: "same" }, { input: "TECNO SPARK 10", expected: "tecno", kind: "same" },
  { input: "Pagne Wax 6 Yards", expected: "pagne", kind: "same" }, { input: "Pelle ronde", expected: "pelle", kind: "same" },
  { input: "Cadenas 40mm", expected: "cadenas", kind: "same" }, { input: "Robinet laiton 1/2", expected: "robinet", kind: "same" },
  { input: "Chargeur USB C 20W", expected: "chargeur", kind: "same" },
  // Même produit, orthographe ou formulation différente : une proposition est attendue, jamais une certitude imposée.
  { input: "Tôles ondulées 3 m", expected: "tole3", kind: "variant_spelling" }, { input: "Ciment Cimaf 50 kgs", expected: "ciment50", kind: "variant_spelling" },
  { input: "Fers à béton 10 mm", expected: "fer10", kind: "variant_spelling" }, { input: "Pointe 5 cm", expected: "pointe5", kind: "variant_spelling" },
  { input: "Peintures blanches 5 L", expected: "peinture5", kind: "variant_spelling" }, { input: "Brouette renforcé", expected: "brouette", kind: "variant_spelling" },
  { input: "Tuyau P.V.C 100", expected: "pvc100", kind: "variant_spelling" }, { input: "Ecouteur bluetooth", expected: "ecouteurs", kind: "variant_spelling" },
  { input: "Tshirt coton blanc M", expected: "tshirt", kind: "variant_spelling" }, { input: "Savon de marseile", expected: "savon", kind: "variant_spelling" },
  { input: "Huile vegetal 5 L", expected: "huile", kind: "variant_spelling" }, { input: "Lait poudre 400 g", expected: "lait", kind: "variant_spelling" },
  { input: "Riz parfumé 25kg sac", expected: "riz", kind: "variant_spelling" }, { input: "Cadenas 40 mm laiton", expected: "cadenas", kind: "variant_spelling" },
  { input: "Ampoules LED 9 W", expected: "ampoule", kind: "variant_spelling" },
  // Produits différents, souvent très proches à l'écrit : aucun rattachement ne doit être imposé.
  { input: "Ciment CIMAF 35 kg", expected: null, kind: "different" }, { input: "Tôle ondulée 4 m", expected: null, kind: "different" },
  { input: "Fer à béton 12 mm", expected: null, kind: "different" }, { input: "Pointes 8 cm", expected: null, kind: "different" },
  { input: "Peinture bleue 5 L", expected: null, kind: "different" }, { input: "Tuyau PVC 75", expected: null, kind: "different" },
  { input: "Ampoule LED 12 W", expected: null, kind: "different" }, { input: "Carte mémoire 64 Go", expected: null, kind: "different" },
  { input: "Tecno Spark 20", expected: null, kind: "different" }, { input: "Coque iPhone 14", expected: null, kind: "different" },
  { input: "T-shirt coton noir M", expected: null, kind: "different" }, { input: "Pagne wax 12 yards", expected: null, kind: "different" },
  { input: "Marteau", expected: null, kind: "different" }, { input: "Clé à molette", expected: null, kind: "different" },
  { input: "Huile moteur 5 L", expected: null, kind: "different" }, { input: "Sucre en poudre 1 kg", expected: null, kind: "different" },
  { input: "Savon liquide", expected: null, kind: "different" }, { input: "Écouteurs filaires", expected: null, kind: "different" },
  { input: "أرز 5 كغ", expected: null, kind: "different" }, { input: "Lait concentré 400 g", expected: null, kind: "different" },
  { input: "Chargeur USB-C 65 W", expected: null, kind: "different" }, { input: "Robinet laiton 3/4", expected: null, kind: "different" },
  { input: "Pelle carrée", expected: null, kind: "different" },
];
