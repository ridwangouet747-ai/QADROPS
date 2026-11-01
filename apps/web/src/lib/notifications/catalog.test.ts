import { describe, expect, it } from "vitest";
import { defaultTemplates, effectivePreference, inQuietHours, localMinute, renderText, validateTemplateText } from "./catalog";

const base = { titleFr: "Titre", titleEn: "Title", titleAr: "عنوان", bodyFr: "Corps", bodyEn: "Body", bodyAr: "نص" };

describe("modèles de notification", () => {
  it("les modèles fournis sont valides dans les trois langues", () => {
    for (const template of defaultTemplates) expect(validateTemplateText(template), template.key).toEqual([]);
  });

  it("refuse les variables inconnues, le balisage et une variable confidentielle dans le titre", () => {
    expect(validateTemplateText({ ...base, bodyFr: "Montant {{amount}}" })).toContain("bodyFr:unknown_variable:amount");
    expect(validateTemplateText({ ...base, titleEn: "Low {{product_name}}" })).toContain("titleEn:unsafe_variable:product_name");
    expect(validateTemplateText({ ...base, bodyAr: "<script>alert(1)</script>" })).toContain("bodyAr:markup");
    expect(validateTemplateText({ ...base, titleFr: " " })).toContain("titleFr:empty");
    expect(validateTemplateText({ ...base, bodyFr: "x".repeat(501) })).toContain("bodyFr:too_long");
  });

  it("remplace littéralement les variables, sans rien évaluer", () => {
    expect(renderText("{{user_name}} a vendu le {{event_date}}", { user_name: "Awa", event_date: "31/10/2026" })).toBe("Awa a vendu le 31/10/2026");
    expect(renderText("{{user_name}} {{constructor}}", { user_name: "${process.env.SECRET}" })).toBe("${process.env.SECRET}");
    expect(renderText("Stock {{product_name}}", {})).toBe("Stock");
  });
});

describe("préférences", () => {
  it("applique les défauts et garde la sécurité visible dans l'application", () => {
    expect(effectivePreference({}, "announcement")).toEqual({ inApp: true, push: false });
    expect(effectivePreference({ commercial: { push: false } }, "commercial")).toEqual({ inApp: true, push: false });
    expect(effectivePreference({ security: { inApp: false, push: false } }, "security")).toEqual({ inApp: true, push: false });
  });

  it("plage de tranquillité, y compris de nuit à cheval sur minuit, dans le fuseau du commerce", () => {
    expect(inQuietHours(23 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(inQuietHours(6 * 60 + 59, 22 * 60, 7 * 60)).toBe(true);
    expect(inQuietHours(7 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(inQuietHours(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(inQuietHours(13 * 60, null, null)).toBe(false);
    expect(localMinute(new Date("2026-10-31T22:30:00Z"), "Africa/Abidjan")).toBe(22 * 60 + 30);
    expect(localMinute(new Date("2026-10-31T22:30:00Z"), "Africa/Lagos")).toBe(23 * 60 + 30);
  });
});
