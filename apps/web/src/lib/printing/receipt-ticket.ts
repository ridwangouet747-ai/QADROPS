import { createTranslator } from "../i18n/translate";
import { cutCommand, EscPosBuilder, initCommands, leftRight, rasterCommands, wrap, type PaperWidth } from "./escpos";
import { resolveProfile, type PrinterProfile } from "./profiles";
import type { MonoBitmap } from "./raster";
import { buildReceiptDocument, formatAmount, formatQuantity, formatReceiptDate, type ReceiptDocument, type ReceiptLanguage, type ReceiptSource } from "./receipt-document";

/*
 * Mise en page du ticket thermique (mission 10, refondue en mission 11 phase 5).
 *
 * Un `ReceiptDocument` (montants déjà calculés par le serveur) devient une liste de blocs logiques
 * (texte, paire libellé/montant, filet, logo, coupe). Deux encodeurs les affichent sans rien calculer :
 * - `encodeTicketText` : ESC/POS en texte, repli à la largeur du profil (32 ou 48 colonnes) ;
 * - le rendu en image du navigateur (`raster-canvas.ts`), pour l'arabe, puis `encodeRasterTicket`.
 * Un champ absent n'est pas imprimé ; rien n'est inventé.
 */

export { formatAmount, formatQuantity };
export type ReceiptInput = ReceiptSource;
export type TicketLanguage = ReceiptLanguage;

type Style = { bold?: boolean; size?: "normal" | "tall" };
export type TicketBlock =
  | ({ type: "text"; text: string; align: "start" | "center" } & Style)
  | ({ type: "pair"; start: string; end: string; indent?: boolean } & Style)
  | { type: "rule"; char: "-" | "=" }
  | { type: "feed"; lines: number }
  | { type: "logo" }
  | { type: "cut" };
/** Ticket prêt à afficher : blocs, sens de lecture et logo éventuel (adresse de données déjà validée à l'enregistrement). */
export type TicketLayout = { language: ReceiptLanguage; direction: "ltr" | "rtl"; logo: string | null; blocks: TicketBlock[] };

/**
 * Isolation bidirectionnelle (LRI … PDI) des fragments de gauche à droite (montants, références, dates,
 * téléphones) dans un ticket en arabe : « 12 500 F » ne doit jamais se lire « F 500 12 ». Le mode texte
 * retire ces caractères invisibles (voir `encodeText`).
 */
const isolate = (direction: "ltr" | "rtl", value: string) => (direction === "rtl" ? `⁦${value}⁩` : value);

export function layoutReceipt(document: ReceiptDocument): TicketLayout {
  const { business, sale, labels, totals } = document;
  const ltr = (value: string) => isolate(document.direction, value);
  const amount = (value: bigint | string) => ltr(formatAmount(value));
  const blocks: TicketBlock[] = [];
  const text = (value: string, align: "start" | "center" = "start", style: Style = {}) => blocks.push({ type: "text", text: value, align, ...style });
  const pair = (start: string, end: string, style: Style & { indent?: boolean } = {}) => blocks.push({ type: "pair", start, end, ...style });
  if (business.logo) blocks.push({ type: "logo" });
  text(business.name, "center", { bold: true, size: "tall" });
  if (business.address) text(business.address, "center");
  for (const value of [business.phone, business.email]) if (value) text(ltr(value), "center");
  blocks.push({ type: "rule", char: "-" });
  if (sale.banner) { text(sale.banner, "center", { bold: true, size: "tall" }); blocks.push({ type: "rule", char: "-" }); }
  pair(labels.ticket, ltr(sale.reference));
  pair(labels.date, ltr(`${sale.dateText} ${sale.timeZoneLabel}`));
  // Nom du caissier en ligne de texte : c est un nom (parfois en arabe), pas une valeur à isoler de gauche à droite.
  if (sale.cashier) text(`${labels.cashier} : ${sale.cashier}`);
  blocks.push({ type: "rule", char: "-" });
  for (const line of document.lines) {
    text(line.label);
    pair(ltr(`${line.quantityText} x ${formatAmount(line.unitPriceXof)}`), amount(line.totalXof), { indent: true });
    if (line.lineDiscountXof) pair(labels.discount, amount(-BigInt(line.lineDiscountXof)), { indent: true });
  }
  blocks.push({ type: "rule", char: "-" });
  if (totals.subtotalXof && totals.discountXof) {
    pair(labels.subtotal, amount(totals.subtotalXof));
    pair(labels.discount, amount(-BigInt(totals.discountXof)));
  }
  pair(labels.total, amount(totals.totalXof), { bold: true, size: "tall" });
  for (const payment of document.payments) pair(payment.statusLabel ? `${payment.methodLabel} (${payment.statusLabel})` : payment.methodLabel, amount(payment.amountXof));
  // Total encaissé seulement s'il apporte une information : plusieurs paiements ou un reste à payer.
  if (document.payments.length > 1 || totals.dueXof || totals.changeXof) pair(labels.paid, amount(totals.paidXof));
  if (totals.tenderedXof && totals.changeXof) {
    pair(labels.tendered, amount(totals.tenderedXof));
    pair(labels.change, amount(totals.changeXof), { bold: true });
  }
  if (totals.dueXof) pair(labels.due, amount(totals.dueXof), { bold: true });
  // Statut en ligne de texte (pas une paire) : c'est un mot traduit, pas un montant à isoler.
  if (document.settlement) text(`${labels.settlement} : ${document.settlement}`, "center");
  if (business.footer) { blocks.push({ type: "feed", lines: 1 }); text(business.footer, "center"); }
  blocks.push({ type: "feed", lines: 2 }, { type: "cut" });
  return { language: document.language, direction: document.direction, logo: business.logo, blocks };
}

