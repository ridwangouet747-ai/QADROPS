import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReceiptDocument, type ReceiptLanguage, type ReceiptSource } from "@/lib/printing/receipt-document";
import { ReceiptTicketView } from "./thermal-receipt";

const source: ReceiptSource = {
  business: { name: "Boutique Awa", phone: "+225 05 11 22 33", address: "Adjamé, Abidjan", footer: null, timezone: "Africa/Abidjan", logo: null },
  sale: { reference: "V-ABC-123", status: "completed", occurredAt: "2026-11-01T09:15:00Z", totalXof: "12500" },
  lines: [{ name: "Pagne wax 6 yards", variant: "Standard", quantity: "1.000000", unitPriceXof: "12500", totalXof: "12500" }],
  payments: [{ method: "cash", amountXof: "10000", status: "confirmed" }],
};

const render = (language: ReceiptLanguage, width: 58 | 80 = 58, overrides: Partial<ReceiptSource["business"]> = {}) =>
  renderToStaticMarkup(createElement(ReceiptTicketView, { document: buildReceiptDocument({ ...source, business: { ...source.business, ...overrides } }, { language }), width, logoAlt: "Logo", label: "Ticket" }));

describe("ticket à l'écran", () => {
  it.each([
    ["fr", "Reste à payer", "Espèces"],
    ["en", "Still due", "Cash"],
  ] as const)("%s : libellés traduits, sens ltr, montants isolés", (language, due, cash) => {
    const html = render(language);
    expect(html).toContain(`dir="ltr"`);
    expect(html).toContain(`lang="${language}"`);
    expect(html).toContain(due);
    expect(html).toContain(cash);
    expect(html).toContain(`<bdi dir="ltr" class="shrink-0 whitespace-nowrap">2 500 F</bdi>`);
    expect(html).toContain("01/11/2026 09:15 GMT");
    expect(html).toContain("Boutique Awa");
    expect(html).not.toMatch(/Qadr/i);
  });

  it("arabe : dir=\"rtl\", libellés en arabe, montants et références dans des <bdi dir=\"ltr\">", () => {
    const html = render("ar");
    expect(html).toContain(`dir="rtl"`);
    expect(html).toContain(`lang="ar"`);
    expect(html).toMatch(/[؀-ۿ]/);
    expect(html).toContain(`<bdi dir="ltr" class="shrink-0 whitespace-nowrap">⁦V-ABC-123⁩</bdi>`);
    expect(html).toContain(`⁦12 500 F⁩`);
    expect(html).not.toContain("TOTAL");
    // Le nom du produit, saisi par le commerçant, n'est pas traduit.
    expect(html).toContain("Pagne wax 6 yards");
  });

  it("aperçu 58 / 80 mm : la largeur est portée par la variable --receipt-width", () => {
    expect(render("fr", 58)).toContain("--receipt-width:58mm");
    expect(render("fr", 80)).toContain("--receipt-width:80mm");
  });

  it("logo du commerce affiché seulement s'il existe", () => {
    expect(render("fr")).not.toContain("<img");
    expect(render("fr", 58, { logo: "data:image/png;base64,iVBORw0KGgo=" })).toMatch(/<img[^>]+alt="Logo"/);
  });
});
