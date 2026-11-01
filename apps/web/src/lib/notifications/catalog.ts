/*
 * Catalogue des notifications (mission 10) : catégories, événements métier réellement émis par le code,
 * variables autorisées et modèles par défaut. Pur et sans base : partagé par le serveur, la console
 * Super Admin (aperçu) et les tests.
 *
 * Règle de confidentialité : aucune variable ne porte de montant ni de donnée client. Le titre ne peut
 * utiliser que des variables « sûres pour le push » ; le corps peut citer un produit, mais le message push
 * n'en reprend jamais le corps (texte générique), il ouvre une page protégée de Qadr Ops.
 */

export const categories = ["commercial", "security", "subscription", "system", "announcement"] as const;
export type Category = (typeof categories)[number];
export const locales = ["fr", "en", "ar"] as const;
export type NotificationLocale = (typeof locales)[number];

/** Catégories transactionnelles : jamais retardées par la plage de tranquillité, toujours visibles dans l'application. */
export const transactionalCategories = new Set<Category>(["security", "subscription"]);

export const icons = ["bell", "cart", "wallet", "warning", "box", "shield", "tag", "info", "users", "receipt"] as const;
export type NotificationIcon = (typeof icons)[number];

export const variables = ["business_name", "user_name", "event_date", "event_type", "status", "product_name"] as const;
export type Variable = (typeof variables)[number];
/** Variables utilisables dans un titre (affiché aussi sur l'écran verrouillé du téléphone). */
export const pushSafeVariables = new Set<Variable>(["business_name", "user_name", "event_date", "event_type", "status"]);

export type EventKey = "sale.created" | "payment.pending" | "stock.low" | "stock.out" | "cash.closing_gap" | "subscription.expiring" | "business.suspended" | "system.test";

/** Destinataires : membres actifs du commerce qui ont cette permission (jamais l'auteur de l'opération pour ses propres ventes). */
export const eventDefinitions: Record<EventKey, { category: Category; permission: [string, string] | null; link: (payload: Record<string, string>) => string | null; skipActor: boolean }> = {
  "sale.created": { category: "commercial", permission: ["report", "read"], link: (p) => (p.saleId ? `/business/sales/${p.saleId}` : "/business/sales"), skipActor: true },
  "payment.pending": { category: "commercial", permission: ["payment", "read"], link: (p) => (p.saleId ? `/business/sales/${p.saleId}` : "/business/sales"), skipActor: false },
  "stock.low": { category: "commercial", permission: ["inventory", "read"], link: () => "/business/stock", skipActor: false },
  "stock.out": { category: "commercial", permission: ["inventory", "read"], link: () => "/business/stock", skipActor: false },
  "cash.closing_gap": { category: "commercial", permission: ["cash", "audit"], link: () => "/business/cash", skipActor: false },
  "subscription.expiring": { category: "subscription", permission: ["business", "update"], link: () => "/business/subscription", skipActor: false },
  // Une suspension bloque tout le monde : chaque membre actif est prévenu, quel que soit son rôle.
  "business.suspended": { category: "security", permission: null, link: () => "/business/subscription", skipActor: false },
  "system.test": { category: "system", permission: null, link: () => null, skipActor: false },
};

export type TemplateText = { titleFr: string; titleEn: string; titleAr: string; bodyFr: string; bodyEn: string; bodyAr: string };
export type TemplateDefinition = TemplateText & { key: string; kind: "event" | "announcement"; category: Category; icon: NotificationIcon; linkPath: string | null; active: boolean };

/** Modèles fournis : utilisés tant que la console n'en a pas enregistré une version modifiée. */
export const defaultTemplates: TemplateDefinition[] = [
  { key: "sale.created", kind: "event", category: "commercial", icon: "cart", linkPath: null, active: true,
    titleFr: "Nouvelle vente", titleEn: "New sale", titleAr: "عملية بيع جديدة",
    bodyFr: "{{user_name}} a enregistré une vente le {{event_date}}.", bodyEn: "{{user_name}} recorded a sale on {{event_date}}.", bodyAr: "سجّل {{user_name}} عملية بيع في {{event_date}}." },
  { key: "payment.pending", kind: "event", category: "commercial", icon: "wallet", linkPath: null, active: true,
    titleFr: "Paiement en attente", titleEn: "Payment pending", titleAr: "دفعة قيد الانتظار",
    bodyFr: "Un paiement Mobile Money attend une confirmation ({{event_date}}).", bodyEn: "A Mobile Money payment is awaiting confirmation ({{event_date}}).", bodyAr: "دفعة بالهاتف المحمول في انتظار التأكيد ({{event_date}})." },
  { key: "stock.low", kind: "event", category: "commercial", icon: "box", linkPath: null, active: true,
    titleFr: "Stock faible", titleEn: "Low stock", titleAr: "مخزون منخفض",
    bodyFr: "{{product_name}} arrive sous le seuil d’alerte.", bodyEn: "{{product_name}} is below its alert level.", bodyAr: "{{product_name}} تحت حدّ التنبيه." },
  { key: "stock.out", kind: "event", category: "commercial", icon: "warning", linkPath: null, active: true,
    titleFr: "Produit épuisé", titleEn: "Out of stock", titleAr: "نفد المنتج",
    bodyFr: "{{product_name}} n’est plus en stock.", bodyEn: "{{product_name}} is out of stock.", bodyAr: "لم يعد {{product_name}} متوفرًا في المخزون." },
  { key: "cash.closing_gap", kind: "event", category: "commercial", icon: "wallet", linkPath: null, active: true,
    titleFr: "Écart de caisse", titleEn: "Till difference", titleAr: "فرق في الصندوق",
    bodyFr: "La caisse de {{user_name}} a été clôturée avec un écart ({{status}}).", bodyEn: "{{user_name}}’s till was closed with a difference ({{status}}).", bodyAr: "أُغلق صندوق {{user_name}} بفرق ({{status}})." },
  { key: "subscription.expiring", kind: "event", category: "subscription", icon: "tag", linkPath: null, active: true,
    titleFr: "Abonnement bientôt terminé", titleEn: "Subscription ending soon", titleAr: "الاشتراك ينتهي قريبًا",
    bodyFr: "L’abonnement de {{business_name}} se termine le {{event_date}}.", bodyEn: "{{business_name}}’s subscription ends on {{event_date}}.", bodyAr: "ينتهي اشتراك {{business_name}} في {{event_date}}." },
  { key: "business.suspended", kind: "event", category: "security", icon: "shield", linkPath: null, active: true,
    titleFr: "Commerce suspendu", titleEn: "Business suspended", titleAr: "تم تعليق المتجر",
    bodyFr: "{{business_name}} est suspendu par Qadr Agency. Vos données restent consultables.", bodyEn: "{{business_name}} has been suspended by Qadr Agency. Your data remains available.", bodyAr: "علّقت Qadr Agency المتجر {{business_name}}. تبقى بياناتك متاحة للاطلاع." },
  { key: "system.test", kind: "event", category: "system", icon: "info", linkPath: null, active: true,
    titleFr: "Notification de test", titleEn: "Test notification", titleAr: "إشعار تجريبي",
    bodyFr: "Ceci est un test envoyé depuis la console Qadr Ops ({{event_date}}).", bodyEn: "This is a test sent from the Qadr Ops console ({{event_date}}).", bodyAr: "هذا اختبار أُرسل من لوحة Qadr Ops ({{event_date}})." },
];

