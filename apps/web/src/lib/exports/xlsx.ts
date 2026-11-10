import { looksLikeFormula } from "./csv";
import { createZip } from "./zip";

/*
 * Classeur XLSX minimal (SpreadsheetML dans une archive ZIP), écrit en mémoire sans dépendance.
 *
 * Garanties (testées dans xlsx.test.ts) :
 * - aucune formule : le fichier ne contient jamais d'élément <f> ; tout texte est une chaîne en ligne
 *   (`inlineStr`), jamais évaluée. Un texte qui ressemble à une formule reçoit en plus le style
 *   « préfixe apostrophe » (`quotePrefix`) : il reste du texte même si l'on modifie la cellule dans Excel ;
 * - les nombres restent des nombres : un montant XOF entier est écrit tel quel (chaîne décimale venue de
 *   PostgreSQL, sans passer par un flottant côté serveur) ; une quantité décimale aussi, sans arrondi.
 *   Excel stocke ses nombres en double précision : au-delà de 15 chiffres significatifs (ou de
 *   2^53 − 1 pour un entier), la valeur est écrite en texte pour ne rien perdre en silence ;
 * - XML échappé, caractères interdits en XML 1.0 retirés (sinon Excel signale un fichier endommagé) ;
 * - feuille de droite à gauche (`rightToLeft`) pour l'arabe.
 */

export type XlsxCell =
  | string
  | { kind: "heading"; value: string }
  | { kind: "integer"; value: string | bigint }
  | { kind: "decimal"; value: string }
  | null
  | undefined;

export type XlsxSheet = {
  name: string;
  rows: readonly (readonly XlsxCell[])[];
  /** Largeur des colonnes, en caractères. */
  columnWidths?: readonly number[];
  /** Nombre de lignes figées en haut (en-têtes). */
  frozenRows?: number;
  rightToLeft?: boolean;
};

export const integerCell = (value: string | bigint): XlsxCell => ({ kind: "integer", value });
export const decimalCell = (value: string): XlsxCell => ({ kind: "decimal", value });
export const headingCell = (value: string): XlsxCell => ({ kind: "heading", value });

/** Limites du format (Excel) : 32 767 caractères par cellule, 31 par nom de feuille. */
const MAX_CELL_TEXT = 32_767;
const MAX_SHEET_NAME = 31;

const STYLE = { normal: 0, bold: 1, literal: 2, integer: 3, boldLiteral: 4 } as const;

/**
 * Bornes de taille (mission 16, docs/exports.md). `maxXmlBytes` borne la mémoire : le XML des feuilles est
 * compté ligne par ligne et la génération s'arrête dès le dépassement, sans construire la suite.
 * `maxFileBytes` borne le fichier compressé renvoyé (une fonction Vercel ne répond pas au-delà de 4,5 Mo).
 */
export type XlsxLimits = { maxXmlBytes: number; maxFileBytes: number };
export const DEFAULT_XLSX_LIMITS: XlsxLimits = { maxXmlBytes: 64 * 1024 * 1024, maxFileBytes: 4 * 1024 * 1024 };

/** Classeur trop volumineux : aucune donnée dans le message ; `limit` dit quelle borne est atteinte. */
export class XlsxTooLargeError extends Error {
  constructor(readonly limit: "xml_bytes" | "file_bytes") { super("xlsx.too_large"); this.name = "XlsxTooLargeError"; }
}

// Caractères interdits en XML 1.0 (contrôles, demi-paires de substitution isolées, U+FFFE/U+FFFF).
// Les caractères de contrôle sont précisément la cible : on les retire avant d'écrire le XML.
// eslint-disable-next-line no-control-regex
const invalidXml = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanXmlText(value: string) {
  return value.replace(invalidXml, "");
}

