import { codePageSelector, paperProfiles, type CodePage, type PaperWidth } from "./profiles";
import type { MonoBitmap } from "./raster";

/*
 * Moteur ESC/POS pur (mission 10 ; profils et images en mission 11, phase 5) : aucune dépendance, aucun
 * accès matériel. Il produit des octets que le service local d'impression transmet tels quels. Commandes du
 * jeu ESC/POS standard (Epson TM-T20/T82 et compatibles « 58/80 mm » génériques) : ESC @, ESC a, ESC E,
 * GS !, ESC t, GS v 0, GS V, DLE EOT.
 *
 * Texte : page de codes du profil (PC858 par défaut, ESC t 19), qui couvre les accents français. Un
 * caractère hors de la page (arabe, emoji…) est remplacé par « ? » et compté : le profil bascule alors le
 * ticket en image (voir `chooseRender`). Aucune de ces commandes n'a été vérifiée sur une imprimante réelle.
 */

export type { PaperWidth };
/** Colonnes de la police A (12×24) : 384 points en 58 mm, 576 points en 80 mm. */
export const columnsFor = (width: PaperWidth) => paperProfiles[width].columns;

const ESC = 0x1b, GS = 0x1d, LF = 0x0a, DLE = 0x10, EOT = 0x04;

/* PC858 : octets 0x80 à 0xFF (0xD5 = € à la place du ı de PC850). */
const cp858High = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
const cp858 = new Map<string, number>([...cp858High].map((char, index) => [char, 0x80 + index]));
/* PC850 : identique à PC858, sauf 0xD5 = ı (pas d'euro). */
const cp850 = new Map<string, number>([...[...cp858].filter(([char]) => char !== "€"), ["ı", 0xd5]]);
/* Windows-1252 : 0x80-0x9F propres à Windows (cinq positions vides), puis 0xA0-0xFF = Latin-1. */
const wpc1252Specials: [number, string][] = [[0x80, "€"], [0x82, "‚"], [0x83, "ƒ"], [0x84, "„"], [0x85, "…"], [0x86, "†"], [0x87, "‡"], [0x88, "ˆ"], [0x89, "‰"],
  [0x8a, "Š"], [0x8b, "‹"], [0x8c, "Œ"], [0x8e, "Ž"], [0x91, "‘"], [0x92, "’"], [0x93, "“"], [0x94, "”"], [0x95, "•"], [0x96, "–"], [0x97, "—"], [0x98, "˜"],
  [0x99, "™"], [0x9a, "š"], [0x9b, "›"], [0x9c, "œ"], [0x9e, "ž"], [0x9f, "Ÿ"]];
const wpc1252 = new Map<string, number>([...wpc1252Specials.map(([byte, char]) => [char, byte] as [string, number]),
  ...Array.from({ length: 0x60 }, (_, index) => [String.fromCodePoint(0xa0 + index), 0xa0 + index] as [string, number])]);
const tables: Record<CodePage, Map<string, number>> = { pc858: cp858, pc850: cp850, wpc1252 };
const substitutions: Record<string, string> = { "’": "'", "‘": "'", "“": "\"", "”": "\"", "–": "-", "—": "-", "…": "...", " ": " ", " ": " ", "œ": "oe", "Œ": "OE", "⁦": "", "⁩": "" };

/** Encode dans la page de codes (PC858 par défaut) ; `unsupported` compte les caractères remplacés par « ? ». */
export function encodeText(text: string, codePage: CodePage = "pc858") {
  const table = tables[codePage];
  const bytes: number[] = [];
  let unsupported = 0;
  for (const raw of text.normalize("NFC")) {
    const char = substitutions[raw] ?? raw;
    for (const piece of char) {
      const code = piece.codePointAt(0)!;
      if (code >= 0x20 && code < 0x7f) bytes.push(code);
      else if (table.has(piece)) bytes.push(table.get(piece)!);
      else if (code === 0x0a) bytes.push(LF);
      else { bytes.push(0x3f); unsupported += 1; }
    }
  }
  return { bytes, unsupported };
}

