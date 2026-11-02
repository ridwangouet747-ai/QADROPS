/*
 * Écriture PDF minimale, sans dépendance (mission 11, phase 4). Polices standard Helvetica et
 * Helvetica-Bold (présentes dans tout lecteur PDF, rien à embarquer), encodage WinAnsi.
 *
 * Portée honnête : le français et l'anglais s'affichent correctement (accents compris). L'arabe ne
 * peut pas l'être avec ces polices : il faudrait embarquer une police arabe et façonner les glyphes
 * (formes contextuelles, ordre bidirectionnel). Un caractère hors WinAnsi est remplacé par « ? ».
 * Voir docs/exports.md.
 */

// Chasses Adobe (AFM) des caractères ASCII 32 à 126, en millièmes de corps.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Caractères WinAnsi (CP1252) hors Latin-1 : code octet de chacun.
const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
const EXTRA_WIDTHS: Record<string, number> = { "€": 556, "…": 1000, "‘": 222, "’": 222, "“": 333, "”": 333, "•": 350, "–": 556, "—": 1000, "«": 556, "»": 556, "°": 400, "×": 584, "\u00A0": 278, "Œ": 1000, "œ": 944 };

/** Remplace les espaces fines et marques de direction (sans équivalent WinAnsi) avant l'encodage. */
function normalizeForWinAnsi(text: string) {
  return text.replace(/[\u202F\u2009\u2007]/g, "\u00A0").replace(/[\u2066-\u2069\u200E\u200F\u061C]/g, "").replace(/\u2212/g, "-");
}

/** Octet WinAnsi d'un caractère, `undefined` s'il n'en a pas ; les contrôles sont ignorés (`null`). */
function winAnsiByte(char: string): number | null | undefined {
  const code = char.codePointAt(0)!;
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  if (char in WIN_ANSI_EXTRA) return WIN_ANSI_EXTRA[char];
  if (code === 0x09) return 0x20;
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return null;
  return undefined;
}

/** Octets WinAnsi d'un texte ; un caractère non représentable devient « ? ». */
export function toWinAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const char of normalizeForWinAnsi(text)) {
    const byte = winAnsiByte(char);
    if (byte !== null) bytes.push(byte ?? 0x3f);
  }
  return bytes;
}

/** Vrai si le texte contient des caractères que les polices standard ne savent pas afficher (arabe, etc.). */
export function hasUnsupportedCharacters(text: string) {
  return [...normalizeForWinAnsi(text)].some((char) => winAnsiByte(char) === undefined);
}

function charWidth(char: string, bold: boolean) {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const code = char.codePointAt(0)!;
  if (code >= 32 && code <= 126) return table[code - 32];
  if (char in EXTRA_WIDTHS) return EXTRA_WIDTHS[char];
  // Lettre accentuée : même chasse que la lettre de base (é → e).
  const base = char.normalize("NFD")[0];
  const baseCode = base?.codePointAt(0) ?? 0;
  return baseCode >= 32 && baseCode <= 126 ? table[baseCode - 32] : 556;
}

/** Largeur d'un texte en points pour un corps donné. */
export function textWidth(text: string, size: number, bold = false) {
  let total = 0;
  for (const char of normalizeForWinAnsi(text)) total += charWidth(char, bold);
  return (total * size) / 1000;
}

/** Coupe un texte pour qu'il tienne dans une largeur, avec « … » s'il est tronqué. */
export function fitText(text: string, maxWidth: number, size: number, bold = false) {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length && textWidth(`${chars.join("")}…`, size, bold) > maxWidth) chars.pop();
  return `${chars.join("")}…`;
}

/** Découpe un paragraphe en lignes d'au plus `maxWidth` points. */
export function wrapText(text: string, maxWidth: number, size: number, bold = false) {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, bold) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.map((line) => fitText(line, maxWidth, size, bold));
}

function pdfString(text: string) {
  return `(${toWinAnsi(text).map((byte) => {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) return `\\${String.fromCharCode(byte)}`;
    if (byte < 0x20 || byte > 0x7e) return `\\${byte.toString(8).padStart(3, "0")}`;
    return String.fromCharCode(byte);
  }).join("")})`;
}

const format = (value: number) => (Math.round(value * 100) / 100).toString();

export type PdfColor = readonly [number, number, number];

/** Page A4 (595 × 842 points), origine en bas à gauche. */
export class PdfPage {
  readonly width = 595.28;
  readonly height = 841.89;
  private operations: string[] = [];

  text(text: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: PdfColor; align?: "left" | "right" } = {}) {
    const size = options.size ?? 10;
    const bold = options.bold ?? false;
    const left = options.align === "right" ? x - textWidth(text, size, bold) : x;
    const [r, g, b] = options.color ?? [0.07, 0.09, 0.15];
    this.operations.push(`BT /${bold ? "F2" : "F1"} ${format(size)} Tf ${format(r)} ${format(g)} ${format(b)} rg ${format(left)} ${format(y)} Td ${pdfString(text)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: PdfColor = [0.85, 0.87, 0.9], width = 0.6) {
    this.operations.push(`${format(color[0])} ${format(color[1])} ${format(color[2])} RG ${format(width)} w ${format(x1)} ${format(y1)} m ${format(x2)} ${format(y2)} l S`);
  }

  rect(x: number, y: number, width: number, height: number, color: PdfColor) {
    this.operations.push(`${format(color[0])} ${format(color[1])} ${format(color[2])} rg ${format(x)} ${format(y)} ${format(width)} ${format(height)} re f`);
  }

  content() {
    return this.operations.join("\n");
  }
}

/** Assemble les pages en un document PDF 1.4 (table de références croisées exacte, octet par octet). */
export function renderPdf(pages: readonly PdfPage[], info: { title: string }) {
  if (pages.length === 0) throw new Error("Un PDF doit contenir au moins une page.");
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pageTree = add("");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const page of pages) {
    const stream = Buffer.from(page.content(), "latin1");
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${format(page.width)} ${format(page.height)}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const infoId = add(`<< /Title ${pdfString(info.title)} /Producer (QADR OPS) >>`);

  // Le fichier est écrit en latin1 : chaque caractère de la chaîne est un octet, les décalages sont exacts.
  let output = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}
