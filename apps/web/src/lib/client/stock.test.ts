import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n/translate";
import { errorMessageFor } from "./errors";
import { movementDirection, roundXof, signedMicros, stockStatus } from "./stock";

describe("statut de stock", () => {
  it("distingue rupture, stock faible et stock suffisant", () => {
    expect(stockStatus("0.000000", "5.000000")).toBe("out");
    expect(stockStatus("-1.000000", "0")).toBe("out");
    expect(stockStatus("5.000000", "5.000000")).toBe("low");
    expect(stockStatus("2.500000", "3")).toBe("low");
    expect(stockStatus("5.000001", "5.000000")).toBe("ok");
  });

  it("n’alerte pas quand le seuil vaut zéro ou est illisible", () => {
    expect(stockStatus("1.000000", "0.000000")).toBe("ok");
    expect(stockStatus("1", null)).toBe("ok");
  });

  it("traite une quantité illisible comme une rupture plutôt que comme du stock", () => {
    expect(stockStatus("abc", "2")).toBe("out");
  });
});

describe("mouvements et montants", () => {
  it("donne le sens d’un mouvement depuis son delta signé", () => {
    expect(movementDirection("-3.000000")).toBe("out");
    expect(movementDirection("12.500000")).toBe("in");
    expect(signedMicros("-0.5")).toBe(-500_000n);
  });

  it("arrondit le coût moyen au franc sans flottant", () => {
    expect(roundXof("4800.000000")).toBe("4800");
    expect(roundXof("4799.5")).toBe("4800");
    expect(roundXof("4799.499999")).toBe("4799");
    expect(roundXof("9007199254740993.6")).toBe("9007199254740994");
    expect(roundXof("")).toBeNull();
  });
});

describe("messages d’erreur traduits", () => {
  it("garde le message précis du serveur en français", () => {
    expect(errorMessageFor({ status: 404, serverMessage: "Produit introuvable dans ce commerce.", locale: "fr", t: createTranslator("fr") })).toBe("Produit introuvable dans ce commerce.");
  });

  it("ne montre jamais la phrase française du serveur en anglais ou en arabe", () => {
    const en = errorMessageFor({ status: 404, serverMessage: "Produit introuvable dans ce commerce.", locale: "en", t: createTranslator("en") });
    expect(en).toBe(createTranslator("en")("errors.notFound"));
    expect(errorMessageFor({ status: 403, serverMessage: "Accès refusé.", locale: "ar", t: createTranslator("ar") })).toBe(createTranslator("ar")("errors.forbidden"));
    expect(errorMessageFor({ status: null, locale: "en", t: createTranslator("en") })).toBe(createTranslator("en")("errors.network"));
    expect(errorMessageFor({ status: 500, locale: "ar", t: createTranslator("ar") })).toBe(createTranslator("ar")("errors.generic"));
  });
});