/** Texte générique du message push : le détail reste dans l'application, derrière la connexion. */
export const pushGenericBody: Record<NotificationLocale, string> = {
  fr: "Ouvrez Qadr Ops pour voir le détail.", en: "Open Qadr Ops to see the details.", ar: "افتح Qadr Ops لرؤية التفاصيل.",
};

const placeholder = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Contrôle d'un modèle avant enregistrement : variables connues seulement, titres sans variable confidentielle, pas de balisage. */
export function validateTemplateText(text: TemplateText) {
  const problems: string[] = [];
  for (const locale of locales) {
    const suffix = locale === "fr" ? "Fr" : locale === "en" ? "En" : "Ar";
    const title = text[`title${suffix}`];
    const body = text[`body${suffix}`];
    for (const [field, value, max] of [[`title${suffix}`, title, 120], [`body${suffix}`, body, 500]] as const) {
      if (!value.trim()) problems.push(`${field}:empty`);
      if (value.length > max) problems.push(`${field}:too_long`);
      if (/[<>]/.test(value)) problems.push(`${field}:markup`);
      for (const match of value.matchAll(placeholder)) {
        const name = match[1] as Variable;
        if (!(variables as readonly string[]).includes(name)) problems.push(`${field}:unknown_variable:${name}`);
        else if (field.startsWith("title") && !pushSafeVariables.has(name)) problems.push(`${field}:unsafe_variable:${name}`);
      }
    }
  }
  return problems;
}

/** Remplacement littéral des variables autorisées (aucune évaluation) ; une variable absente devient vide. */
export function renderText(template: string, values: Partial<Record<Variable, string>>) {
  return template.replace(placeholder, (_, name: string) => ((variables as readonly string[]).includes(name) ? (values[name as Variable] ?? "").slice(0, 120) : ""))
    .replace(/\s{2,}/g, " ").trim();
}

export function localizedTemplate(template: TemplateText, locale: NotificationLocale) {
  return locale === "en" ? { title: template.titleEn, body: template.bodyEn } : locale === "ar" ? { title: template.titleAr, body: template.bodyAr } : { title: template.titleFr, body: template.bodyFr };
}

/** Préférences par catégorie (défauts prudents : rien de promotionnel en push sans accord). */
export type CategoryPreference = { inApp: boolean; push: boolean };
export const defaultCategoryPreferences: Record<Category, CategoryPreference> = {
  commercial: { inApp: true, push: true }, security: { inApp: true, push: true }, subscription: { inApp: true, push: true },
  system: { inApp: true, push: false }, announcement: { inApp: true, push: false },
};

export function effectivePreference(stored: unknown, category: Category): CategoryPreference {
  const fallback = defaultCategoryPreferences[category];
  const entry = (stored && typeof stored === "object" ? (stored as Record<string, unknown>)[category] : null) as Partial<CategoryPreference> | null;
  const preference = { inApp: typeof entry?.inApp === "boolean" ? entry.inApp : fallback.inApp, push: typeof entry?.push === "boolean" ? entry.push : fallback.push };
  // Sécurité et abonnement : toujours visibles dans l'application.
  if (transactionalCategories.has(category)) preference.inApp = true;
  return preference;
}

/** Vrai si `minute` (0–1439, heure locale) est dans la plage [start, end), plage pouvant passer minuit. */
export function inQuietHours(minute: number, start: number | null, end: number | null) {
  if (start === null || end === null || start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** Minute de la journée dans un fuseau donné. */
export function localMinute(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
}

/** Segments d'annonce : critères calculés par le serveur, jamais une liste de destinataires fournie par le client. */
export const segmentActivities = ["hardware", "phones", "general", "clothing"] as const;
export const segmentLifecycles = ["active", "trialing", "expired"] as const;
export type Segment = { activities?: (typeof segmentActivities)[number][]; subscriptionStatuses?: (typeof segmentLifecycles)[number][]; roles?: ("owner" | "admin" | "all")[] };
