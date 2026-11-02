/*
 * Catalogue des événements produit (mission 10, docs/analytics.md). Tout événement envoyé à PostHog
 * doit figurer ici, avec ses propriétés autorisées et leurs valeurs possibles (énumérations, booléens,
 * tranches). Aucune propriété libre : ni montant, ni nom, ni téléphone, ni contenu de vente, ni identifiant
 * de commerce ou de client. Ce qui n'est pas au catalogue est supprimé avant l'envoi.
 */

const bucket = ["1", "2-5", "6+"] as const;
const result = ["success", "failure"] as const;

export const analyticsCatalog = {
  signup_completed: {},
  login_succeeded: {},
  login_failed: { reason: ["credentials", "verification", "turnstile", "network", "other"] },
  sale_recorded: { payment_mix: ["cash", "mobile", "mixed", "credit"], line_count: bucket, has_customer: "boolean" },
  sale_failed: { reason: ["stock", "validation", "network", "other"] },
  cart_abandoned: { line_count: bucket },
  product_created: {},
  feature_viewed: { feature: ["dashboard", "pos", "stock", "inventory", "reports", "cash", "sales", "notifications", "printing", "subscription", "team"] },
  report_exported: { format: ["csv", "xlsx", "pdf"], period: ["daily", "weekly", "monthly", "yearly", "custom"] },
  printer_module_toggled: { enabled: "boolean" },
  printer_test_printed: { result },
  print_failed: { error: ["not_paired", "agent_unreachable", "timeout", "paper_out", "disconnected", "connection_refused", "communication_error", "other"] },
  push_enabled: { result, reason: ["unsupported", "insecure", "denied", "unconfigured", "dismissed", "network", "server", "none"] },
  notification_opened: { category: ["commercial", "security", "subscription", "system", "announcement"], surface: ["bell", "inbox", "push"] },
  client_error: { area: ["pos", "cash", "reports", "notifications", "printing", "other"] },
} as const;

export type AnalyticsEvent = keyof typeof analyticsCatalog;
type Spec = (typeof analyticsCatalog)[AnalyticsEvent];
type Value<S> = S extends "boolean" ? boolean : S extends readonly (infer V)[] ? V : never;
export type AnalyticsProperties<E extends AnalyticsEvent> = { [K in keyof (typeof analyticsCatalog)[E]]?: Value<(typeof analyticsCatalog)[E][K]> };

/** Garde uniquement les propriétés et valeurs prévues ; un événement inconnu donne `null` (non envoyé). */
export function sanitizeEvent(event: string, properties: Record<string, unknown> = {}): Record<string, string | boolean> | null {
  if (!Object.hasOwn(analyticsCatalog, event)) return null;
  const spec = analyticsCatalog[event as AnalyticsEvent] as Spec as Record<string, "boolean" | readonly string[]>;
  const clean: Record<string, string | boolean> = {};
  for (const [key, allowed] of Object.entries(spec)) {
    const value = properties[key];
    if (allowed === "boolean" ? typeof value === "boolean" : typeof value === "string" && allowed.includes(value)) clean[key] = value as string | boolean;
  }
  return clean;
}

export const countBucket = (count: number): (typeof bucket)[number] => (count <= 1 ? "1" : count <= 5 ? "2-5" : "6+");

/**
 * Propriétés automatiques de PostHog conservées (techniques, non identifiantes). Les autres (URL complète,
 * titre de page, référent, adresse IP…) sont retirées avant l'envoi : une URL peut contenir un identifiant de vente.
 */
export const keptSystemProperties = new Set(["$lib", "$lib_version", "$os", "$browser", "$browser_version", "$device_type", "$screen_width", "$screen_height", "$viewport_width",
  "$insert_id", "$time", "$session_id", "$window_id", "distinct_id", "token", "$process_person_profile", "$is_identified", "$sent_at"]);

/** Chemin réduit à sa forme générique (« /business/sales/:id ») : aucune valeur propre au commerce. */
export function genericPath(path: string) {
  return path.split("?")[0]!.split("/").map((segment) => (/^[0-9a-f-]{8,}$/i.test(segment) || /\d{3,}/.test(segment) ? ":id" : segment)).join("/");
}
