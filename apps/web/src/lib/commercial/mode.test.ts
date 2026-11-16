import { describe, expect, it } from "vitest";
import { accessCodeRequired, commercialMode, whatsappHref, whatsappLink, whatsappNumber } from "./mode";

describe("mode de commercialisation", () => {
  it("vaut le code manuel par défaut et pour toute valeur inconnue (fermé par défaut)", () => {
    expect(commercialMode({})).toBe("manual_code");
    expect(commercialMode({ QADR_COMMERCIAL_MODE: "stripe" })).toBe("manual_code");
    expect(commercialMode({ QADR_COMMERCIAL_MODE: " GeniusPay " })).toBe("geniuspay");
  });

  it("exige un code sur tout déploiement en mode manuel, jamais en mode paiement en ligne", () => {
    expect(accessCodeRequired({ VERCEL_ENV: "production" })).toBe(true);
    expect(accessCodeRequired({ VERCEL_ENV: "preview" })).toBe(true);
    expect(accessCodeRequired({ NODE_ENV: "production" })).toBe(true);
    // « optional » ne lève pas l'exigence sur un déploiement.
    expect(accessCodeRequired({ VERCEL_ENV: "production", QADR_ACCESS_CODE: "optional" })).toBe(true);
    expect(accessCodeRequired({ NODE_ENV: "development" })).toBe(false);
    expect(accessCodeRequired({ NODE_ENV: "development", QADR_ACCESS_CODE: "required" })).toBe(true);
    expect(accessCodeRequired({ VERCEL_ENV: "production", QADR_COMMERCIAL_MODE: "geniuspay" })).toBe(false);
  });
});

describe("contact WhatsApp de Qadr Agency", () => {
  it("normalise un numéro international et refuse un numéro absent ou invalide", () => {
    expect(whatsappNumber({})).toBeNull();
    expect(whatsappNumber({ QADR_WHATSAPP_NUMBER: "  " })).toBeNull();
    expect(whatsappNumber({ QADR_WHATSAPP_NUMBER: "+225 01 02 03 04 05" })).toBe("2250102030405");
    expect(whatsappNumber({ QADR_WHATSAPP_NUMBER: "00225-0102030405" })).toBe("2250102030405");
    expect(whatsappNumber({ QADR_WHATSAPP_NUMBER: "0102" })).toBeNull();
    expect(whatsappNumber({ QADR_WHATSAPP_NUMBER: "tel:abc" })).toBeNull();
  });

  it("construit un lien wa.me avec le message encodé, jamais pour un numéro invalide", () => {
    // Régression du 2026-11-16 : l'expression avait perdu sa barre oblique (`d` au lieu de `\d`) et ne rendait aucun lien.
    expect(whatsappHref("2250102030405", "Bonjour, offre Standard ?")).toBe("https://wa.me/2250102030405?text=Bonjour%2C%20offre%20Standard%20%3F");
    expect(whatsappHref("0102030405", "x")).toBeNull();
    expect(whatsappHref("javascript:alert(1)", "x")).toBeNull();
    expect(whatsappLink("Bonjour", { QADR_WHATSAPP_NUMBER: "+225 07 00 00 00 01" })).toBe("https://wa.me/2250700000001?text=Bonjour");
    expect(whatsappLink("Bonjour", {})).toBeNull();
  });
});
