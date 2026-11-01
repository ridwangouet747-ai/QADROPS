import { describe, expect, it } from "vitest";
import {
  duplicateRows, evaluateRow, inferMapping, matchProduct, normalizeText, parseQuantity, parseXof, prepareCatalog, rowStatus, widerRows, type ColumnMapping,
} from "./adapt";
import { EVAL_CASES, EVAL_CATALOG } from "./matching-eval.fixture";
import type { Cell, SourceRow } from "./spreadsheet";

const rows = (...lines: Cell[][]): SourceRow[] => lines.map((cells, index) => ({ number: index + 1, cells }));
const fields = (mapping: ColumnMapping[]) => mapping.map((entry) => entry.field);

describe("Adapt : normalisation", () => {
  it("compare sans accents, casse, ponctuation ni unités collées, et unifie les graphies arabes", () => {
    expect(normalizeText("Tôle ONDULÉE 3m")).toBe("tole ondulee 3 m");
    expect(normalizeText("Câble 2,5 mm²")).toBe("cable 2 5 mm 2");
    expect(normalizeText("إسمنت ٥٠ كغ")).toBe(normalizeText("اسمنت 50 كغ"));
    expect(normalizeText("سُكَّر")).toBe("سكر");
    expect(normalizeText("مكتبة")).toBe(normalizeText("مكتبه"));
  });
});

describe("Adapt : montants XOF", () => {
  it.each([
    ["5500", "5500"], ["5 500", "5500"], ["5 500 F CFA", "5500"], ["12.500", "12500"], ["1.250.000", "1250000"], ["12 500,00", "12500"],
    ["١٢٠٠", "1200"], ["2500 FCFA", "2500"],
  ])("« %s » vaut %s", (input, value) => expect(parseXof(input)).toEqual({ value, issue: null }));

  it.each([["2,5", "ambiguous"], ["12.5", "ambiguous"], ["12,5O0", "unreadable"], ["environ 3000", "unreadable"], ["-500", "negative"]])(
    "« %s » n'est jamais deviné : %s", (input, issue) => expect(parseXof(input)).toEqual({ value: null, issue }));

  it("lit un nombre de classeur sans flottant ; une décimale non nulle reste à trancher", () => {
    expect(parseXof({ n: "5500" })).toEqual({ value: "5500", issue: null });
    expect(parseXof({ n: "5500.00" })).toEqual({ value: "5500", issue: null });
    expect(parseXof({ n: "99.5" })).toEqual({ value: null, issue: "ambiguous" });
    expect(parseXof(undefined)).toEqual({ value: null, issue: null });
  });
});

describe("Adapt : quantités", () => {
  it.each([["12", "12"], ["12 sacs", "12"], ["2,5", "2.5"], ["1 250", "1250"], ["0,500 kg", null], ["12.50", "12.5"], ["٣", "3"]])("« %s » → %s", (input, value) => {
    const parsed = parseQuantity(input);
    if (value === null) expect(parsed.issue).toBe("ambiguous"); else expect(parsed).toEqual({ value, issue: null });
  });
  it("« 1,250 » peut valoir 1,25 ou 1 250 : signalé comme ambigu", () => expect(parseQuantity("1,250")).toEqual({ value: null, issue: "ambiguous" }));
  it("refuse les quantités négatives ou illisibles", () => {
    expect(parseQuantity("-3").issue).toBe("negative");
    expect(parseQuantity("douze").issue).toBe("unreadable");
    expect(parseQuantity({ n: "3.1234567" }).issue).toBe("unreadable");
  });
});

