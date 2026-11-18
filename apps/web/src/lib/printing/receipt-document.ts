import { localeDirection, type Locale } from "../i18n/config";
import { createTranslator, type MessageKey } from "../i18n/translate";

/*
 * Modèle unique du ticket de vente (mission 11, phase 5, constats I-5 et I-6).
 *
 * Le serveur construit un `ReceiptDocument` à partir d'une vente déjà enregistrée (`getSaleReceipt`) :
 * libellés traduits, date au fuseau du commerce, montants déjà calculés (reste à payer, encaissé). Le ticket
 * à l'écran, le ticket ESC/POS en texte et le ticket en image se contentent de l'afficher : aucun rendu ne
 * recalcule un montant. Les montants restent des entiers XOF en chaînes, jamais des flottants.
 */

export type ReceiptLanguage = Locale;
const languages: readonly ReceiptLanguage[] = ["fr", "en", "ar"];
export const isReceiptLanguage = (value: unknown): value is ReceiptLanguage => typeof value === "string" && (languages as readonly string[]).includes(value);

/** Données d'une vente validée : sous-ensemble du résultat de `getSaleReceipt` (et des anciens tests du ticket). */
export type ReceiptSource = {
  business: { name: string; displayName?: string | null; phone: string | null; address: string | null; footer: string | null; timezone?: string | null;
    email?: string | null; logo?: string | null; showLogo?: boolean | null; paperWidthMm?: number | null };
  sale: { id?: string; reference: string; status?: string; occurredAt: Date | string; totalXof: bigint | string; subtotalXof?: bigint | string; discountXof?: bigint | string;
    /** Nom du membre qui a enregistré la vente (caissier), tel qu il apparaît dans l équipe. */
    cashierName?: string | null };
  lines: { name: string; variant: string; quantity: string; unitPriceXof: bigint | string; totalXof: bigint | string; lineDiscountXof?: bigint | string | null }[];
  // tenderedXof / changeXof : espèces remises et monnaie rendue (vente encaissée depuis la migration 0027).
  payments: { method: string; amountXof: bigint | string; status: string; tenderedXof?: bigint | string | null; changeXof?: bigint | string | null }[];
};

export type ReceiptDocument = {
  version: 1;
  language: ReceiptLanguage;
  direction: "ltr" | "rtl";
  paperWidthMm: 58 | 80;
  business: { name: string; address: string | null; phone: string | null; email: string | null; footer: string | null; logo: string | null };
  sale: { id: string | null; reference: string; status: string; banner: string | null; occurredAt: string; dateText: string; timeZone: string; timeZoneLabel: string; cashier: string | null };
  labels: { ticket: string; date: string; cashier: string; subtotal: string; discount: string; total: string; due: string; paid: string; item: string; quantity: string; amount: string; payments: string; tendered: string; change: string; settlement: string };
  lines: { label: string; name: string; variant: string | null; quantity: string; quantityText: string; unitPriceXof: string; lineDiscountXof: string | null; totalXof: string }[];
  totals: { subtotalXof: string | null; discountXof: string | null; totalXof: string; paidXof: string; dueXof: string | null; tenderedXof: string | null; changeXof: string | null };
  /** Payé, partiellement payé ou à crédit ; null pour une vente annulée ou remboursée (bandeau). */
  settlement: string | null;
  payments: { method: string; methodLabel: string; status: string; statusLabel: string | null; amountXof: string }[];
};

/** « 12 500 F » : groupes de trois chiffres séparés par une espace simple (lisible par toutes les imprimantes), chiffres latins. */
export function formatAmount(value: bigint | string) {
  const amount = BigInt(value);
  const digits = (amount < 0n ? -amount : amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${amount < 0n ? "-" : ""}${digits} F`;
}

/** Quantité décimale exacte (« 2.500000 » → « 2,5 » en français, « 2.5 » sinon), sans flottant. */
export function formatQuantity(value: string, language: ReceiptLanguage = "fr") {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}${language === "fr" ? "," : "."}${trimmed}` : whole!;
}

function safeTimeZone(value: string | null | undefined) {
  const zone = value?.trim() || "Africa/Abidjan";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }); return zone; } catch { return "Africa/Abidjan"; }
}

/**
 * Date et heure au fuseau du commerce (I-6), en chiffres latins et au format jj/mm/aaaa hh:mm, suivies du
 * nom court du fuseau (« GMT » pour Abidjan) : le ticket dit à quelle heure il se lit, quel que soit
 * l'appareil qui l'affiche.
 */
