import { describe, expect, it } from "vitest";
import {
  accountSchema, brandingSchema, chooseSceneMode, detailsSchema, emptyBusiness, identitySchema, newCreationKey, parseDraft,
  scenePlan, serializeDraft, toCreateBusinessPayload, type DeviceSignals,
} from "./wizard";

const desktop: DeviceSignals = { webgl: true, reducedMotion: false, saveData: false, width: 1366, deviceMemory: 8, hardwareConcurrency: 8, coarsePointer: false };
const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`;

describe("validation de chaque étape", () => {
  it("compte : nom, e-mail, mot de passe de 8 caractères et confirmation identique", () => {
    expect(accountSchema.safeParse({ name: "Awa", email: "awa@qadr.test", password: "motdepasse", confirm: "motdepasse" }).success).toBe(true);
    const errors = accountSchema.safeParse({ name: "A", email: "pas-un-email", password: "court", confirm: "autre" }).error!.issues.map((issue) => issue.message);
    expect(errors).toEqual(expect.arrayContaining(["wizard.errors.nameShort", "wizard.errors.email", "wizard.errors.passwordShort", "wizard.errors.passwordMismatch"]));
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
});

describe("plan de la scène", () => {
  const values = { businessName: "Quincaillerie Koné", activity: "hardware" as const, logo: png, displayName: "" };
  it("construit la boutique étape par étape", () => {
    expect(scenePlan("account", values)).toMatchObject({ foundation: true, structure: false, activity: null, logo: false, welcome: false });
    expect(scenePlan("identity", values)).toMatchObject({ structure: true, sign: true, signText: "Quincaillerie Koné", activity: "hardware", interior: false });
    expect(scenePlan("details", values)).toMatchObject({ interior: true, logo: false });
    expect(scenePlan("branding", { ...values, displayName: "Koné & Fils" })).toMatchObject({ logo: true, signText: "Koné & Fils" });
    expect(scenePlan("review", { ...values, logo: "" })).toMatchObject({ finished: true, logo: false });
    expect(scenePlan("welcome", values)).toMatchObject({ welcome: true, finished: true });
  });
});

describe("choix du rendu selon l'appareil", () => {
  it("3D sur un ordinateur capable", () => expect(chooseSceneMode(desktop)).toBe("3d"));
  it("Lottie sur téléphone, appareil modeste ou sans WebGL", () => {
    expect(chooseSceneMode({ ...desktop, width: 390, coarsePointer: true })).toBe("lottie");
    expect(chooseSceneMode({ ...desktop, deviceMemory: 2 })).toBe("lottie");
    expect(chooseSceneMode({ ...desktop, hardwareConcurrency: 4 })).toBe("lottie");
    expect(chooseSceneMode({ ...desktop, webgl: false })).toBe("lottie");
  });
  it("illustration statique si le mouvement doit être réduit ou les données économisées", () => {
    expect(chooseSceneMode({ ...desktop, reducedMotion: true })).toBe("static");
    expect(chooseSceneMode({ ...desktop, width: 360, saveData: true })).toBe("static");
  });
});
