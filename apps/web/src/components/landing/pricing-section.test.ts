import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPlan, PublicPlansResult } from "@/lib/domain/public-plans";
import { createTranslator } from "@/lib/i18n/translate";
import { pricingColumnsClass, pricingLayout } from "@/lib/landing/pricing-layout";

/*
 * 2026-11-19 : la page publique montrait seulement la formule STANDARD ; tout autre forfait publié dans la
 * console restait invisible. Chaque formule renvoyée par `getPublicPlans` (actives, XOF) doit avoir sa carte.
 */
const state: { result: PublicPlansResult } = { result: { status: "ok", plans: [], preview: false } };
vi.mock("@/lib/domain/public-plans", () => ({ getPublicPlans: async () => state.result }));

const plan = (index: number): PublicPlan => ({
  code: `FORMULE_${index}`, name: `Formule ${index}`, priceXof: String(1000 * index), durationDays: 30,
  description: null, productLimit: null, userLimit: null,
});

async function render(plans: PublicPlan[]) {
  state.result = { status: "ok", plans, preview: false };
  const { PricingSection } = await import("./pricing-section");
  return renderToStaticMarkup(await PricingSection({ t: createTranslator("fr"), locale: "fr", container: "c" }));
}

describe("section Tarifs de la page publique", () => {
  beforeEach(() => {
    vi.stubEnv("QADR_WHATSAPP_NUMBER", "");
    vi.stubEnv("QADR_CONTACT_URL", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([1, 2, 10])("%i formule(s) publiée(s) : une carte chacune, dans l'ordre reçu", async (count) => {
    const plans = Array.from({ length: count }, (_, index) => plan(index + 1));
    const html = await render(plans);
    for (const item of plans) expect(html).toContain(`>${item.name}</h3>`);
    const order = plans.map((item) => html.indexOf(`>${item.name}</h3>`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("une formule autre que STANDARD n'est plus écartée", async () => {
    const html = await render([{ ...plan(1), code: "PREMIUM", name: "Premium" }]);
    expect(html).toContain(">Premium</h3>");
  });

  it("aucune formule : l'état vide, sans prix inventé", async () => {
    const html = await render([]);
    expect(html).toContain(createTranslator("fr")("landing.pricing.emptyTitle"));
    expect(html).not.toMatch(/F\s?CFA<\/span>/);
  });

  it("base indisponible : message d'indisponibilité, aucune carte", async () => {
    state.result = { status: "unavailable", preview: false };
    const { PricingSection } = await import("./pricing-section");
    const html = renderToStaticMarkup(await PricingSection({ t: createTranslator("fr"), locale: "fr", container: "c" }));
    expect(html).toContain(createTranslator("fr")("landing.pricing.unavailable"));
    expect(html).not.toContain("Formule ");
  });
});

describe("disposition des cartes", () => {
  it.each([
    [1, false, { cards: 1, asideBeside: true, columns: 1 }],
    [1, true, { cards: 2, asideBeside: true, columns: 2 }],
    [3, true, { cards: 4, asideBeside: false, columns: 2 }],
    [4, true, { cards: 5, asideBeside: false, columns: 3 }],
    [10, true, { cards: 11, asideBeside: false, columns: 3 }],
    [0, false, { cards: 0, asideBeside: true, columns: 1 }],
  ] as const)("%i formule(s), Business %s", (plans, business, expected) => {
    expect(pricingLayout(plans, business)).toEqual(expected);
  });

  it("une colonne sur téléphone, jamais plus de trois", () => {
    expect(pricingColumnsClass(1)).toBe("");
    expect(pricingColumnsClass(2)).toBe("md:grid-cols-2");
    expect(pricingColumnsClass(3)).toBe("md:grid-cols-2 lg:grid-cols-3");
  });
});

