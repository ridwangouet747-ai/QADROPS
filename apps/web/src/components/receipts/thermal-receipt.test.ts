import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReceiptDocument, type ReceiptLanguage, type ReceiptSource } from "@/lib/printing/receipt-document";
import { ReceiptBackLink, ReceiptTicketView } from "./thermal-receipt";

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
    expect(html).toContain(`<span class="ms-auto shrink-0 whitespace-nowrap"><bdi dir="ltr">2 500 F</bdi></span>`);
    expect(html).toContain("01/11/2026 09:15 GMT");
    expect(html).toContain("Boutique Awa");
    expect(html).not.toMatch(/Qadr/i);
  });

  it("arabe : dir=\"rtl\", libellés en arabe, montants et références dans des <bdi dir=\"ltr\">", () => {
    const html = render("ar");
    expect(html).toContain(`dir="rtl"`);
    expect(html).toContain(`lang="ar"`);
    expect(html).toMatch(/[؀-ۿ]/);
    // La marge qui pousse le montant en fin de ligne est sur un span qui suit le sens du ticket (rtl), pas sur le <bdi dir="ltr">.
    expect(html).toContain(`<span class="ms-auto shrink-0 whitespace-nowrap"><bdi dir="ltr">⁦V-ABC-123⁩</bdi></span>`);
    expect(html).not.toMatch(/<bdi dir="ltr" class="[^"]*ms-auto/);
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

describe("retour depuis le reçu (logo du commerce)", () => {
  it("lien vers l'adresse calculée par le serveur, logo du commerce, masqué à l'impression", () => {
    const html = renderToStaticMarkup(createElement(ReceiptBackLink, {
      identity: { name: "Boutique Awa", logo: "data:image/png;base64,AAAA" }, back: { href: "/business/pos" }, label: "Retour à la caisse",
    }));
    expect(html).toContain(`href="/business/pos"`);
    expect(html).toContain(`aria-label="Retour à la caisse · Boutique Awa"`);
    expect(html).toContain(`src="data:image/png;base64,AAAA"`);
    expect(html).toContain("print:hidden");
  });

  it("sans logo : initiale du commerce, jamais une image externe", () => {
    const html = renderToStaticMarkup(createElement(ReceiptBackLink, { identity: { name: "awa", logo: null }, back: { href: "/business/sales" }, label: "Retour" }));
    expect(html).toContain(">A</span>");
    expect(html).not.toContain("<img");
  });
});
