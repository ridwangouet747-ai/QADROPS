/** Titres d'onglet et métadonnées des pages, traduits côté serveur selon la langue de la session. */
export const metaFr = {
  siteTitle: "QADR OPS — Suivez vos ventes, votre stock et votre caisse",
  siteDescription: "Gestion commerciale pour les commerces de proximité : ventes, stock, caisse et crédits, chaque commerce dans son propre espace.",
  register: "Créer un compte · QADR OPS",
  onboarding: "Créer un commerce · QADR OPS",
  login: "Connexion · QADR OPS",
  forgotPassword: "Mot de passe oublié · QADR OPS",
  resetPassword: "Nouveau mot de passe · QADR OPS",
  invitation: "Invitation · QADR OPS",
  selectBusiness: "Choisir un commerce · QADR OPS",
  platform: "Console Qadr Agency · QADR OPS",
  subscription: "Abonnement · QADR OPS",
  reports: "Rapports · QADR OPS",
  cash: "Ma caisse · QADR OPS",
  notifications: "Notifications · QADR OPS",
  printing: "Imprimante · QADR OPS",
  install: "Installer l’application · QADR OPS",
  imports: "Importer un catalogue · QADR OPS",
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type MetaMessages = Shape<typeof metaFr>;

export const metaEn: MetaMessages = {
  siteTitle: "QADR OPS — Track your sales, stock and cash desk",
  siteDescription: "Business management for neighbourhood shops: sales, stock, cash desk and credit, each business in its own space.",
  register: "Create an account · QADR OPS",
  onboarding: "Create a business · QADR OPS",
  login: "Sign in · QADR OPS",
  forgotPassword: "Forgot password · QADR OPS",
  resetPassword: "New password · QADR OPS",
  invitation: "Invitation · QADR OPS",
  selectBusiness: "Choose a business · QADR OPS",
  platform: "Qadr Agency console · QADR OPS",
  subscription: "Subscription · QADR OPS",
  reports: "Reports · QADR OPS",
  cash: "My till · QADR OPS",
  notifications: "Notifications · QADR OPS",
  printing: "Printer · QADR OPS",
  install: "Install the app · QADR OPS",
  imports: "Import a catalogue · QADR OPS",
};

export const metaAr: MetaMessages = {
  siteTitle: "QADR OPS — تابع مبيعاتك ومخزونك وصندوقك",
  siteDescription: "إدارة تجارية للمتاجر الصغيرة: المبيعات والمخزون والصندوق والديون، ولكل متجر مساحته الخاصة.",
  register: "إنشاء حساب · QADR OPS",
  onboarding: "إنشاء متجر · QADR OPS",
  login: "تسجيل الدخول · QADR OPS",
  forgotPassword: "نسيت كلمة المرور · QADR OPS",
  resetPassword: "كلمة مرور جديدة · QADR OPS",
  invitation: "دعوة · QADR OPS",
  selectBusiness: "اختيار متجر · QADR OPS",
  platform: "لوحة Qadr Agency · QADR OPS",
  subscription: "الاشتراك · QADR OPS",
  reports: "التقارير · QADR OPS",
  cash: "صندوقي · QADR OPS",
  notifications: "الإشعارات · QADR OPS",
  printing: "الطابعة · QADR OPS",
  install: "تثبيت التطبيق · QADR OPS",
  imports: "استيراد كتالوج · QADR OPS",
};
