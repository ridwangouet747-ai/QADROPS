import { describe, expect, it } from "vitest";
import { csvCell, csvDocument, isPlainNumber, looksLikeFormula } from "./csv";

describe("csvCell : neutralisation des formules (X-1)", () => {
  it("laisse les nombres négatifs et décimaux en nombres (régression X-1)", () => {
    expect(csvCell("-1250")).toBe(`"-1250"`);
    expect(csvCell("-3.5")).toBe(`"-3.5"`);
    expect(csvCell("12.500000")).toBe(`"12.500000"`);
    expect(csvCell("0")).toBe(`"0"`);
    expect(csvCell(-42n)).toBe(`"-42"`);
    expect(csvCell(7)).toBe(`"7"`);
  });

  it("neutralise =, +, -, @, tabulation et retour chariot en tête de texte", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+33 6 12 34 56 78")).toBe(`"'+33 6 12 34 56 78"`);
    expect(csvCell("-cmd|' /C calc'!A0")).toBe(`"'-cmd|' /C calc'!A0"`);
    expect(csvCell("@SUM(A1:A9)")).toBe(`"'@SUM(A1:A9)"`);
    expect(csvCell("\t=1+1")).toBe(`"'\t=1+1"`);
    expect(csvCell("\r=1+1")).toBe(`"'\r=1+1"`);
    expect(csvCell("  =1+1")).toBe(`"'  =1+1"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("-1e5")).toBe(`"'-1e5"`);
    expect(csvCell("＝1+1")).toBe(`"'＝1+1"`);
  });

  it("n'altère pas un texte ordinaire et double les guillemets", () => {
    expect(csvCell('Ciment "Dangote"')).toBe(`"Ciment ""Dangote"""`);
    expect(csvCell("Riz 5 kg")).toBe(`"Riz 5 kg"`);
    expect(csvCell("أرز")).toBe(`"أرز"`);
    expect(csvCell(null)).toBe(`""`);
  });

  it("distingue un nombre simple d'une formule", () => {
    expect(isPlainNumber("-0.25")).toBe(true);
    expect(isPlainNumber("1 000")).toBe(false);
    expect(looksLikeFormula("-0.25")).toBe(false);
    expect(looksLikeFormula("-")).toBe(true);
  });

  it("produit un document avec BOM UTF-8 et fins de ligne CRLF", () => {
    expect(csvDocument([["Produit", "Écart"], ["=HACK()", "-2"]])).toBe(`\uFEFF"Produit","Écart"\r\n"'=HACK()","-2"`);
  });
});
