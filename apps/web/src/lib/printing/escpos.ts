/*
 * Moteur ESC/POS pur (mission 10) : aucune dépendance, aucun accès matériel. Il produit des octets que le
 * service local d'impression transmet tels quels. Commandes du jeu ESC/POS standard (Epson TM-T20/T82
 * et compatibles « 58/80 mm » génériques) : ESC @, ESC a, ESC E, GS !, ESC t, GS V, DLE EOT.
 *
 * Texte : page de code PC858 (Europe de l'Ouest + €) sélectionnée par ESC t 19, ce qui couvre les accents
 * français. Un caractère hors de cette page (arabe, emoji…) est remplacé par « ? » et signalé : l'arabe
 * demande un rendu en image que ce moteur ne fait pas encore.
 */

export type PaperWidth = 58 | 80;
/** Colonnes de la police A (12×24) : 384 points en 58 mm, 576 points en 80 mm. */
export const columnsFor = (width: PaperWidth) => (width === 58 ? 32 : 48);

const ESC = 0x1b, GS = 0x1d, LF = 0x0a, DLE = 0x10, EOT = 0x04;

/* PC858 : octets 0x80 à 0xFF (0xD5 = € à la place du ı de PC850). */
const cp858High = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
const cp858 = new Map<string, number>([...cp858High].map((char, index) => [char, 0x80 + index]));
const substitutions: Record<string, string> = { "’": "'", "‘": "'", "“": "\"", "”": "\"", "–": "-", "—": "-", "…": "...", " ": " ", " ": " ", "œ": "oe", "Œ": "OE", "⁦": "", "⁩": "" };

/** Encode en PC858 ; `unsupported` compte les caractères remplacés par « ? ». */
export function encodeText(text: string) {
  const bytes: number[] = [];
  let unsupported = 0;
  for (const raw of text.normalize("NFC")) {
    const char = substitutions[raw] ?? raw;
    for (const piece of char) {
      const code = piece.codePointAt(0)!;
      if (code >= 0x20 && code < 0x7f) bytes.push(code);
      else if (cp858.has(piece)) bytes.push(cp858.get(piece)!);
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

export class EscPosBuilder {
  private bytes: number[] = [ESC, 0x40, ESC, 0x74, 19];
  /** Lignes lisibles, identiques au ticket : sert à l'aperçu et aux tests. */
  readonly preview: string[] = [];
  unsupported = 0;
  constructor(readonly width: PaperWidth) {}
  get columns() { return columnsFor(this.width); }

  align(mode: "left" | "center" | "right") { this.bytes.push(ESC, 0x61, mode === "left" ? 0 : mode === "center" ? 1 : 2); return this; }
  bold(on: boolean) { this.bytes.push(ESC, 0x45, on ? 1 : 0); return this; }
  /** Double hauteur/largeur : la largeur double divise le nombre de colonnes par deux. */
  size(mode: "normal" | "tall" | "large") { this.bytes.push(GS, 0x21, mode === "normal" ? 0x00 : mode === "tall" ? 0x01 : 0x11); return this; }
  line(text = "") {
    const encoded = encodeText(text);
    this.unsupported += encoded.unsupported;
    this.bytes.push(...encoded.bytes, LF);
    this.preview.push(text);
    return this;
  }
  rule(char = "-") { return this.line(char.repeat(this.columns)); }
  feed(lines = 1) { for (let i = 0; i < lines; i += 1) { this.bytes.push(LF); this.preview.push(""); } return this; }
  /** Avance de 3 lignes puis coupe partielle (GS V 66 n) ; sans massicot, la commande est ignorée. */
  cut() { this.bytes.push(GS, 0x56, 66, 3); this.preview.push("✂"); return this; }
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
