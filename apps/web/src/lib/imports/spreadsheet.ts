import { inflateRawSync } from "node:zlib";
import readXlsxFile from "read-excel-file/node";

/*
 * Qadr Capture, lecture déterministe (mission 11, phase 3, décision D-03) : CSV et XLSX lus sur le serveur,
 * sans service externe. Le fichier est une donnée non fiable : type vérifié par son contenu, tailles bornées,
 * archive XLSX inspectée avant décompression, classeur à macros refusé. Rien n'est jamais évalué : une
 * formule ou une macro reste du texte.
 */

export const IMPORT_LIMITS = {
  fileBytes: 2 * 1024 * 1024,
  rows: 1000,
  columns: 30,
  cellChars: 300,
  // XLSX : taille décompressée totale et nombre d'entrées de l'archive (protection contre les « bombes zip »).
  unzippedBytes: 25 * 1024 * 1024,
  zipEntries: 300,
} as const;

/** Cellule lue : texte tel qu'écrit, ou nombre « machine » d'un classeur (point décimal, sans séparateur de milliers). */
export type Cell = string | { n: string };
export type SourceRow = { number: number; cells: Cell[] };
export type Spreadsheet = { fileType: "csv" | "xlsx"; sheetName: string | null; otherSheets: number; columnCount: number; rows: SourceRow[] };

export class SpreadsheetError extends Error {
  constructor(readonly code: "empty" | "too_large" | "unsupported" | "legacy_xls" | "macros" | "too_many_rows" | "too_many_columns" | "corrupt" | "binary", message: string) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

export const cellText = (cell: Cell | undefined) => (cell === undefined ? "" : typeof cell === "string" ? cell : cell.n);

const clean = (value: string) => value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim().slice(0, IMPORT_LIMITS.cellChars);

export async function readSpreadsheet(bytes: Buffer): Promise<Spreadsheet> {
  if (bytes.length === 0) throw new SpreadsheetError("empty", "Le fichier est vide.");
  if (bytes.length > IMPORT_LIMITS.fileBytes) throw new SpreadsheetError("too_large", "Le fichier dépasse 2 Mo.");
  // Type reconnu par le contenu, jamais par l'extension.
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return readXlsx(bytes);
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new SpreadsheetError("legacy_xls", "Ancien format Excel (.xls) : enregistrez le fichier en .xlsx ou en CSV, puis réessayez.");
  }
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    throw new SpreadsheetError("unsupported", "Les PDF ne sont pas encore lus. Envoyez un fichier CSV ou Excel (.xlsx).");
  }
  return readCsv(bytes);
}

/* ------------------------------------------------------------------ CSV */

function decodeText(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  if (body.includes(0)) throw new SpreadsheetError("binary", "Ce fichier n'est ni un CSV ni un classeur Excel (.xlsx).");
  // Excel français enregistre souvent ses CSV en Windows-1252 : on ne l'utilise que si l'UTF-8 est invalide.
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { return new TextDecoder("windows-1252").decode(body); }
}