export function formatReceiptDate(value: Date | string, timeZone: string) {
  const date = new Date(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return { text: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`, zone: parts.timeZoneName ?? timeZone };
}

const amountString = (value: bigint | string) => BigInt(value).toString();

export function buildReceiptDocument(source: ReceiptSource, options: { language?: ReceiptLanguage } = {}): ReceiptDocument {
  const language = options.language ?? "fr";
  const t = createTranslator(language);
  const known = (key: string) => { const text = t(key as MessageKey); return text === key ? null : text; };
  const timeZone = safeTimeZone(source.business.timezone);
  const date = formatReceiptDate(source.sale.occurredAt, timeZone);
  const status = source.sale.status ?? "completed";
  // Une vente annulée ou remboursée ne doit jamais ressortir comme un ticket valide (I-1).
  const banner = known(`printing.receipt.banners.${status}`);

  const discount = source.sale.discountXof !== undefined ? BigInt(source.sale.discountXof) : 0n;
  const showDiscount = discount > 0n && source.sale.subtotalXof !== undefined;
  let paid = 0n; let tendered = 0n; let change = 0n;
  const payments = source.payments.map((payment) => {
    if (payment.status === "confirmed" || payment.status === "partially_refunded") {
      paid += BigInt(payment.amountXof);
      // Espèces remises et monnaie rendue : jamais confondues avec le total ni avec le payé.
      if (payment.changeXof != null && BigInt(payment.changeXof) > 0n) { tendered += BigInt(payment.tenderedXof ?? payment.amountXof); change += BigInt(payment.changeXof); }
    }
    return { method: payment.method, methodLabel: known(`printing.receipt.methods.${payment.method}`) ?? payment.method, status: payment.status,
      statusLabel: known(`printing.receipt.paymentStatuses.${payment.status}`), amountXof: amountString(payment.amountXof) };
  });
  // Le « reste à payer » n'a de sens que pour une vente en cours ; après annulation ou remboursement il serait trompeur.
  const due = banner ? 0n : BigInt(source.sale.totalXof) - paid;
  const settlement = banner ? null : known(`printing.receipt.settlement.${due <= 0n ? "paid" : paid > 0n ? "partial" : "credit"}`);

  return {
    version: 1, language, direction: localeDirection[language],
    paperWidthMm: source.business.paperWidthMm === 80 ? 80 : 58,
    business: {
      name: (source.business.displayName?.trim() || source.business.name).slice(0, 80),
      address: source.business.address?.trim() || null, phone: source.business.phone?.trim() || null, email: source.business.email?.trim() || null,
      footer: source.business.footer?.trim() || null,
      logo: source.business.showLogo !== false && source.business.logo ? source.business.logo : null,
    },
    sale: { id: source.sale.id ?? null, reference: source.sale.reference, status, banner, occurredAt: new Date(source.sale.occurredAt).toISOString(),
      dateText: date.text, timeZone, timeZoneLabel: date.zone, cashier: source.sale.cashierName?.trim().slice(0, 60) || null },
    labels: {
      ticket: t("printing.receipt.ticket"), date: t("printing.receipt.date"), cashier: t("printing.receipt.cashier"), subtotal: t("printing.receipt.subtotal"), discount: t("printing.receipt.discount"),
      total: t("printing.receipt.total"), due: t("printing.receipt.due"), paid: t("printing.receipt.paid"), item: t("printing.receipt.item"),
      quantity: t("printing.receipt.quantity"), amount: t("printing.receipt.amount"), payments: t("printing.receipt.payments"),
      tendered: t("printing.receipt.tendered"), change: t("printing.receipt.change"), settlement: t("printing.receipt.settlementLabel"),
    },
    lines: source.lines.map((line) => {
      const variant = line.variant && line.variant !== "Standard" ? line.variant : null;
      const lineDiscount = line.lineDiscountXof ? BigInt(line.lineDiscountXof) : 0n;
      return { label: variant ? `${line.name} (${variant})` : line.name, name: line.name, variant, quantity: line.quantity, quantityText: formatQuantity(line.quantity, language),
        unitPriceXof: amountString(line.unitPriceXof), lineDiscountXof: lineDiscount > 0n ? lineDiscount.toString() : null, totalXof: amountString(line.totalXof) };
    }),
    totals: {
      subtotalXof: showDiscount ? amountString(source.sale.subtotalXof!) : null, discountXof: showDiscount ? discount.toString() : null,
      totalXof: amountString(source.sale.totalXof), paidXof: paid.toString(), dueXof: due > 0n ? due.toString() : null,
      tenderedXof: change > 0n ? tendered.toString() : null, changeXof: change > 0n ? change.toString() : null,
    },
    settlement,
    payments,
  };
}
