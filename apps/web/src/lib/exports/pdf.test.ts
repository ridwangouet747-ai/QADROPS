import { describe, expect, it } from "vitest";
import { fitText, hasUnsupportedCharacters, PdfPage, renderPdf, textWidth, toWinAnsi, wrapText } from "./pdf";

function sampleDocument() {
  const first = new PdfPage();
  first.text("Rapport commercial", 42, 800, { size: 16, bold: true });
  first.text("Chiffre d’affaires : 12 500 F CFA (dépenses « transport »)", 42, 780);
  first.text("1 250", 550, 760, { align: "right" });
  first.line(42, 750, 550, 750);
  const second = new PdfPage();
  second.text("Page 2 (suite) \\ fin", 42, 800);
  return renderPdf([first, second], { title: "Rapport 2026-10-01 2026-10-31" });
}

describe("PDF minimal sans dépendance", () => {
  it("commence par l'en-tête %PDF- et finit par %%EOF", () => {
    const pdf = sampleDocument();
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdf.subarray(-6).toString("latin1")).toBe("%%EOF\n");
  });

  it("contient le texte (encodage WinAnsi, parenthèses et barres échappées)", () => {
    const pdf = sampleDocument().toString("latin1");
    expect(pdf).toContain("(Rapport commercial) Tj");
    // « ’ » = 0x92 (\222), « é » = 0xE9 (\351), « « » = 0xAB (\253) en WinAnsi.
    expect(pdf).toContain("(Chiffre d\\222affaires : 12 500 F CFA \\(d\\351penses \\253 transport \\273\\)) Tj");
    expect(pdf).toContain("(Page 2 \\(suite\\) \\\\ fin) Tj");
    expect(pdf).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(pdf).toContain("/Count 2");
  });

  it("a une table de références croisées exacte (chaque décalage pointe sur son objet)", () => {
    const pdf = sampleDocument().toString("latin1");
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = pdf.slice(xrefAt).split("\n").slice(3).filter((line) => / 00000 n $/.test(line));
    entries.forEach((line, index) => {
      const offset = Number(line.slice(0, 10));
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
    expect(entries.length).toBe(Number(/\/Size (\d+)/.exec(pdf)![1]) - 1);
    // Longueur des flux exacte.
    for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = match.index! + match[0].length;
      expect(pdf.slice(start + Number(match[1]), start + Number(match[1]) + "\nendstream".length)).toBe("\nendstream");
    }
  });

  it("signale honnêtement les caractères arabes non affichables", () => {
    expect(hasUnsupportedCharacters("Boutique Awa")).toBe(false);
    expect(hasUnsupportedCharacters("Prix ? 12 €")).toBe(false);
    expect(hasUnsupportedCharacters("متجر")).toBe(true);
    expect(toWinAnsi("متجر")).toEqual([0x3f, 0x3f, 0x3f, 0x3f]);
    // Espace fine insécable et isolants bidirectionnels (formatXof) : convertis, pas remplacés par « ? ».
    expect(toWinAnsi("\u20661\u202F250 F CFA\u2069")).toEqual([...Buffer.from("1\u00A0250 F CFA", "latin1")]);
  });

  it("mesure, coupe et replie le texte selon les chasses Helvetica", () => {
    expect(textWidth("0000", 10)).toBeCloseTo(22.24);
    expect(textWidth("W", 10, true)).toBeCloseTo(9.44);
    expect(textWidth("é", 10)).toBe(textWidth("e", 10));
    const cut = fitText("Ciment Dangote 50 kg sac renforcé", 60, 10);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, 10)).toBeLessThanOrEqual(60);
    const lines = wrapText("Les ventes sont datées à leur enregistrement, les paiements à leur confirmation.", 150, 9);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 9)).toBeLessThanOrEqual(150);
  });
});