/** Séparateur le plus régulier sur les premières lignes, hors guillemets : `;` (Excel en français), `,`, tabulation ou `|`. */
function detectDelimiter(text: string) {
  const sample = text.split(/\r\n|\n|\r/).filter((line) => line.trim()).slice(0, 20);
  let best = { delimiter: ",", score: -1 };
  for (const delimiter of [";", ",", "\t", "|"]) {
    const counts = sample.map((line) => {
      let count = 0, quoted = false;
      for (const char of line) { if (char === "\"") quoted = !quoted; else if (char === delimiter && !quoted) count += 1; }
      return count;
    });
    const used = counts.filter((count) => count > 0);
    if (!used.length) continue;
    const mode = [...new Set(used)].map((value) => [value, used.filter((count) => count === value).length] as const).sort((a, b) => b[1] - a[1])[0]!;
    const score = mode[1] * 10 + mode[0];
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** Analyseur RFC 4180 : guillemets doublés, retours à la ligne entre guillemets, fins de ligne CRLF, LF ou CR. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  const pushRow = () => { row.push(field); rows.push(row); row = []; field = ""; };
  while (i < text.length) {
    const char = text[i]!;
    if (quoted) {
      if (char === "\"" && text[i + 1] === "\"") { field += "\""; i += 2; continue; }
      if (char === "\"") { quoted = false; i += 1; continue; }
      field += char; i += 1; continue;
    }
    if (char === "\"" && field.trim() === "") { field = ""; quoted = true; i += 1; continue; }
    if (char === delimiter) { row.push(field); field = ""; i += 1; continue; }
    if (char === "\r" || char === "\n") { pushRow(); i += char === "\r" && text[i + 1] === "\n" ? 2 : 1; continue; }
    field += char; i += 1;
  }
  if (field !== "" || row.length) pushRow();
  return rows;
}

function readCsv(bytes: Buffer): Spreadsheet {
  const text = decodeText(bytes);
  return { fileType: "csv", sheetName: null, otherSheets: 0, ...collectRows(parseCsv(text).map((cells) => cells.map((cell) => clean(cell)))) };
}

/* ------------------------------------------------------------------ XLSX */

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

/** Lit le répertoire central de l'archive sans rien décompresser : entrées, tailles déclarées, emplacements. */
export function inspectZip(bytes: Buffer): ZipEntry[] {
  const minEnd = Math.max(0, bytes.length - 0xffff - 22);
  let end = -1;
  for (let i = bytes.length - 22; i >= minEnd; i -= 1) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new SpreadsheetError("corrupt", "Le classeur est endommagé ou incomplet.");
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > bytes.length) {
    throw new SpreadsheetError("corrupt", "Le classeur est endommagé ou dans un format non pris en charge.");
  }
  if (count > IMPORT_LIMITS.zipEntries) throw new SpreadsheetError("too_large", "Le classeur contient trop d'éléments.");
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new SpreadsheetError("corrupt", "Le classeur est endommagé ou incomplet.");
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    entries.push({
      name: bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      method: bytes.readUInt16LE(offset + 10), compressedSize: bytes.readUInt32LE(offset + 20),
      size: bytes.readUInt32LE(offset + 24), localOffset: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.some((entry) => entry.size === 0xffffffff || entry.compressedSize === 0xffffffff)
    || entries.reduce((total, entry) => total + entry.size, 0) > IMPORT_LIMITS.unzippedBytes) {
    throw new SpreadsheetError("too_large", "Le classeur est trop volumineux une fois décompressé.");
  }
  return entries;
}

/**
 * Les tailles du répertoire central sont déclaratives : une archive piégée peut mentir. On décompresse donc
 * chaque entrée avec un plafond réel avant de confier le fichier à la bibliothèque de lecture.
 */
function assertInflatedSize(bytes: Buffer, entries: ZipEntry[]) {
  let total = 0;
  for (const entry of entries) {
    const local = entry.localOffset;
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new SpreadsheetError("corrupt", "Le classeur est endommagé ou incomplet.");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + entry.compressedSize);
    if (raw.length !== entry.compressedSize) throw new SpreadsheetError("corrupt", "Le classeur est endommagé ou incomplet.");
    if (entry.method !== 0 && entry.method !== 8) throw new SpreadsheetError("unsupported", "Ce classeur utilise une compression non prise en charge.");
    let size = raw.length;
    if (entry.method === 8) {
      try { size = inflateRawSync(raw, { maxOutputLength: IMPORT_LIMITS.unzippedBytes - total + 1 }).length; } catch {
        throw new SpreadsheetError("too_large", "Le classeur est trop volumineux une fois décompressé.");
      }
    }
    total += size;
    if (total > IMPORT_LIMITS.unzippedBytes) throw new SpreadsheetError("too_large", "Le classeur est trop volumineux une fois décompressé.");
  }
}

async function readXlsx(bytes: Buffer): Promise<Spreadsheet> {
  const entries = inspectZip(bytes);
  if (entries.some((entry) => /vbaProject.bin$/i.test(entry.name))) {
    throw new SpreadsheetError("macros", "Ce classeur contient des macros : enregistrez-le sans macros (.xlsx) ou en CSV, puis réessayez.");
  }
  if (!entries.some((entry) => entry.name === "xl/workbook.xml")) throw new SpreadsheetError("unsupported", "Ce fichier n'est pas un classeur Excel (.xlsx).");
  assertInflatedSize(bytes, entries);
  let sheets;
  try {
    // Un nombre reste le texte enregistré dans le classeur (« 12500 », « 2.5 ») : jamais de nombre flottant.
    sheets = await readXlsxFile<{ n: string }>(bytes, { parseNumber: (value) => ({ n: value }), trim: false });
  } catch {
    throw new SpreadsheetError("corrupt", "Le classeur est endommagé ou illisible.");
  }
  // Première feuille qui contient quelque chose ; les autres sont signalées, jamais lues en silence.
  const filled = sheets.filter((sheet) => sheet.data.some((row) => row.some((value) => value !== null && value !== "")));
  const first = filled[0];
  if (!first) throw new SpreadsheetError("empty", "Le classeur ne contient aucune ligne remplie.");
  const rows = first.data.map((row) => row.map((value): Cell => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object" && "n" in value) return { n: value.n };
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
    return clean(String(value));
  }));
  return { fileType: "xlsx", sheetName: first.sheet.slice(0, 100), otherSheets: filled.length - 1, ...collectRows(rows) };
}

/* ------------------------------------------------------------------ Commun */

function collectRows(raw: Cell[][]): Pick<Spreadsheet, "columnCount" | "rows"> {
  const rows: SourceRow[] = [];
  let columnCount = 0;
  raw.forEach((cells, index) => {
    let last = cells.length - 1;
    while (last >= 0 && cellText(cells[last]) === "") last -= 1;
    if (last < 0) return;
    columnCount = Math.max(columnCount, last + 1);
    rows.push({ number: index + 1, cells: cells.slice(0, last + 1) });
  });
  if (!rows.length) throw new SpreadsheetError("empty", "Le fichier ne contient aucune ligne remplie.");
  if (columnCount > IMPORT_LIMITS.columns) throw new SpreadsheetError("too_many_columns", `Le fichier a plus de ${IMPORT_LIMITS.columns} colonnes.`);
  if (rows.length > IMPORT_LIMITS.rows + 1) throw new SpreadsheetError("too_many_rows", `Le fichier a plus de ${IMPORT_LIMITS.rows} lignes : découpez-le en plusieurs fichiers.`);
  return { columnCount, rows };
}
