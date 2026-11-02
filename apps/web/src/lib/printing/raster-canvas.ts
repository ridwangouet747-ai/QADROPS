"use client";

import { logoSize, logoBitmap, toMonochrome, rgbaToGray, type MonoBitmap } from "./raster";
import { encodeRasterTicket, encodeTicketText, type TicketBlock, type TicketLayout } from "./receipt-ticket";
import type { CodePage, PaperWidth } from "./profiles";

/*
 * Rendu en image dans le navigateur (mission 11, phase 5). Le navigateur sait mettre en forme l'arabe
 * (formes contextuelles, sens de lecture) et décoder PNG, JPEG et WebP ; le serveur, sans dépendance,
 * ne le sait pas. Ce module ne fait que dessiner la mise en page reçue du serveur : aucun montant n'y est
 * calculé. Les octets produits passent ensuite par le même service local que le mode texte.
 *
 * Non vérifié sur une imprimante réelle (blocage B-2), ni par les tests automatiques (pas de canvas dans
 * Vitest) : la conversion en 1 bit et les commandes GS v 0 sont, elles, testées (`raster.ts`, `escpos.ts`).
 */

export type TicketProfile = { paperWidthMm: PaperWidth; dots: number; columns: number; codePage: CodePage };
export class RenderError extends Error {
  constructor(readonly code: "raster_unavailable" | "too_large") { super(code); }
}

/** Limite du service local (1 Mio d'octets ESC/POS par tâche). */
const MAX_BYTES = 1024 * 1024;

function canvas2d(width: number, height: number) {
  if (typeof document === "undefined") throw new RenderError("raster_unavailable");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new RenderError("raster_unavailable");
  return context;
}

/** Logo du commerce (adresse de données PNG/JPEG/WebP validée à l'enregistrement) → image 1 bit à la largeur du papier. */
export async function decodeLogo(dataUrl: string, dots: number): Promise<MonoBitmap | null> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return null;
    // Le navigateur réduit l'image directement à sa taille finale (lissage de qualité) avant le passage en 1 bit.
    const size = logoSize({ width: image.naturalWidth, height: image.naturalHeight }, dots);
    const context = canvas2d(size.width, size.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size.width, size.height);
    return logoBitmap(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height, dots);
  } catch {
    return null;
  }
}

type Op = { y: number; height: number; draw?: (context: CanvasRenderingContext2D) => void; logo?: boolean };

