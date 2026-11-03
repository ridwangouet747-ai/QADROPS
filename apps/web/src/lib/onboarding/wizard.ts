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

/**
 * Code de campagne publique retenu à l'étape récapitulative (docs/promotions.md). Ce n'est qu'une
 * demande : le serveur revérifie tout au moment de créer le commerce et peut la refuser.
 */
export const signupPromotionSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  planCode: z.string().trim().min(2).max(32).optional(),
}).strict();
export type SignupPromotion = z.infer<typeof signupPromotionSchema>;

/** Corps envoyé à POST /api/account/businesses (route et service existants). */
export function toCreateBusinessPayload(values: BusinessValues, creationKey: string, promotion?: SignupPromotion | null) {
  const promo = promotion ? signupPromotionSchema.safeParse(promotion) : null;
  return {
    name: values.businessName.trim(), activity: values.activity, storeFormat: values.storeFormat,
    ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
    ...(values.address.trim() ? { address: values.address.trim() } : {}),
    ...(values.logo ? { logo: values.logo } : {}),
    ...(values.displayName.trim() ? { displayName: values.displayName.trim() } : {}),
    ...(promo?.success ? { promotion: promo.data } : {}),
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
  // Facultatif : un brouillon antérieur à la mission 12 reste lisible.
  promotion: signupPromotionSchema.optional(),
});
export type WizardDraft = z.infer<typeof draftSchema>;

/**
 * Brouillon conservé pour reprendre après un rechargement : uniquement des informations non
 * sensibles. Le mot de passe et sa confirmation ne sont jamais copiés, quel que soit l'objet reçu.
 */
export function serializeDraft(input: { step: WizardStep; creationKey: string; business: BusinessValues; account: Partial<AccountValues>; promotion?: SignupPromotion | null }) {
  const promotion = input.promotion ? signupPromotionSchema.safeParse(input.promotion) : null;
  const draft: WizardDraft = {
    version: 1, step: input.step, creationKey: input.creationKey,
    business: { ...emptyBusiness, ...pick(input.business, ["businessName", "activity", "storeFormat", "phone", "address", "logo", "displayName"]) },
    account: { name: input.account.name ?? "", email: input.account.email ?? "" },
    ...(promotion?.success ? { promotion: promotion.data } : {}),
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
export type SceneInputs = Pick<BusinessValues, "businessName" | "activity" | "logo" | "displayName"> & Partial<Pick<BusinessValues, "phone" | "address">>;

/**
 * Ce que la boutique montre, piloté par la saisie et pas seulement par l'étape : chaque champ rempli
 * fait apparaître son élément au moment où il est tapé (dalle du compte, murs et enseigne avec le
 * nom, comptoir avec le téléphone, éclairage avec l'adresse). Une étape dépassée reste construite,
 * même si ses champs facultatifs sont vides.
 */
export function scenePlan(stage: SceneStage, values: SceneInputs, accountFilled = 0) {
  const order: SceneStage[] = [...wizardSteps, "welcome"];
  const level = order.indexOf(stage);
  const at = (step: SceneStage) => level >= order.indexOf(step);
  const past = (step: SceneStage) => level > order.indexOf(step);
  const filled = (value?: string) => Boolean(value?.trim());
  const named = filled(values.businessName) || filled(values.displayName);
  const structure = past("identity") || (at("identity") && named);
  return {
    level,
    /** Hauteur de la dalle, de 0 à 1 : un quart par champ du compte rempli. */
    groundwork: past("account") ? 1 : Math.min(4, Math.max(0, accountFilled)) / 4,
    foundation: true,
    structure,
    sign: structure,
    signText: (values.displayName.trim() || values.businessName.trim()).slice(0, 40),
    activity: structure ? values.activity : null,
    interior: past("details") || (at("details") && filled(values.phone)),
    lights: past("details") || (at("details") && filled(values.address)),
    logo: at("branding") && values.logo !== "",
    finished: at("review"),
    welcome: stage === "welcome",
  };
}
export type ScenePlan = ReturnType<typeof scenePlan>;

/** Deux plans identiques ne redessinent pas la scène (la saisie d'un champ sans effet visuel reste gratuite). */
export function samePlan(a: ScenePlan, b: ScenePlan) {
  return (Object.keys(a) as (keyof ScenePlan)[]).every((key) => a[key] === b[key]);
}

/* ------------------------------------------------------------------ Choix du rendu */

export type SceneMode = "3d" | "lottie" | "static";
export type SceneTier = "high" | "low";
export type DeviceSignals = {
  webgl: boolean; reducedMotion: boolean; saveData: boolean; width: number;
  deviceMemory?: number; hardwareConcurrency?: number; coarsePointer: boolean;
};

/**
 * Rendu adapté à l'appareil, sans se fier au modèle ni à l'agent utilisateur :
 * - mouvement réduit, économie de données ou WebGL absent → illustration statique (aucun téléchargement de plus) ;
 * - sinon → scène Three.js, en qualité réduite sur écran étroit, tactile, ou mémoire/processeur modestes.
 * Lottie n'est plus choisi d'emblée : il sert de repli animé après une perte de contexte WebGL.
 */
export function chooseSceneMode(signals: DeviceSignals): { mode: SceneMode; tier: SceneTier } {
  if (signals.reducedMotion || signals.saveData || !signals.webgl) return { mode: "static", tier: "low" };
  const modest = (signals.deviceMemory !== undefined && signals.deviceMemory <= 4)
    || (signals.hardwareConcurrency !== undefined && signals.hardwareConcurrency <= 4);
  return { mode: "3d", tier: signals.width < 1024 || signals.coarsePointer || modest ? "low" : "high" };
}
