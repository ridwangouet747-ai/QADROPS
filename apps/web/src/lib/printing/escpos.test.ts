import { describe, expect, it } from "vitest";
import { columnsFor, encodeText, EscPosBuilder, leftRight, parseStatus, wrap } from "./escpos";
import { buildReceiptTicket, buildTestTicket, formatAmount, formatQuantity, type ReceiptInput } from "./receipt-ticket";

const receipt: ReceiptInput = {
  business: { name: "Quincaillerie Koné & Fils", displayName: null, phone: "+225 07 00 00 00", address: "Treichville, Abidjan", footer: "Merci de votre visite — à bientôt !", timezone: "Africa/Abidjan" },
  sale: { reference: "V-MH2K-1A2B3C4D", occurredAt: "2026-10-31T09:05:00Z", totalXof: "21500", subtotalXof: "23000", discountXof: "1500" },
  lines: [
    { name: "Ciment Dangote 50 kg", variant: "Standard", quantity: "2.000000", unitPriceXof: "6500", totalXof: "13000" },
    { name: "Tôle ondulée galvanisée pour toiture, qualité supérieure, longueur trois mètres", variant: "3 m", quantity: "2.500000", unitPriceXof: "4000", totalXof: "10000" },
  ],
  payments: [{ method: "cash", amountXof: "15000", status: "confirmed" }, { method: "wave", amountXof: "5000", status: "pending" }],
};

describe("moteur ESC/POS", () => {
  it("encode les accents français en PC858 et signale ce qui ne s'imprime pas", () => {
    expect(encodeText("éèàçÉÀ€°").bytes).toEqual([0x82, 0x8a, 0x85, 0x87, 0x90, 0xb7, 0xd5, 0xf8]);
    expect(encodeText("œuvre – « oui »").bytes).toEqual([...Buffer.from("oeuvre - "), 0xae, 0x20, ...Buffer.from("oui"), 0x20, 0xaf]);
    const arabic = encodeText("متجر");
    expect(arabic.unsupported).toBe(4);
    expect(arabic.bytes).toEqual([0x3f, 0x3f, 0x3f, 0x3f]);
  });

  it("replie les textes longs sans dépasser la largeur, colonne de droite alignée", () => {
    for (const line of wrap("Tôle ondulée galvanisée pour toiture qualité supérieure", 32)) expect(line.length).toBeLessThanOrEqual(32);
    expect(wrap("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 32)).toEqual(["ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "6789"]);
    const lines = leftRight("Ciment Dangote 50 kg sac", "13 000 F", 32);
    expect(lines.at(-1)!.length).toBe(32);
    expect(lines.at(-1)!.endsWith("13 000 F")).toBe(true);
  });

  it("produit les commandes attendues : initialisation, page PC858, coupe", () => {
    const bytes = new EscPosBuilder(80).align("center").bold(true).line("A").cut().build();
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 66, 3]);
    expect(columnsFor(58)).toBe(32);
    expect(columnsFor(80)).toBe(48);
  });

  it("lit l'état matériel seulement quand l'octet est valide", () => {
    expect(parseStatus({ printer: 0x16, offline: 0x16, paper: 0x72 })).toEqual({ offline: false, coverOpen: true, cutterError: false, paperLow: false, paperOut: true });
    expect(parseStatus({ printer: 0x1e })).toMatchObject({ offline: true, coverOpen: null, paperOut: null });
    expect(parseStatus({ paper: 0xff })).toMatchObject({ paperOut: null });
  });
});

describe("tickets de vente", () => {
  it.each([58, 80] as const)("ticket %i mm : identité, lignes, remise, total, paiements, reste dû, pied ; aucune ligne trop large", (width) => {
    const ticket = buildReceiptTicket(receipt, width);
    const columns = columnsFor(width);
    for (const line of ticket.preview) expect(line.length).toBeLessThanOrEqual(columns);
    const text = ticket.preview.join("\n");
    expect(text).toContain("Quincaillerie Koné & Fils");
    expect(text).toContain("V-MH2K-1A2B3C4D");
    expect(text).toContain("31/10/2026 09:05");
    expect(text).toContain("2,5 x 4 000 F");
    expect(text).toMatch(/Remise\s+-1 500 F/);
    expect(text).toMatch(/TOTAL\s+21 500 F/);
    expect(text).toMatch(/Wave \(en attente\)\s+5 000 F/);
    expect(text).toMatch(/Reste à payer\s+6 500 F/);
    expect(text).toContain("Merci de votre visite");
    expect(ticket.unsupportedCharacters).toBe(0);
  });

  it("n'imprime pas ce qui n'existe pas : ni adresse, ni remise, ni reste dû", () => {
    const ticket = buildReceiptTicket({ ...receipt, business: { ...receipt.business, address: null, phone: null, footer: null },
      sale: { ...receipt.sale, totalXof: "13000", subtotalXof: "13000", discountXof: "0" }, lines: [receipt.lines[0]!], payments: [{ method: "cash", amountXof: "13000", status: "confirmed" }] }, 58);
    const text = ticket.preview.join("\n");
    expect(text).not.toMatch(/Remise|Reste|Treichville|\+225/);
  });

  it("formats exacts sans flottant, et page de test", () => {
    expect(formatAmount("123456789012345678")).toBe("123 456 789 012 345 678 F");
    expect(formatQuantity("0.250000")).toBe("0,25");
    expect(formatQuantity("3.000000")).toBe("3");
    const test = buildTestTicket(58, "Commerce Démo", "fr", new Date("2026-10-31T10:00:00Z"));
    expect(test.preview.join("\n")).toContain("Accents : é è ê");
    expect(test.preview.every((line) => line.length <= 32)).toBe(true);
  });
});
