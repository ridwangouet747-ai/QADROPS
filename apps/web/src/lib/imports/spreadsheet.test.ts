import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cellText, IMPORT_LIMITS, parseCsv, readSpreadsheet } from "./spreadsheet";

/** Archive ZIP minimale (méthode deflate) ; `declaredSize` permet de simuler une archive qui ment sur ses tailles. */
function zip(files: { name: string; content: string | Buffer; declaredSize?: number }[]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.content);
    const compressed = deflateRawSync(data);
    const name = Buffer.from(file.name);
    const size = file.declaredSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    central.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

type SheetCell = string | number | null;
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const column = (index: number) => String.fromCharCode(65 + index);

/** Classeur XLSX minimal (chaînes partagées, nombres bruts), une ou plusieurs feuilles. */
function xlsx(sheets: { name: string; rows: SheetCell[][] }[], extra: { name: string; content: string | Buffer; declaredSize?: number }[] = []) {
  const strings: string[] = [];
  const sheetXml = sheets.map((sheet) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      if (value === null) return "";
      const ref = `${column(c)}${r + 1}`;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    }).join("")}</row>`).join("")}</sheetData></worksheet>`);
  const ns = "http://schemas.openxmlformats.org";
  return zip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    ...sheetXml.map((content, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content })),
    { name: "xl/sharedStrings.xml", content: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${ns}/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("")}</sst>` },
    ...extra,
  ]);
}

const texts = (rows: { cells: unknown[] }[]) => rows.map((row) => row.cells.map((cell) => cellText(cell as never)));

describe("lecture CSV", () => {
  it("lit un CSV Excel français (point-virgule, Windows-1252) en gardant les numéros de ligne d'origine", async () => {
    const bytes = Buffer.from("Désignation;Prix\r\nTôle ondulée;4 000\r\n;\r\nCiment;5500\r\n", "latin1");
    const sheet = await readSpreadsheet(bytes);
    expect(sheet.fileType).toBe("csv");
    expect(texts(sheet.rows)).toEqual([["Désignation", "Prix"], ["Tôle ondulée", "4 000"], ["Ciment", "5500"]]);
    expect(sheet.rows.map((row) => row.number)).toEqual([1, 2, 4]);
  });

  it("gère BOM UTF-8, guillemets, séparateurs et retours à la ligne entre guillemets", async () => {
    const sheet = await readSpreadsheet(Buffer.from("﻿Nom,Note\n\"Clou, 5 cm\",\"dit \"\"petit\"\"\nlivré\"\n", "utf8"));
    expect(texts(sheet.rows)).toEqual([["Nom", "Note"], ["Clou, 5 cm", "dit \"petit\" livré"]]);
  });

  it("lit l'arabe en UTF-16 (export « Texte Unicode » d'Excel, tabulations)", async () => {
    const text = "﻿الاسم\tالسعر\nأرز\t١٢٠٠\n";
    const sheet = await readSpreadsheet(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.slice(1), "utf16le")]));
    expect(texts(sheet.rows)).toEqual([["الاسم", "السعر"], ["أرز", "١٢٠٠"]]);
  });

  it("un CSV mal formé (lignes de longueurs inégales, guillemet non fermé) est lu sans planter ni inventer de cellule", async () => {
    const sheet = await readSpreadsheet(Buffer.from("Nom;Prix;Stock\nA;1\nB;2;3;4\nC;\"3\n", "utf8"));
    expect(sheet.columnCount).toBe(4);
    expect(texts(sheet.rows)).toEqual([["Nom", "Prix", "Stock"], ["A", "1"], ["B", "2", "3", "4"], ["C", "3"]]);
    expect(parseCsv("a;b\n\"x;y\";z")).toEqual([["a", "b"], ["x;y", "z"]]);
  });

  it("tronque une cellule trop longue au lieu de la stocker telle quelle", async () => {
    const sheet = await readSpreadsheet(Buffer.from(`Nom\n${"x".repeat(5000)}\n`));
    expect(cellText(sheet.rows[1]!.cells[0])).toHaveLength(IMPORT_LIMITS.cellChars);
  });

  it.each([
    ["vide", Buffer.alloc(0), "empty"],
    ["trop gros", Buffer.alloc(IMPORT_LIMITS.fileBytes + 1, 0x41), "too_large"],
    ["binaire", Buffer.from([0x41, 0x00, 0x42]), "binary"],
    ["ancien .xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "legacy_xls"],
    ["PDF", Buffer.from("%PDF-1.4\n"), "unsupported"],
    ["trop de lignes", Buffer.from(Array.from({ length: IMPORT_LIMITS.rows + 3 }, (_, i) => `Article ${i};${i}`).join("\n")), "too_many_rows"],
    ["trop de colonnes", Buffer.from(Array.from({ length: IMPORT_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(";")), "too_many_columns"],
    ["sans aucune cellule", Buffer.from(" ; ;\n;;\n"), "empty"],
  ])("refuse un fichier %s avec un code stable", async (_label, bytes, code) => {
    await expect(readSpreadsheet(bytes)).rejects.toMatchObject({ code });
  });
});

describe("lecture XLSX", () => {
  it("lit la première feuille remplie ; un nombre reste le texte du classeur, jamais un flottant arrondi", async () => {
    const bytes = xlsx([{ name: "Vide", rows: [] }, { name: "Stock", rows: [["Article", "Prix", "Qté"], ["Ciment", 5500, 12.5], ["Fil", 0.1, null]] }, { name: "Notes", rows: [["x"]] }]);
    const sheet = await readSpreadsheet(bytes);
    expect(sheet).toMatchObject({ fileType: "xlsx", sheetName: "Stock", otherSheets: 1, columnCount: 3 });
    expect(sheet.rows[1]!.cells).toEqual(["Ciment", { n: "5500" }, { n: "12.5" }]);
    expect(sheet.rows[2]!.cells).toEqual(["Fil", { n: "0.1" }]);
  });

  it("refuse un classeur à macros, sans l'ouvrir", async () => {
    await expect(readSpreadsheet(xlsx([{ name: "S", rows: [["a"]] }], [{ name: "xl/vbaProject.bin", content: Buffer.alloc(16) }]))).rejects.toMatchObject({ code: "macros" });
  });

  it("refuse une bombe de décompression, même quand l'archive ment sur la taille", async () => {
    const huge = Buffer.alloc(IMPORT_LIMITS.unzippedBytes + 1024, 0x20);
    await expect(readSpreadsheet(xlsx([{ name: "S", rows: [["a"]] }], [{ name: "xl/media/a.xml", content: huge }]))).rejects.toMatchObject({ code: "too_large" });
    await expect(readSpreadsheet(xlsx([{ name: "S", rows: [["a"]] }], [{ name: "xl/media/a.xml", content: huge, declaredSize: 10 }]))).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuse une archive tronquée ou une archive ZIP qui n'est pas un classeur", async () => {
    const bytes = xlsx([{ name: "S", rows: [["a"]] }]);
    await expect(readSpreadsheet(bytes.subarray(0, bytes.length - 30))).rejects.toMatchObject({ code: "corrupt" });
    await expect(readSpreadsheet(zip([{ name: "photo.jpg", content: "x" }]))).rejects.toMatchObject({ code: "unsupported" });
  });
});