/** Dessine la mise en page (texte, paires, filets) ; l'emplacement du logo est réservé puis rempli en 1 bit tramé. */
export function renderLayoutBitmap(layout: TicketLayout, profile: TicketProfile, logo: MonoBitmap | null): MonoBitmap {
  const width = profile.dots;
  const margin = 6;
  const base = profile.dots <= 384 ? 22 : 26;
  const rtl = layout.direction === "rtl";
  const family = rtl ? "\"Segoe UI\", Tahoma, \"Noto Naskh Arabic\", \"Noto Sans Arabic\", \"Geeza Pro\", Arial, sans-serif" : "Arial, \"Helvetica Neue\", Helvetica, sans-serif";
  const font = (block: { bold?: boolean; size?: "normal" | "tall" }) => `${block.bold ? "700" : "400"} ${block.size === "tall" ? Math.round(base * 1.35) : base}px ${family}`;
  const lineHeight = (block: { size?: "normal" | "tall" }) => Math.round((block.size === "tall" ? base * 1.35 : base) * 1.35);
  const measure = canvas2d(8, 8);
  measure.direction = layout.direction;
  const wrapText = (text: string, maxWidth: number) => {
    const lines: string[] = [];
    let current = "";
    for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure.measureText(candidate).width <= maxWidth) { current = candidate; continue; }
      if (current) lines.push(current);
      current = word;
      while (measure.measureText(current).width > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && measure.measureText(current.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(current.slice(0, cut)); current = current.slice(cut);
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };
  const startX = rtl ? width - margin : margin;
  const endX = rtl ? margin : width - margin;

  const ops: Op[] = [];
  let y = 0;
  const push = (height: number, draw?: Op["draw"], isLogo = false) => { ops.push({ y, height, draw, logo: isLogo }); y += height; };
  for (const block of layout.blocks as TicketBlock[]) {
    if (block.type === "logo") { if (logo) push(logo.height + 8, undefined, true); continue; }
    if (block.type === "cut") continue;
    if (block.type === "feed") { push(lineHeight({}) * block.lines); continue; }
    if (block.type === "rule") {
      push(Math.round(lineHeight({}) / 2) + 6, (context) => {
        context.setLineDash(block.char === "=" ? [] : [6, 4]); context.lineWidth = block.char === "=" ? 3 : 2;
        context.beginPath(); context.moveTo(margin, 0); context.lineTo(width - margin, 0); context.stroke();
      });
      continue;
    }
    measure.font = font(block);
    const height = lineHeight(block);
    if (block.type === "text") {
      for (const line of wrapText(block.text, width - 2 * margin)) push(height, (context) => {
        context.font = font(block); context.textAlign = block.align === "center" ? "center" : "start";
        context.fillText(line, block.align === "center" ? width / 2 : startX, 0);
      });
      continue;
    }
    const indent = block.indent ? 18 : 0;
    const endWidth = measure.measureText(block.end).width;
    const startLines = wrapText(block.start, Math.max(40, width - 2 * margin - indent - endWidth - 12));
    startLines.forEach((line, index) => push(height, (context) => {
      context.font = font(block);
      context.textAlign = "start";
      context.fillText(line, rtl ? startX - indent : startX + indent, 0);
      if (index === startLines.length - 1) { context.textAlign = "end"; context.fillText(block.end, endX, 0); }
    }));
  }

  const totalHeight = Math.max(1, Math.ceil(y));
  const context = canvas2d(width, totalHeight);
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, totalHeight);
  context.fillStyle = "#000"; context.strokeStyle = "#000";
  context.direction = layout.direction;
  context.textBaseline = "middle";
  for (const op of ops) {
    if (!op.draw) continue;
    context.save(); context.translate(0, op.y + op.height / 2); op.draw(context); context.restore();
  }
  const black = toMonochrome(rgbaToGray(context.getImageData(0, 0, width, totalHeight).data, width, totalHeight), "threshold", 150);
  const bytesPerRow = width / 8;
  const data = new Uint8Array(bytesPerRow * totalHeight);
  for (let index = 0; index < black.length; index += 1) if (black[index]) data[Math.floor(index / width) * bytesPerRow + ((index % width) >> 3)]! |= 0x80 >> (index % width & 7);
  const logoOp = ops.find((op) => op.logo);
  if (logo && logoOp) data.set(logo.data, (logoOp.y + 4) * bytesPerRow);
  return { width, height: totalHeight, data };
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Octets à envoyer au service local. Mode texte : ceux du serveur, ou les mêmes recomposés avec le logo
 * tramé (un logo illisible est simplement omis). Mode image : tout le ticket rendu ici.
 */
export async function bytesForPrinter(prepared: { render: "text" | "raster"; layout: TicketLayout; profile: TicketProfile; payload: string | null }) {
  const logo = prepared.layout.logo ? await decodeLogo(prepared.layout.logo, prepared.profile.dots) : null;
  if (prepared.render === "text") {
    if (!logo) { if (!prepared.payload) throw new RenderError("raster_unavailable"); return prepared.payload; }
    return toBase64(encodeTicketText(prepared.layout, prepared.profile, { logo }).bytes);
  }
  const bytes = encodeRasterTicket(renderLayoutBitmap(prepared.layout, prepared.profile, logo));
  if (bytes.length > MAX_BYTES) throw new RenderError("too_large");
  return toBase64(bytes);
}
