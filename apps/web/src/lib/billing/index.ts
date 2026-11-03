import { GeniusPayProvider, readGeniusPayConfig, type FetchLike } from "./geniuspay";
import type { BillingProvider } from "./provider";

export type BillingAvailability =
  | { available: true; provider: BillingProvider; appUrl: string }
  | { available: false; reason: "unconfigured" | "invalid" };

/**
 * Adresse publique de l'application pour les retours `success_url`/`error_url`. On réutilise `BETTER_AUTH_URL`,
 * déjà l'adresse publique des liens d'e-mail et des cookies, et déjà exigée en HTTPS en production : une seconde
 * variable pourrait diverger. Hors production, `http://localhost` reste admis.
 */
export function billingAppUrl(source: NodeJS.ProcessEnv = process.env): string | null {
  const raw = source.BETTER_AUTH_URL?.trim() || "http://localhost:3000";
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (source.NODE_ENV === "production" && url.protocol !== "https:") return null;
  return url.origin;
}

/**
 * Prestataire des paiements d'abonnement, construit à chaque requête depuis la configuration serveur
 * (`fetch` global par défaut, ce qui permet aux tests de route de le remplacer sans toucher au reste).
 * Configuration absente ou invalide : paiement en ligne indisponible, l'interface le dit. Le motif d'une
 * configuration invalide part dans les journaux serveur, sans aucune valeur de clé.
 */
export function getBillingProvider(source: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): BillingAvailability {
  const result = readGeniusPayConfig(source);
  if (result.status === "unconfigured") return { available: false, reason: "unconfigured" };
  const appUrl = billingAppUrl(source);
  if (result.status === "invalid" || !appUrl) {
    console.error(`[facturation] GeniusPay désactivé : ${result.status === "invalid" ? result.reason : "BETTER_AUTH_URL doit être une adresse HTTPS en production."}`);
    return { available: false, reason: "invalid" };
  }
  return { available: true, provider: new GeniusPayProvider(result.config, fetchImpl), appUrl };
}

export { BillingProviderError } from "./provider";
export type { BillingProvider, ProviderPayment, ProviderPaymentStatus } from "./provider";
