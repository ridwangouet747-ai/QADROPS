import { z } from "zod";

/*
 * Parcours d'inscription en cinq étapes (mission 08). Fonctions pures, partagées par le formulaire,
 * la scène 3D, l'animation Lottie et l'illustration statique, et testées sans navigateur.
 * Les messages d'erreur sont des clés de traduction (wizard.errors.*), traduites à l'affichage.
 */

export const wizardSteps = ["account", "identity", "details", "branding", "review"] as const;
export type WizardStep = (typeof wizardSteps)[number];
export const activities = ["hardware", "phones", "general", "clothing"] as const;
export type Activity = (typeof activities)[number];
export const storeFormats = ["shop", "kiosk", "wholesale", "other"] as const;
export type StoreFormat = (typeof storeFormats)[number];

const logoPattern = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const accountSchema = z.object({
  name: z.string().trim().min(2, "wizard.errors.nameShort").max(100, "wizard.errors.nameShort"),
  email: z.string().trim().email("wizard.errors.email").max(254, "wizard.errors.email"),
  password: z.string().min(8, "wizard.errors.passwordShort").max(128, "wizard.errors.passwordShort"),
  confirm: z.string(),
}).refine((value) => value.password === value.confirm, { path: ["confirm"], message: "wizard.errors.passwordMismatch" });

export const identitySchema = z.object({
  businessName: z.string().trim().min(2, "wizard.errors.businessName").max(120, "wizard.errors.businessName"),
  activity: z.enum(activities, { message: "wizard.errors.activity" }),
  storeFormat: z.enum(storeFormats, { message: "wizard.errors.storeFormat" }),
});

export const detailsSchema = z.object({
  phone: z.string().trim().max(40, "wizard.errors.phone").refine((value) => value === "" || /^[+0-9 ().-]{6,40}$/.test(value), "wizard.errors.phone"),
  address: z.string().trim().max(200, "wizard.errors.address"),
});

export const brandingSchema = z.object({
  logo: z.string().max(200_000, "wizard.errors.logoSize").refine((value) => value === "" || logoPattern.test(value), "wizard.errors.logoType"),
  displayName: z.string().trim().max(80, "wizard.errors.displayName"),
});

export const businessSchema = identitySchema.and(detailsSchema).and(brandingSchema);
export type AccountValues = z.infer<typeof accountSchema>;
export type BusinessValues = z.infer<typeof businessSchema>;

export const emptyBusiness: BusinessValues = { businessName: "", activity: "general", storeFormat: "shop", phone: "", address: "", logo: "", displayName: "" };

/** Corps envoyé à POST /api/account/businesses (route et service existants). */
export function toCreateBusinessPayload(values: BusinessValues, creationKey: string) {
  return {
    name: values.businessName.trim(), activity: values.activity, storeFormat: values.storeFormat,
    ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
    ...(values.address.trim() ? { address: values.address.trim() } : {}),
    ...(values.logo ? { logo: values.logo } : {}),
    ...(values.displayName.trim() ? { displayName: values.displayName.trim() } : {}),
    creationKey,
  };
}

/* ------------------------------------------------------------------ Brouillon (sessionStorage) */

export const draftStorageKey = "qadr-onboarding-draft";
const draftSchema = z.object({
  version: z.literal(1),
  step: z.enum(wizardSteps),
  creationKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  business: z.object({
    businessName: z.string().max(120), activity: z.enum(activities), storeFormat: z.enum(storeFormats),
    phone: z.string().max(40), address: z.string().max(200), logo: z.string().max(200_000), displayName: z.string().max(80),
  }),
  account: z.object({ name: z.string().max(100), email: z.string().max(254) }),
});
export type WizardDraft = z.infer<typeof draftSchema>;

/**
 * Brouillon conservé pour reprendre après un rechargement : uniquement des informations non
 * sensibles. Le mot de passe et sa confirmation ne sont jamais copiés, quel que soit l'objet reçu.
 */
export function serializeDraft(input: { step: WizardStep; creationKey: string; business: BusinessValues; account: Partial<AccountValues> }) {
  const draft: WizardDraft = {
    version: 1, step: input.step, creationKey: input.creationKey,
    business: { ...emptyBusiness, ...pick(input.business, ["businessName", "activity", "storeFormat", "phone", "address", "logo", "displayName"]) },
    account: { name: input.account.name ?? "", email: input.account.email ?? "" },
  };
  return JSON.stringify(draft);
}

export function parseDraft(raw: string | null): WizardDraft | null {
  if (!raw) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

/** Clé de création du brouillon : rejouer la création renvoie le même commerce (voir createBusiness). */
export function newCreationKey(random: () => string = () => crypto.randomUUID()) {
  return random().replace(/[^A-Za-z0-9_-]/g, "");
}

/* ------------------------------------------------------------------ Scène */

export type SceneStage = WizardStep | "welcome";

/**
 * Ce que montre la boutique à chaque étape : fondations (compte), façade et enseigne (commerce),
 * aménagement selon l'activité dès qu'elle est choisie, comptoir et éclairage (coordonnées), logo
 * (identité), finitions (récapitulatif), ouverture et célébration (après confirmation du serveur).
 */
export function scenePlan(stage: SceneStage, values: Pick<BusinessValues, "businessName" | "activity" | "logo" | "displayName">) {
  const order: SceneStage[] = [...wizardSteps, "welcome"];
  const level = order.indexOf(stage);
  const at = (step: SceneStage) => level >= order.indexOf(step);
  return {
    level,
    foundation: true,
    structure: at("identity"),
    sign: at("identity"),
    signText: (values.displayName.trim() || values.businessName.trim()).slice(0, 40),
    activity: at("identity") ? values.activity : null,
    interior: at("details"),
    logo: at("branding") && values.logo !== "",
    finished: at("review"),
    welcome: stage === "welcome",
  };
}
export type ScenePlan = ReturnType<typeof scenePlan>;

/* ------------------------------------------------------------------ Choix du rendu */

export type SceneMode = "3d" | "lottie" | "static";
export type DeviceSignals = {
  webgl: boolean; reducedMotion: boolean; saveData: boolean; width: number;
  deviceMemory?: number; hardwareConcurrency?: number; coarsePointer: boolean;
};

/**
 * Rendu adapté à l'appareil, sans se fier au modèle ni à l'agent utilisateur :
 * - mouvement réduit ou économie de données → illustration statique (aucun téléchargement de plus) ;
 * - écran étroit, tactile, mémoire ou processeur modestes, ou WebGL absent → animation Lottie légère ;
 * - sinon → scène 3D.
 */
export function chooseSceneMode(signals: DeviceSignals): SceneMode {
  if (signals.reducedMotion || signals.saveData) return "static";
  const modest = (signals.deviceMemory !== undefined && signals.deviceMemory <= 4)
    || (signals.hardwareConcurrency !== undefined && signals.hardwareConcurrency <= 4);
  if (!signals.webgl || signals.width < 1024 || signals.coarsePointer || modest) return "lottie";
  return "3d";
}