describe("Adapt : colonnes", () => {
  it("reconnaît les titres français, anglais et arabes", () => {
    expect(inferMapping(rows(["Désignation", "P.V", "Qté", "Unité", "Réf", "Famille", "Prix d'achat"], ["Ciment", "5500", "3", "sac", "C1", "Gros œuvre", "4800"]), 7).mapping
      .map((entry) => [entry.field, entry.confidence])).toEqual([["name", "certain"], ["salePrice", "certain"], ["quantity", "certain"], ["unit", "certain"], ["sku", "certain"], ["category", "certain"], ["cost", "certain"]]);
    expect(fields(inferMapping(rows(["Item", "Selling price", "Qty"], ["Rice", "1200", "4"]), 3).mapping)).toEqual(["name", "salePrice", "quantity"]);
    expect(fields(inferMapping(rows(["اسم المنتج", "سعر البيع", "الكمية"], ["أرز", "١٢٠٠", "٤"]), 3).mapping)).toEqual(["name", "salePrice", "quantity"]);
  });

  it("« Prix » seul est probable : le commerçant doit confirmer qu'il s'agit du prix de vente", () => {
    expect(inferMapping(rows(["Article", "Prix"], ["Seau", "1500"]), 2).mapping[1]).toMatchObject({ field: "salePrice", confidence: "probable" });
  });

  it("sans titres, déduit le nom, l'unité et la référence par les valeurs, mais ne devine jamais une colonne de nombres", () => {
    const { headerIndex, mapping } = inferMapping(rows(
      ["Ciment CIMAF 50 kg", "sac", "CIM-50", "5500", "12"], ["Tôle ondulée 3 m", "pièce", "TOL-3", "4000", "40"], ["Pointes 10 cm", "kg", "PT-10", "1500", "8"],
    ), 5);
    expect(headerIndex).toBeNull();
    expect(mapping.map((entry) => [entry.field, entry.confidence])).toEqual([["name", "probable"], ["unit", "probable"], ["sku", "probable"], [null, null], [null, null]]);
  });

  it("deux colonnes pour un même champ : la plus sûre est gardée, l'autre reste à choisir", () => {
    expect(fields(inferMapping(rows(["Prix", "Prix de vente", "Article"], ["1", "2", "x"]), 3).mapping)).toEqual([null, "salePrice", "name"]);
  });
});

describe("Adapt : lignes", () => {
  const catalog = prepareCatalog([{ variantId: "v-tole", name: "Tôle ondulée 3 m", sku: null, aliases: [] }, { variantId: "v-ciment", name: "Ciment 50 kg", sku: "C50", aliases: [] }]);
  const mapping: ColumnMapping[] = [
    { column: 0, header: "Nom", field: "name", confidence: "certain" }, { column: 1, header: "Prix", field: "salePrice", confidence: "certain" },
    { column: 2, header: "Qté", field: "quantity", confidence: "certain" },
  ];

  it("ne rattache d'office qu'une correspondance certaine ; un nom proche pose une question", () => {
    expect(evaluateRow(["Ciment 50 kg", "5500", "3"], mapping, {}, catalog, null)).toMatchObject({ decision: "match", decisionSource: "auto", matchVariantId: "v-ciment" });
    const close = evaluateRow(["Tôles ondulées 3 m", "4000", ""], mapping, {}, catalog, null);
    expect(close).toMatchObject({ decision: null, matchVariantId: null });
    expect(close.issues).toContain("match_needed");
    expect(rowStatus(close.issues, close.decision)).toBe("needs_review");
    expect(evaluateRow(["Brouette", "25000", ""], mapping, {}, catalog, null)).toMatchObject({ decision: "create", decisionSource: "auto" });
  });

  it("garde toujours la décision du commerçant et ses corrections, sans toucher à la cellule d'origine", () => {
    const cells: Cell[] = ["Tôles ondulées 3 m", "4,5", ""];
    const user = { decision: "create" as const, decisionSource: "user" as const, matchVariantId: null };
    const before = evaluateRow(cells, mapping, {}, catalog, user);
    expect(before.decision).toBe("create");
    expect(rowStatus(before.issues, before.decision)).toBe("invalid");
    const after = evaluateRow(cells, mapping, { salePrice: "4500" }, catalog, user);
    expect(after.values.salePriceXof).toBe("4500");
    expect(rowStatus(after.issues, after.decision)).toBe("ready");
    expect(cells[1]).toBe("4,5");
  });

  it("un prix illisible bloque une création mais pas un rattachement à un produit existant", () => {
    const row = evaluateRow(["Ciment 50 kg", "cinq mille", "2"], mapping, {}, catalog, null);
    expect(row.issues).toContain("price_unreadable");
    expect(rowStatus(row.issues, "match")).toBe("ready");
    expect(rowStatus(row.issues, "create")).toBe("invalid");
  });

  it("repère une ligne plus large que le fichier (milliers « 1,250 » sans guillemets) et attend une décision", () => {
    const sheet = rows(["Article", "Prix", "Qté"], ["Ciment", "5500", "3"], ["Savon", "1", "250", "3"], ["Seau", "1500", "", ""], ["Clou", "100"]);
    expect([...widerRows(sheet.map((row) => ({ rowNumber: row.number, cells: row.cells })), 1)]).toEqual([3]);
    // Une colonne de notes déclarée dans les titres n'est pas un décalage, même si peu de lignes la remplissent.
    const notes = rows(["Article", "Prix", "Qté", "Note"], ["Ciment", "5500", "3"], ["Savon", "1250", "3", "promo"]);
    expect(widerRows(notes.map((row) => ({ rowNumber: row.number, cells: row.cells })), 1).size).toBe(0);
    expect(rowStatus(["extra_cells"], "create")).toBe("needs_review");
  });

  it("signale les doublons après la première occurrence, ignorées comprises", () => {
    const values = (name: string, sku: string | null = null) => ({ name, sku });
    expect([...duplicateRows([
      { rowNumber: 2, values: values("Pointes 10 cm"), decision: "create", matchVariantId: null },
      { rowNumber: 3, values: values("POINTES 10cm"), decision: "create", matchVariantId: null },
      { rowNumber: 4, values: values("Clou", "X1"), decision: "skip", matchVariantId: null },
      { rowNumber: 5, values: values("Clou acier", "X1"), decision: "create", matchVariantId: null },
      { rowNumber: 6, values: values("Ciment"), decision: "match", matchVariantId: "v-ciment" },
      { rowNumber: 7, values: values("Ciment gris"), decision: "match", matchVariantId: "v-ciment" },
    ])]).toEqual([3, 7]);
  });
});

