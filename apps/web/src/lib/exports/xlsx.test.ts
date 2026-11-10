import { inflateRawSync } from "node:zlib";
import readXlsxFile from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, decimalCell, DEFAULT_XLSX_LIMITS, excelDecimal, excelInteger, headingCell, integerCell, XlsxTooLargeError } from "./xlsx";

/** Lit les entrées d'une archive ZIP via son répertoire central (contrôle indépendant du générateur). */
function unzip(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(bytes.subarray(dataStart, dataStart + compressedSize)).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const sample = () => buildXlsx([
  {
    name: "Ventes",
    frozenRows: 1,
    columnWidths: [20, 12, 12],
    rows: [
      [headingCell("Produit"), headingCell("Montant"), headingCell("Écart")],
      ["=1+1", integerCell("12500"), decimalCell("-3.500000")],
      ["+33 6 00 00 00", integerCell(-1250n), decimalCell("0.125")],
      ["-cmd", integerCell("9007199254740993"), decimalCell("1234567890.1234567")],
      ["@SUM(A1)", null, ""],
      ["\tTabulation", integerCell("0"), decimalCell("100.000000")],
      ["Ciment <Dangote> & \"fils\"\u0001", integerCell("4000"), decimalCell("2")],
    ],
  },
  { name: "المبيعات", rightToLeft: true, rows: [[headingCell("المنتج")], ["أرز ٥ كغ"]] },
  { name: "Ventes", rows: [["doublon de nom"]] },
  { name: "Feuille/avec:des*caractères?interdits[très]longue", rows: [["x"]] },
]);

describe("classeur XLSX sans dépendance", () => {
  it("produit une archive ZIP valide avec les parties attendues", () => {
    const files = unzip(sample());
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml",
    ]);
    const workbook = files.get("xl/workbook.xml")!;
    expect(workbook).toContain(`<sheet name="Ventes" sheetId="1"`);
    expect(workbook).toContain(`<sheet name="المبيعات" sheetId="2"`);
    expect(workbook).toContain(`<sheet name="Ventes (2)" sheetId="3"`);
    expect(workbook).not.toMatch(/name="[^"]*[[\]:*?/\\][^"]*"/);
    expect(workbook.match(/<sheet name="Feuille[^"]*"/)![0].length - `<sheet name=""`.length).toBeLessThanOrEqual(31);
  });

  it("n'écrit aucune formule, garde les nombres en nombres et neutralise les textes dangereux", () => {
    const files = unzip(sample());
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    for (const content of files.values()) expect(content).not.toMatch(/<f[\s>]/);
    // Texte : chaîne en ligne, avec le style « préfixe apostrophe » (2) quand il ressemble à une formule.
    expect(sheet).toContain(`<c r="A2" t="inlineStr" s="2"><is><t xml:space="preserve">=1+1</t></is></c>`);
    expect(sheet).toContain(`<c r="A3" t="inlineStr" s="2">`);
    expect(sheet).toContain(`<c r="A4" t="inlineStr" s="2">`);
    expect(sheet).toContain(`<c r="A5" t="inlineStr" s="2">`);
    expect(sheet).toContain(`<c r="A6" t="inlineStr" s="2">`);
    // Nombres : entier XOF au format milliers, décimal exact sans zéros inutiles, négatif conservé.
    expect(sheet).toContain(`<c r="B2" s="3"><v>12500</v></c>`);
    expect(sheet).toContain(`<c r="C2"><v>-3.5</v></c>`);
    expect(sheet).toContain(`<c r="B3" s="3"><v>-1250</v></c>`);
    expect(sheet).toContain(`<c r="C6"><v>100</v></c>`);
    // Au-delà de la précision d'Excel : écrit en texte plutôt qu'arrondi en silence.
    expect(sheet).toContain(`<c r="B4" t="inlineStr"><is><t xml:space="preserve">9007199254740993</t></is></c>`);
    expect(sheet).toContain(`<c r="C4" t="inlineStr"><is><t xml:space="preserve">1234567890.1234567</t></is></c>`);
    // Caractères spéciaux XML échappés, caractère de contrôle retiré.
    expect(sheet).toContain("Ciment &lt;Dangote&gt; &amp; &quot;fils&quot;</t>");
    expect(sheet).not.toContain("\u0001");
    expect(sheet).toContain(`<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`);
  });

  it("déclare la feuille arabe de droite à gauche et garde le texte arabe intact", () => {
    const files = unzip(sample());
    const arabic = files.get("xl/worksheets/sheet2.xml")!;
    expect(arabic).toContain(`rightToLeft="1"`);
    expect(arabic).toContain("أرز ٥ كغ");
    expect(files.get("xl/worksheets/sheet1.xml")).not.toContain("rightToLeft");
  });

  it("se relit avec read-excel-file : textes en texte, nombres en nombres", async () => {
    const sheets = await readXlsxFile<{ n: string }>(sample(), { parseNumber: (value) => ({ n: value }), trim: false });
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Ventes", "المبيعات", "Ventes (2)", expect.stringMatching(/^Feuille/)]);
    const rows = sheets[0].data;
    expect(rows[0]).toEqual(["Produit", "Montant", "Écart"]);
    expect(rows[1]).toEqual(["=1+1", { n: "12500" }, { n: "-3.5" }]);
    expect(rows[2]).toEqual(["+33 6 00 00 00", { n: "-1250" }, { n: "0.125" }]);
    expect(rows[3][0]).toBe("-cmd");
    expect(rows[3][1]).toBe("9007199254740993");
    expect(sheets[1].data).toEqual([["المنتج"], ["أرز ٥ كغ"]]);
  });

  it("convertit les valeurs sans flottant intermédiaire", () => {
    expect(excelInteger("000123")).toBe("123");
    expect(excelInteger("-0")).toBe("0");
    expect(excelInteger("9007199254740991")).toBe("9007199254740991");
    expect(excelInteger("9007199254740992")).toBeNull();
    expect(excelInteger("12.5")).toBeNull();
    expect(excelDecimal("12.500000")).toBe("12.5");
    expect(excelDecimal("-0.000001")).toBe("-0.000001");
    expect(excelDecimal("0.000000")).toBe("0");
    expect(excelDecimal("123456789012345.6")).toBeNull();
    expect(excelDecimal("1e5")).toBeNull();
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });
});

