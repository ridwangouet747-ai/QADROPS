import { describe, expect, it } from "vitest";
import { columnsFor } from "./escpos";
import { resolveProfile } from "./profiles";
import { buildReceiptDocument, formatReceiptDate, isReceiptLanguage, type ReceiptSource } from "./receipt-document";
import { encodeTicketText, layoutReceipt, type TicketLayout } from "./receipt-ticket";

const LRI = "⁦", PDI = "⁩";

const source: ReceiptSource = {
  business: { name: "Quincaillerie Koné & Fils", displayName: "Koné Matériaux", phone: "+225 07 00 00 00", address: "Treichville, Abidjan", footer: "Merci de votre visite",
    timezone: "Africa/Abidjan", email: "contact@kone.example", logo: "data:image/png;base64,AAAA", showLogo: true, paperWidthMm: 80 },
  sale: { id: "vente-1", reference: "V-MH2K-1A2B3C4D", status: "completed", occurredAt: "2026-10-31T23:30:00Z", totalXof: "21500", subtotalXof: "23000", discountXof: "1500" },
  lines: [
    { name: "Ciment Dangote 50 kg", variant: "Standard", quantity: "2.000000", unitPriceXof: "6500", totalXof: "13000" },
    { name: "Tôle ondulée galvanisée pour toiture, qualité supérieure, longueur trois mètres", variant: "3 m", quantity: "2.500000", unitPriceXof: "4000", totalXof: "10000", lineDiscountXof: "500" },
  ],
  payments: [
    { method: "cash", amountXof: "15000", status: "confirmed" },
    { method: "wave", amountXof: "5000", status: "pending" },
    { method: "orange_money", amountXof: "1000", status: "failed" },
  ],
};

const text = (layout: TicketLayout) => layout.blocks.map((block) => (block.type === "text" ? block.text : block.type === "pair" ? `${block.start} | ${block.end}` : block.type)).join("\n");

describe("ReceiptDocument : modèle unique du ticket", () => {
  it("vente normale : identité du commerce, montants en chaînes entières, encaissé et reste dû calculés une seule fois", () => {
    const document = buildReceiptDocument(source, { language: "fr" });
    expect(document).toMatchObject({ version: 1, language: "fr", direction: "ltr", paperWidthMm: 80 });
    expect(document.business).toEqual({ name: "Koné Matériaux", address: "Treichville, Abidjan", phone: "+225 07 00 00 00", email: "contact@kone.example",
      footer: "Merci de votre visite", logo: "data:image/png;base64,AAAA" });
    expect(document.totals).toEqual({ subtotalXof: "23000", discountXof: "1500", totalXof: "21500", paidXof: "15000", dueXof: "6500" });
    expect(document.lines[0]).toMatchObject({ label: "Ciment Dangote 50 kg", variant: null, quantityText: "2", unitPriceXof: "6500", totalXof: "13000", lineDiscountXof: null });
    expect(document.lines[1]).toMatchObject({ label: expect.stringContaining("(3 m)"), quantityText: "2,5", lineDiscountXof: "500" });
    expect(document.payments.map((payment) => [payment.methodLabel, payment.statusLabel])).toEqual([["Espèces", null], ["Wave", "en attente"], ["Orange Money", "échoué"]]);
    for (const value of [...Object.values(document.totals), ...document.payments.map((payment) => payment.amountXof)]) {
      if (value !== null) expect(value).toMatch(/^-?\d+$/);
    }
    expect(document.sale.banner).toBeNull();
    expect(JSON.stringify(document)).not.toMatch(/Qadr/i);
  });

  it("date au fuseau du commerce (Africa/Abidjan par défaut), jamais celui de l'appareil", () => {
    expect(buildReceiptDocument(source).sale).toMatchObject({ dateText: "31/10/2026 23:30", timeZone: "Africa/Abidjan", timeZoneLabel: "GMT" });
    const paris = buildReceiptDocument({ ...source, business: { ...source.business, timezone: "Europe/Paris" } }).sale;
    expect(paris.dateText).toBe("01/11/2026 00:30");
    expect(buildReceiptDocument({ ...source, business: { ...source.business, timezone: "Pas/UnFuseau" } }).sale.timeZone).toBe("Africa/Abidjan");
    expect(buildReceiptDocument({ ...source, business: { ...source.business, timezone: null } }).sale.timeZone).toBe("Africa/Abidjan");
    expect(formatReceiptDate("2026-06-15T12:00:00Z", "Africa/Abidjan").text).toBe("15/06/2026 12:00");
  });

  it("vente annulée : bandeau, aucun reste à payer", () => {
    const document = buildReceiptDocument({ ...source, sale: { ...source.sale, status: "voided" } });
    expect(document.sale.banner).toBe("VENTE ANNULÉE");
    expect(document.totals.dueXof).toBeNull();
    expect(text(layoutReceipt(document))).toContain("VENTE ANNULÉE");
  });

  it("vente remboursée : bandeau traduit, paiement remboursé non compté comme encaissé", () => {
    const document = buildReceiptDocument({ ...source, sale: { ...source.sale, status: "refunded" }, payments: [{ method: "cash", amountXof: "21500", status: "refunded" }] }, { language: "en" });
    expect(document.sale.banner).toBe("SALE REFUNDED");
    expect(document.totals).toMatchObject({ paidXof: "0", dueXof: null });
    expect(document.payments[0]).toMatchObject({ methodLabel: "Cash", statusLabel: "refunded" });
  });

  it("paiements partiels : seuls les paiements confirmés (ou remboursés en partie) réduisent le reste dû", () => {
    const document = buildReceiptDocument({ ...source, payments: [
      { method: "cash", amountXof: "10000", status: "confirmed" },
      { method: "wave", amountXof: "2000", status: "partially_refunded" },
      { method: "mtn_momo", amountXof: "9500", status: "pending" },
    ] });
    expect(document.totals).toMatchObject({ paidXof: "12000", dueXof: "9500" });
    const settled = buildReceiptDocument({ ...source, payments: [{ method: "cash", amountXof: "21500", status: "confirmed" }] });
    expect(settled.totals.dueXof).toBeNull();
  });

  it("montants très grands sans perte (bigint)", () => {
    const document = buildReceiptDocument({ ...source, sale: { ...source.sale, totalXof: 9_007_199_254_740_993n, subtotalXof: undefined, discountXof: undefined }, payments: [] });
    expect(document.totals).toMatchObject({ totalXof: "9007199254740993", dueXof: "9007199254740993", subtotalXof: null, discountXof: null });
  });

  it("logo masqué si le commerce l'a désactivé ; nom commercial à défaut du nom d'affichage", () => {
    const document = buildReceiptDocument({ ...source, business: { ...source.business, showLogo: false, displayName: "  " } });
    expect(document.business).toMatchObject({ logo: null, name: "Quincaillerie Koné & Fils" });
    expect(layoutReceipt(document).blocks.some((block) => block.type === "logo")).toBe(false);
  });

  it("langues reconnues", () => {
    expect(["fr", "en", "ar"].every(isReceiptLanguage)).toBe(true);
    expect(isReceiptLanguage("de")).toBe(false);
    expect(isReceiptLanguage(undefined)).toBe(false);
  });
});