/** Coupe un texte en lignes de `width` colonnes, sans couper un mot quand c'est possible. */
export function wrap(text: string, width: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    let rest = word;
    while (rest.length > width) {
      if (current) { lines.push(current); current = ""; }
      lines.push(rest.slice(0, width)); rest = rest.slice(width);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= width) current = `${current} ${rest}`;
    else { lines.push(current); current = rest; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Texte à gauche et à droite sur une même ligne (le texte de gauche est replié si nécessaire). */
export function leftRight(left: string, right: string, width: number) {
  const room = Math.max(1, width - right.length - 1);
  const lines = wrap(left, room);
  const last = lines.pop()!;
  return [...lines, `${last}${" ".repeat(Math.max(1, width - last.length - right.length))}${right}`];
}

/**
 * Image en trame (GS v 0, mode normal) : une commande par bande d'au plus `bandHeight` lignes, car des
 * imprimantes à petite mémoire refusent une image haute d'un seul tenant. Chaque ligne fait `width / 8`
 * octets, bit de poids fort à gauche, 1 = point noir.
 */
export function rasterCommands(bitmap: MonoBitmap, bandHeight = 128) {
  const bytesPerRow = bitmap.width / 8;
  if (!Number.isInteger(bytesPerRow) || bitmap.height < 1 || bitmap.data.length !== bytesPerRow * bitmap.height) throw new Error("Image en trame mal formée.");
  const out: number[] = [];
  for (let top = 0; top < bitmap.height; top += bandHeight) {
    const rows = Math.min(bandHeight, bitmap.height - top);
    out.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    for (let index = top * bytesPerRow; index < (top + rows) * bytesPerRow; index += 1) out.push(bitmap.data[index]!);
  }
  return out;
}

/** Commande de coupe : avance puis coupe partielle (GS V 66 n) ; sans massicot, elle est ignorée. */
export const cutCommand = [GS, 0x56, 66, 3];
/** Initialisation (ESC @) puis page de codes (ESC t n). */
export const initCommands = (codePage: CodePage = "pc858") => [ESC, 0x40, ESC, 0x74, codePageSelector[codePage]];

export class EscPosBuilder {
  private bytes: number[];
  /** Lignes lisibles, identiques au ticket : sert à l'aperçu et aux tests. */
  readonly preview: string[] = [];
  unsupported = 0;
  constructor(readonly width: PaperWidth, readonly codePage: CodePage = "pc858") { this.bytes = initCommands(codePage); }
  get columns() { return columnsFor(this.width); }
  /** Image déjà à la largeur du papier : le centrage est fait dans l'image (ESC a est ignoré par certains modèles pour GS v 0). */
  image(bitmap: MonoBitmap, previewLabel = "[logo]") { this.bytes.push(...rasterCommands(bitmap)); this.preview.push(previewLabel); return this; }

  align(mode: "left" | "center" | "right") { this.bytes.push(ESC, 0x61, mode === "left" ? 0 : mode === "center" ? 1 : 2); return this; }
  bold(on: boolean) { this.bytes.push(ESC, 0x45, on ? 1 : 0); return this; }
  /** Double hauteur/largeur : la largeur double divise le nombre de colonnes par deux. */
  size(mode: "normal" | "tall" | "large") { this.bytes.push(GS, 0x21, mode === "normal" ? 0x00 : mode === "tall" ? 0x01 : 0x11); return this; }
  line(text = "") {
    const encoded = encodeText(text, this.codePage);
    this.unsupported += encoded.unsupported;
    this.bytes.push(...encoded.bytes, LF);
    this.preview.push(text);
    return this;
  }
  rule(char = "-") { return this.line(char.repeat(this.columns)); }
  feed(lines = 1) { for (let i = 0; i < lines; i += 1) { this.bytes.push(LF); this.preview.push(""); } return this; }
  /** Avance de 3 lignes puis coupe partielle (GS V 66 n) ; sans massicot, la commande est ignorée. */
  cut() { this.bytes.push(...cutCommand); this.preview.push("✂"); return this; }
  build() { return Uint8Array.from(this.bytes); }
}

/** Requête d'état temps réel (DLE EOT n) : 1 imprimante, 2 hors ligne, 4 papier. */
export const statusRequests = { printer: Uint8Array.from([DLE, EOT, 1]), offline: Uint8Array.from([DLE, EOT, 2]), paper: Uint8Array.from([DLE, EOT, 4]) };

export type PrinterState = { coverOpen: boolean | null; paperOut: boolean | null; paperLow: boolean | null; cutterError: boolean | null; offline: boolean | null };

/**
 * Lecture des octets d'état ESC/POS (bits 3 « hors ligne », 2 « couvercle ouvert », 3 « erreur de coupe »,
 * 2-3 « papier presque fini », 5-6 « papier absent »). Un octet absent donne `null` : l'imprimante ne
 * l'a pas communiqué, on n'invente rien.
 */
export function parseStatus(bytes: { printer?: number; offline?: number; paper?: number }): PrinterState {
  const valid = (value?: number) => value !== undefined && (value & 0x93) === 0x12;
  return {
    offline: valid(bytes.printer) ? Boolean(bytes.printer! & 0x08) : null,
    coverOpen: valid(bytes.offline) ? Boolean(bytes.offline! & 0x04) : null,
    cutterError: valid(bytes.offline) ? Boolean(bytes.offline! & 0x08) : null,
    paperLow: valid(bytes.paper) ? Boolean(bytes.paper! & 0x0c) : null,
    paperOut: valid(bytes.paper) ? Boolean(bytes.paper! & 0x60) : null,
  };
}