describe("Adapt : jeu d'essai annoté du rapprochement (synthétique)", () => {
  const catalog = prepareCatalog(EVAL_CATALOG);
  const results = EVAL_CASES.map((item) => ({ item, result: matchProduct(catalog, item.input, item.sku ?? null) }));
  const top = (entry: (typeof results)[number]) => entry.result.candidates[0]?.variantId ?? null;
  const certain = results.filter((entry) => entry.result.level === "certain");
  const proposals = results.filter((entry) => entry.result.level === "probable" || entry.result.level === "ambiguous");

  it("aucun faux rapprochement certain : seul « certain » est appliqué sans question", () => {
    expect(certain.filter((entry) => top(entry) !== entry.item.expected)).toEqual([]);
    expect(results.filter((entry) => entry.item.expected === null && entry.result.level === "certain")).toEqual([]);
  });

  it("mesures publiées dans docs/imports.md (régression si elles se dégradent)", () => {
    const metrics = {
      cases: results.length,
      certainCorrect: certain.filter((entry) => top(entry) === entry.item.expected).length,
      proposalsCorrect: proposals.filter((entry) => top(entry) === entry.item.expected).length,
      proposalsWrong: proposals.filter((entry) => top(entry) !== entry.item.expected).length,
      missed: results.filter((entry) => entry.item.expected !== null && entry.result.level === "none").length,
      correctlyNew: results.filter((entry) => entry.item.expected === null && entry.result.level === "none").length,
    };
    expect(metrics).toEqual({ cases: 63, certainCorrect: 25, proposalsCorrect: 15, proposalsWrong: 1, missed: 0, correctlyNew: 22 });
    // La seule fausse proposition connue : deux peintures de couleurs différentes, à rejeter par le commerçant.
    expect(proposals.filter((entry) => top(entry) !== entry.item.expected).map((entry) => entry.item.input)).toEqual(["Peinture bleue 5 L"]);
  });
});
