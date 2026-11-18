import { describe, expect, it } from "vitest";
import {
  accountSchema, brandingSchema, chooseSceneMode, detailsSchema, emptyBusiness, identitySchema, newCreationKey, parseDraft,
  samePlan, scenePlan, serializeDraft, toCreateBusinessPayload, type DeviceSignals,
} from "./wizard";

const desktop: DeviceSignals = { webgl: true, reducedMotion: false, saveData: false, width: 1366, deviceMemory: 8, hardwareConcurrency: 8, coarsePointer: false };
const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`;

describe("validation de chaque étape", () => {
  it("compte : nom, e-mail, mot de passe de 8 caractères et confirmation identique", () => {
    expect(accountSchema.safeParse({ name: "Awa", email: "awa@qadr.test", username: "", password: "motdepasse", confirm: "motdepasse" }).success).toBe(true);
    const errors = accountSchema.safeParse({ name: "A", email: "pas-un-email", username: "", password: "court", confirm: "autre" }).error!.issues.map((issue) => issue.message);
    expect(errors).toEqual(expect.arrayContaining(["wizard.errors.nameShort", "wizard.errors.email", "wizard.errors.passwordShort", "wizard.errors.passwordMismatch"]));
  });

  it("compte sans e-mail : adresse facultative, nom d'utilisateur alors exigé (3 à 30 caractères a-z 0-9 . _)", () => {
    const base = { name: "Awa", email: "", password: "motdepasse", confirm: "motdepasse" };
    expect(accountSchema.safeParse({ ...base, username: "awa.kone" }).success).toBe(true);
    for (const username of ["", "ab", "awa kone", "awa@kone", "a".repeat(31), "awà"]) {
      const result = accountSchema.safeParse({ ...base, username });
      expect(result.success, username).toBe(false);
      expect(result.error!.issues.map((issue) => issue.message)).toContain("wizard.errors.username");
    }
    // Avec une adresse, le nom d'utilisateur n'est pas demandé.
    expect(accountSchema.safeParse({ ...base, email: "awa@qadr.test", username: "" }).success).toBe(true);
  });

  it("commerce : nom, activité et type de commerce obligatoires", () => {
    expect(identitySchema.safeParse({ businessName: "Quincaillerie du Plateau", activity: "hardware", storeFormat: "shop" }).success).toBe(true);
    const errors = identitySchema.safeParse({ businessName: " ", activity: "casino", storeFormat: "" }).error!.issues.map((issue) => issue.message);
    expect(errors).toEqual(expect.arrayContaining(["wizard.errors.businessName", "wizard.errors.activity", "wizard.errors.storeFormat"]));
  });

  it("coordonnées : facultatives, mais un téléphone saisi doit être plausible", () => {
    expect(detailsSchema.safeParse({ phone: "", address: "" }).success).toBe(true);
    expect(detailsSchema.safeParse({ phone: "+225 07 00 00 00 00", address: "Adjamé" }).success).toBe(true);
    expect(detailsSchema.safeParse({ phone: "appelez-moi", address: "" }).error!.issues[0]!.message).toBe("wizard.errors.phone");
  });

  it("identité visuelle : logo facultatif, PNG/JPEG/WebP seulement, taille bornée", () => {
    expect(brandingSchema.safeParse({ logo: "", displayName: "" }).success).toBe(true);
    expect(brandingSchema.safeParse({ logo: png, displayName: "Koné & Fils" }).success).toBe(true);
    expect(brandingSchema.safeParse({ logo: "data:image/svg+xml;base64,PHN2Zz4=", displayName: "" }).error!.issues[0]!.message).toBe("wizard.errors.logoType");
    expect(brandingSchema.safeParse({ logo: `data:image/png;base64,${"A".repeat(200_001)}`, displayName: "" }).success).toBe(false);
  });
});

describe("brouillon et création", () => {
  it("ne conserve jamais le mot de passe dans le brouillon, et le relit", () => {
    const raw = serializeDraft({ step: "details", creationKey: "cle-de-creation-0123456789", business: { ...emptyBusiness, businessName: "Boutique Awa", logo: png },
      account: { name: "Awa", email: "awa@qadr.test", password: "secret-tres-long", confirm: "secret-tres-long" } as never });
    expect(raw).not.toContain("secret-tres-long");
    expect(parseDraft(raw)).toMatchObject({ step: "details", business: { businessName: "Boutique Awa", logo: png }, account: { email: "awa@qadr.test" } });
    expect(parseDraft("{pas du json")).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("prépare le corps de la route existante, sans champ vide, avec la clé de création", () => {
    expect(toCreateBusinessPayload({ ...emptyBusiness, businessName: "  Koné  ", activity: "hardware" }, "cle-de-creation-0123456789"))
      .toEqual({ name: "Koné", activity: "hardware", storeFormat: "shop", creationKey: "cle-de-creation-0123456789" });
    expect(newCreationKey(() => "1234-5678-9abc-def0-1234")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it("garde le code promotionnel dans le brouillon et la charge utile, et ignore un code mal formé", () => {
    const key = "cle-de-creation-0123456789";
    const raw = serializeDraft({ step: "review", creationKey: key, business: { ...emptyBusiness, businessName: "Boutique Awa" }, account: {}, promotion: { code: "LANCEMENT", planCode: "PRO" } });
    expect(parseDraft(raw)?.promotion).toEqual({ code: "LANCEMENT", planCode: "PRO" });
    // Brouillon antérieur (sans promotion) toujours lisible.
    expect(parseDraft(serializeDraft({ step: "review", creationKey: key, business: emptyBusiness, account: {} }))?.promotion).toBeUndefined();
    expect(toCreateBusinessPayload({ ...emptyBusiness, businessName: "Koné" }, key, { code: "LANCEMENT" }))
      .toEqual({ name: "Koné", activity: "general", storeFormat: "shop", promotion: { code: "LANCEMENT" }, creationKey: key });
    expect(toCreateBusinessPayload({ ...emptyBusiness, businessName: "Koné" }, key, { code: "<script>" })).not.toHaveProperty("promotion");
    expect(serializeDraft({ step: "review", creationKey: key, business: emptyBusiness, account: {}, promotion: { code: "x" } })).not.toContain("promotion");
  });
});

describe("plan de la scène", () => {
  const values = { businessName: "Quincaillerie Koné", activity: "hardware" as const, logo: png, displayName: "" };
  it("construit la boutique étape par étape", () => {
    expect(scenePlan("account", values)).toMatchObject({ foundation: true, structure: false, activity: null, logo: false, welcome: false });
    expect(scenePlan("identity", values)).toMatchObject({ structure: true, sign: true, signText: "Quincaillerie Koné", activity: "hardware", interior: false });
    expect(scenePlan("details", values)).toMatchObject({ interior: false, lights: false, logo: false });
    expect(scenePlan("branding", values)).toMatchObject({ interior: true, lights: true });
    expect(scenePlan("branding", { ...values, displayName: "Koné & Fils" })).toMatchObject({ logo: true, signText: "Koné & Fils" });
    expect(scenePlan("review", { ...values, logo: "" })).toMatchObject({ finished: true, logo: false });
    expect(scenePlan("welcome", values)).toMatchObject({ welcome: true, finished: true });
  });

  it("suit la saisie champ par champ, sans attendre le changement d'étape", () => {
    expect(scenePlan("account", values, 0).groundwork).toBe(0);
    expect(scenePlan("account", values, 2).groundwork).toBe(0.5);
    expect(scenePlan("account", values, 9).groundwork).toBe(1);
    expect(scenePlan("identity", values, 0).groundwork).toBe(1);
    // Murs, enseigne et rayonnages apparaissent dès la première lettre du nom.
    const unnamed = { ...values, businessName: "" };
    expect(scenePlan("identity", unnamed)).toMatchObject({ structure: false, sign: false, activity: null });
    expect(scenePlan("identity", { ...unnamed, businessName: "K" })).toMatchObject({ structure: true, sign: true, activity: "hardware", signText: "K" });
    // Comptoir avec le téléphone, éclairage avec l'adresse.
    expect(scenePlan("details", { ...values, phone: "07" })).toMatchObject({ interior: true, lights: false });
    expect(scenePlan("details", { ...values, address: "Cocody" })).toMatchObject({ interior: false, lights: true });
  });

  it("ne redessine pas la scène quand la saisie ne change rien de visible", () => {
    const a = scenePlan("details", { ...values, phone: "07" });
    expect(samePlan(a, scenePlan("details", { ...values, phone: "07 08" }))).toBe(true);
    expect(samePlan(a, scenePlan("details", { ...values, phone: "07", address: "Plateau" }))).toBe(false);
    expect(samePlan(scenePlan("identity", values), scenePlan("identity", { ...values, businessName: "Koné" }))).toBe(false);
  });
});

describe("choix du rendu selon l'appareil", () => {
  it("3D en pleine qualité sur un ordinateur capable", () => expect(chooseSceneMode(desktop)).toEqual({ mode: "3d", tier: "high" }));
  it("3D en qualité réduite sur téléphone, tablette ou appareil modeste", () => {
    expect(chooseSceneMode({ ...desktop, width: 390, coarsePointer: true })).toEqual({ mode: "3d", tier: "low" });
    expect(chooseSceneMode({ ...desktop, width: 768 })).toEqual({ mode: "3d", tier: "low" });
    expect(chooseSceneMode({ ...desktop, deviceMemory: 2 })).toEqual({ mode: "3d", tier: "low" });
    expect(chooseSceneMode({ ...desktop, hardwareConcurrency: 4 })).toEqual({ mode: "3d", tier: "low" });
  });
  it("illustration statique sans WebGL, avec mouvement réduit ou économie de données", () => {
    expect(chooseSceneMode({ ...desktop, webgl: false }).mode).toBe("static");
    expect(chooseSceneMode({ ...desktop, reducedMotion: true }).mode).toBe("static");
    expect(chooseSceneMode({ ...desktop, width: 360, saveData: true }).mode).toBe("static");
  });
});