/** Page de test : vérifie la largeur, les accents (mode texte) ou l'écriture arabe (mode image). */
export function layoutTestTicket(input: { businessName: string; language: ReceiptLanguage; profile: Pick<PrinterProfile, "paperWidthMm" | "columns">; render: "text" | "raster"; now?: Date }): TicketLayout {
  const t = createTranslator(input.language);
  const date = formatReceiptDate(input.now ?? new Date(), "Africa/Abidjan");
  const direction = input.language === "ar" ? "rtl" : "ltr";
  const blocks: TicketBlock[] = [
    { type: "text", text: t("printing.receipt.testTitle"), align: "center", bold: true, size: "tall" },
    { type: "text", text: input.businessName, align: "center" },
    { type: "text", text: isolate(direction, `${date.text} ${date.zone}`), align: "center" },
    { type: "rule", char: "-" },
    { type: "text", text: t("printing.receipt.testLine"), align: "start" },
    { type: "text", text: t("printing.receipt.testCharacters"), align: "start" },
    { type: "text", text: t("printing.receipt.testWidth", { width: input.profile.paperWidthMm, columns: input.profile.columns }), align: "start" },
    { type: "text", text: t("printing.receipt.testMode", { mode: t(input.render === "raster" ? "printing.receipt.modeRaster" : "printing.receipt.modeText") }), align: "start" },
    { type: "text", text: "1234567890".repeat(Math.ceil(input.profile.columns / 10)).slice(0, input.profile.columns), align: "start" },
    { type: "rule", char: "=" },
    { type: "feed", lines: 2 },
    { type: "cut" },
  ];
  return { language: input.language, direction, logo: null, blocks };
}

/**
 * ESC/POS en texte. `logo` : image déjà réduite à 1 bit par le navigateur ; sans elle, le bloc logo est
 * simplement sauté (le ticket reste complet). Les caractères hors de la page de codes sortent en « ? » et
 * sont comptés : `chooseRender` bascule alors le ticket en image.
 */
export function encodeTicketText(layout: TicketLayout, profile: Pick<PrinterProfile, "paperWidthMm" | "codePage">, options: { logo?: MonoBitmap | null } = {}) {
  const ticket = new EscPosBuilder(profile.paperWidthMm, profile.codePage);
  const columns = ticket.columns;
  const state = { align: "left" as "left" | "center", bold: false, size: "normal" as "normal" | "tall" };
  const apply = (align: "left" | "center", style: Style) => {
    if (state.align !== align) { ticket.align(align); state.align = align; }
    if (state.bold !== Boolean(style.bold)) { ticket.bold(Boolean(style.bold)); state.bold = Boolean(style.bold); }
    const size = style.size ?? "normal";
    if (state.size !== size) { ticket.size(size); state.size = size; }
  };
  for (const block of layout.blocks) {
    if (block.type === "logo") { if (options.logo) { apply("left", {}); ticket.image(options.logo); } continue; }
    if (block.type === "text") { apply(block.align === "center" ? "center" : "left", block); for (const line of wrap(block.text, columns)) ticket.line(line); continue; }
    if (block.type === "pair") { apply("left", block); for (const line of leftRight(`${block.indent ? "  " : ""}${block.start}`, block.end, columns)) ticket.line(line); continue; }
    if (block.type === "rule") { apply("left", {}); ticket.rule(block.char); continue; }
    if (block.type === "feed") { ticket.feed(block.lines); continue; }
    ticket.cut();
  }
  return { bytes: ticket.build(), preview: ticket.preview, unsupportedCharacters: ticket.unsupported };
}

/** Ticket entièrement en image (arabe) : initialisation, bandes GS v 0, avance et coupe. */
export function encodeRasterTicket(bitmap: MonoBitmap) {
  return Uint8Array.from([...initCommands(), ...rasterCommands(bitmap), 0x0a, 0x0a, ...cutCommand]);
}

/** Compatibilité (mission 10) : vente → document → ticket texte, PC858. */
export function buildReceiptTicket(input: ReceiptInput, width: PaperWidth, language: TicketLanguage = "fr") {
  return encodeTicketText(layoutReceipt(buildReceiptDocument(input, { language })), resolveProfile({ paperWidthMm: width }));
}

export function buildTestTicket(width: PaperWidth, businessName: string, language: TicketLanguage = "fr", now = new Date()) {
  const profile = resolveProfile({ paperWidthMm: width });
  return encodeTicketText(layoutTestTicket({ businessName, language, profile, render: "text", now }), profile);
}