function escapeXml(value: string) {
  return cleanXmlText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/** Entier exact pour Excel, ou null s'il faut l'écrire en texte. */
export function excelInteger(value: string | bigint): string | null {
  if (typeof value === "string" && !/^-?\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > SAFE_INTEGER || parsed < -SAFE_INTEGER ? null : parsed.toString();
}

/** Décimal exact pour Excel (zéros inutiles retirés), ou null s'il dépasse 15 chiffres significatifs. */
export function excelDecimal(value: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const significant = `${whole}${fraction}`.replace(/^0+/, "");
  if (significant.length > 15) return null;
  if (significant === "") return "0";
  return `${match[1]}${whole}${fraction ? `.${fraction}` : ""}`;
}

function textCell(ref: string, value: string, bold: boolean) {
  const text = cleanXmlText(value).slice(0, MAX_CELL_TEXT);
  const literal = looksLikeFormula(text);
  const style = bold ? (literal ? STYLE.boldLiteral : STYLE.bold) : literal ? STYLE.literal : STYLE.normal;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function cellXml(cell: XlsxCell, ref: string) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell === "" ? "" : textCell(ref, cell, false);
  if (cell.kind === "heading") return textCell(ref, cell.value, true);
  if (cell.kind === "integer") {
    const number = excelInteger(cell.value);
    return number === null ? textCell(ref, String(cell.value), false) : `<c r="${ref}" s="${STYLE.integer}"><v>${number}</v></c>`;
  }
  const number = excelDecimal(cell.value);
  return number === null ? textCell(ref, cell.value, false) : `<c r="${ref}"><v>${number}</v></c>`;
}

function sheetName(raw: string, used: Set<string>) {
  const base = cleanXmlText(raw).replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, MAX_SHEET_NAME) || "Feuille";
  let name = base;
  for (let n = 2; used.has(name.toLocaleLowerCase()); n += 1) name = `${base.slice(0, MAX_SHEET_NAME - String(n).length - 3)} (${n})`;
  used.add(name.toLocaleLowerCase());
  return name;
}

function worksheetXml(sheet: XlsxSheet, selected: boolean, budget: { remaining: number }) {
  const frozen = sheet.frozenRows ?? 0;
  const pane = frozen > 0 ? `<pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  const view = `<sheetViews><sheetView workbookViewId="0"${sheet.rightToLeft ? ` rightToLeft="1"` : ""}${selected ? ` tabSelected="1"` : ""}>${pane}</sheetView></sheetViews>`;
  const cols = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(4, Math.min(80, width))}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const parts: string[] = [];
  for (const [r, row] of sheet.rows.entries()) {
    const xml = `<row r="${r + 1}">${row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join("")}</row>`;
    budget.remaining -= Buffer.byteLength(xml, "utf8");
    if (budget.remaining < 0) throw new XlsxTooLargeError("xml_bytes");
    parts.push(xml);
  }
  const rows = parts.join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006";

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Construit le classeur. La première feuille est celle qui s'ouvre. Lève `XlsxTooLargeError` au-delà des bornes. */
export function buildXlsx(sheets: readonly XlsxSheet[], limits: XlsxLimits = DEFAULT_XLSX_LIMITS) {
  if (sheets.length === 0) throw new Error("Un classeur doit contenir au moins une feuille.");
  const used = new Set<string>();
  const names = sheets.map((sheet) => sheetName(sheet.name, used));
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  const contentTypes = `${header}<Types xmlns="${NS_PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const rootRels = `${header}<Relationships xmlns="${NS_PKG}/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `${header}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${
    names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const workbookRels = `${header}<Relationships xmlns="${NS_PKG}/relationships">${
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
  }<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
  const budget = { remaining: limits.maxXmlBytes };
  const worksheets = sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: worksheetXml(sheet, i === 0, budget) }));
  const file = createZip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/styles.xml", content: STYLES },
    ...worksheets,
  ]);
  if (file.length > limits.maxFileBytes) throw new XlsxTooLargeError("file_bytes");
  return file;
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