describe("mise en page partagée : texte 58/80 mm et arabe", () => {
  it.each([58, 80] as const)("noms longs repliés à %i mm, aucune ligne au-delà de la largeur", (width) => {
    const profile = resolveProfile({ paperWidthMm: width });
    const ticket = encodeTicketText(layoutReceipt(buildReceiptDocument(source)), profile);
    for (const line of ticket.preview) expect(line.length).toBeLessThanOrEqual(columnsFor(width));
    const joined = ticket.preview.join("\n");
    expect(joined).toContain("Koné Matériaux");
    expect(joined).toMatch(/TOTAL\s+21 500 F/);
    expect(joined).toMatch(/Remise\s+-500 F/);
    expect(joined).toContain("31/10/2026 23:30 GMT");
    expect(ticket.unsupportedCharacters).toBe(0);
  });

  it("le logo est sauté en mode texte s'il n'a pas été décodé ; le ticket reste complet", () => {
    const ticket = encodeTicketText(layoutReceipt(buildReceiptDocument(source)), resolveProfile({ paperWidthMm: 58 }));
    expect(ticket.preview[0]).toBe("Koné Matériaux");
  });

  it("arabe : sens rtl, libellés traduits, montants, références et dates isolés (LRI…PDI)", () => {
    const document = buildReceiptDocument(source, { language: "ar" });
    expect(document.direction).toBe("rtl");
    expect(document.lines[1]!.quantityText).toBe("2.5");
    const layout = layoutReceipt(document);
    expect(layout.direction).toBe("rtl");
    const pairs = layout.blocks.filter((block) => block.type === "pair");
    for (const pair of pairs) expect(pair.end.startsWith(LRI) && pair.end.endsWith(PDI)).toBe(true);
    expect(pairs.some((pair) => pair.end === `${LRI}${"V-MH2K-1A2B3C4D"}${PDI}`)).toBe(true);
    expect(pairs.some((pair) => pair.end === `${LRI}21 500 F${PDI}`)).toBe(true);
    expect(text(layout)).not.toContain("TOTAL");
    // Les noms saisis par le commerçant ne sont jamais traduits.
    expect(text(layout)).toContain("Ciment Dangote 50 kg");
  });

  it("arabe en mode texte forcé : les isolants disparaissent, les lettres arabes sont comptées comme non imprimables", () => {
    const ticket = encodeTicketText(layoutReceipt(buildReceiptDocument(source, { language: "ar" })), resolveProfile({ paperWidthMm: 80, renderMode: "text" }));
    expect(ticket.unsupportedCharacters).toBeGreaterThan(0);
    const reference = Buffer.from("V-MH2K-1A2B3C4D");
    expect(Buffer.from(ticket.bytes).indexOf(reference)).toBeGreaterThan(0);
    expect(Buffer.from(ticket.bytes).indexOf(Buffer.from(`?${"V-MH2K"}`))).toBe(-1);
  });
});
