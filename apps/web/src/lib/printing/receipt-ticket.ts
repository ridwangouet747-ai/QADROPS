import { EscPosBuilder, leftRight, wrap, type PaperWidth } from "./escpos";

/*
 * Modèles de tickets (mission 10) : à partir des données d'une vente déjà validée par le serveur, sans
 * rien inventer (un champ absent n'est pas imprimé). Montants XOF entiers, jamais de flottant.
 */

export type ReceiptInput = {
  business: { name: string; displayName?: string | null; phone: string | null; address: string | null; footer: string | null; timezone?: string | null };
  sale: { reference: string; occurredAt: Date | string; totalXof: bigint | string; subtotalXof?: bigint | string; discountXof?: bigint | string };
  lines: { name: string; variant: string; quantity: string; unitPriceXof: bigint | string; totalXof: bigint | string; lineDiscountXof?: bigint | string }[];
  payments: { method: string; amountXof: bigint | string; status: string }[];
};
export type TicketLanguage = "fr" | "en";

const labels = {
  fr: { receipt: "Ticket", date: "Date", subtotal: "Sous-total", discount: "Remise", total: "TOTAL", due: "Reste à payer", pending: "en attente", failed: "échoué",
    methods: { cash: "Espèces", wave: "Wave", orange_money: "Orange Money", mtn_momo: "MTN MoMo", other: "Autre" } as Record<string, string>,
    test: "Page de test Qadr Ops", testLine: "Si ce texte est lisible, l'imprimante fonctionne.", accents: "Accents : é è ê à â ç ù û ô ï ë œ € °", width: "Largeur" },
  en: { receipt: "Receipt", date: "Date", subtotal: "Subtotal", discount: "Discount", total: "TOTAL", due: "Still due", pending: "pending", failed: "failed",
    methods: { cash: "Cash", wave: "Wave", orange_money: "Orange Money", mtn_momo: "MTN MoMo", other: "Other" } as Record<string, string>,
    test: "Qadr Ops test page", testLine: "If you can read this, the printer works.", accents: "Accents: é è ê à â ç ù û ô ï ë œ € °", width: "Width" },
};

/** « 12 500 F » : groupes de trois chiffres séparés par une espace simple (lisible par toutes les imprimantes). */
export function formatAmount(value: bigint | string) {
  const amount = BigInt(value);
  const digits = (amount < 0n ? -amount : amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${amount < 0n ? "-" : ""}${digits} F`;
}

/** Quantité décimale exacte (« 2.500000 » → « 2,5 »). */
export function formatQuantity(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole},${trimmed}` : whole!;
}

function formatDate(value: Date | string, timeZone: string, language: TicketLanguage) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

export function buildReceiptTicket(input: ReceiptInput, width: PaperWidth, language: TicketLanguage = "fr") {
  const text = labels[language];
  const ticket = new EscPosBuilder(width);
  const columns = ticket.columns;
  const name = (input.business.displayName?.trim() || input.business.name).slice(0, 80);
  ticket.align("center").bold(true).size("tall");
  for (const line of wrap(name, columns)) ticket.line(line);
  ticket.size("normal").bold(false);
  if (input.business.address) for (const line of wrap(input.business.address, columns)) ticket.line(line);
  if (input.business.phone) ticket.line(input.business.phone);
  ticket.align("left").rule();
  for (const line of leftRight(text.receipt, input.sale.reference, columns)) ticket.line(line);
  for (const line of leftRight(text.date, formatDate(input.sale.occurredAt, input.business.timezone || "Africa/Abidjan", language), columns)) ticket.line(line);
  ticket.rule();
  for (const item of input.lines) {
    const label = item.variant && item.variant !== "Standard" ? `${item.name} (${item.variant})` : item.name;
    for (const line of wrap(label, columns)) ticket.line(line);
    for (const line of leftRight(`  ${formatQuantity(item.quantity)} x ${formatAmount(item.unitPriceXof)}`, formatAmount(item.totalXof), columns)) ticket.line(line);
    if (item.lineDiscountXof && BigInt(item.lineDiscountXof) > 0n) for (const line of leftRight(`  ${text.discount}`, formatAmount(-BigInt(item.lineDiscountXof)), columns)) ticket.line(line);
  }
  ticket.rule();
  const discount = input.sale.discountXof ? BigInt(input.sale.discountXof) : 0n;
  if (discount > 0n && input.sale.subtotalXof !== undefined) {
    for (const line of leftRight(text.subtotal, formatAmount(input.sale.subtotalXof), columns)) ticket.line(line);
    for (const line of leftRight(text.discount, formatAmount(-discount), columns)) ticket.line(line);
  }
  ticket.bold(true).size("tall");
  for (const line of leftRight(text.total, formatAmount(input.sale.totalXof), columns)) ticket.line(line);
  ticket.size("normal").bold(false);
  let confirmed = 0n;
  for (const payment of input.payments) {
    const status = payment.status === "pending" ? ` (${text.pending})` : payment.status === "failed" ? ` (${text.failed})` : "";
    if (payment.status === "confirmed") confirmed += BigInt(payment.amountXof);
    for (const line of leftRight(`${text.methods[payment.method] ?? payment.method}${status}`, formatAmount(payment.amountXof), columns)) ticket.line(line);
  }
  const due = BigInt(input.sale.totalXof) - confirmed;
  if (due > 0n) { ticket.bold(true); for (const line of leftRight(text.due, formatAmount(due), columns)) ticket.line(line); ticket.bold(false); }
  if (input.business.footer) { ticket.feed().align("center"); for (const line of wrap(input.business.footer, columns)) ticket.line(line); }
  ticket.feed(2).cut();
  return { bytes: ticket.build(), preview: ticket.preview, unsupportedCharacters: ticket.unsupported };
}

export function buildTestTicket(width: PaperWidth, businessName: string, language: TicketLanguage = "fr", now = new Date()) {
  const text = labels[language];
  const ticket = new EscPosBuilder(width);
  ticket.align("center").bold(true).size("tall").line(text.test).size("normal").bold(false);
  for (const line of wrap(businessName, ticket.columns)) ticket.line(line);
  ticket.line(formatDate(now, "Africa/Abidjan", language)).align("left").rule();
  for (const line of wrap(text.testLine, ticket.columns)) ticket.line(line);
  for (const line of wrap(text.accents, ticket.columns)) ticket.line(line);
  ticket.line(`${text.width} : ${width} mm / ${ticket.columns} col.`);
  ticket.line("1234567890".repeat(Math.ceil(ticket.columns / 10)).slice(0, ticket.columns)).rule("=").feed(2).cut();
  return { bytes: ticket.build(), preview: ticket.preview, unsupportedCharacters: ticket.unsupported };
}