describe("mission 16 : bornes de taille du classeur", () => {
  const bigSheet = (rows: number) => ({ name: "Grande", rows: Array.from({ length: rows }, (_, i) => [`Article ${i} ${"x".repeat(200)}`, integerCell(String(i))]) });

  it("s'arrête dès que le XML dépasse la borne, sans construire la suite", () => {
    let error: unknown;
    try { buildXlsx([bigSheet(1_000)], { maxXmlBytes: 10_000, maxFileBytes: DEFAULT_XLSX_LIMITS.maxFileBytes }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(XlsxTooLargeError);
    expect(error).toMatchObject({ limit: "xml_bytes", message: "xlsx.too_large" });
  });

  it("refuse un fichier compressé au-delà de la borne et accepte le même sous la borne", () => {
    const file = buildXlsx([bigSheet(200)]);
    expect(() => buildXlsx([bigSheet(200)], { maxXmlBytes: DEFAULT_XLSX_LIMITS.maxXmlBytes, maxFileBytes: file.length - 1 }))
      .toThrow(expect.objectContaining({ limit: "file_bytes" }));
    expect(buildXlsx([bigSheet(200)], { maxXmlBytes: DEFAULT_XLSX_LIMITS.maxXmlBytes, maxFileBytes: file.length }).equals(file)).toBe(true);
  });

  it("bornes par défaut : 64 Mio de XML, 4 Mio de fichier (réponse Vercel ≤ 4,5 Mo)", () => {
    expect(DEFAULT_XLSX_LIMITS).toEqual({ maxXmlBytes: 64 * 1024 * 1024, maxFileBytes: 4 * 1024 * 1024 });
  });
});
