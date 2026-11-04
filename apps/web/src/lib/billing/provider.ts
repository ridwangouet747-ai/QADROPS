/**
 * Contrat minimal d'un prestataire de paiement des ABONNEMENTS Qadr Ops (mission 12, lot L1b).
 *
 * Il ne sert qu'aux factures d'abonnement d'un commerce envers Qadr Agency, jamais aux ventes des commerces.
 * Les modules métier ne connaissent que ce contrat : l'adaptateur GeniusPay (`geniuspay.ts`) peut être remplacé
 * sans toucher aux services. Aucun SDK : appels HTTP directs, `fetch` injectable pour les tests.
 */

export type BillingEnvironment = "sandbox" | "live";

/** Statuts normalisés. `unknown` = valeur non documentée : toujours traitée comme « non payé ». */
export type ProviderPaymentStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "refunded" | "expired" | "unknown";

export type CheckoutRequest = {
  /** Montant entier en francs CFA (XOF), recopié de la facture côté serveur. */
  amountXof: bigint;
  currency: "XOF";
  description: string;
  successUrl: string;
  errorUrl: string;
  /** Identifiants techniques seulement (facture, tentative) : jamais de nom, téléphone ou montant de dette. */
  metadata: Record<string, string>;
};

export type CheckoutSession = {
  reference: string;
  checkoutUrl: string;
  status: ProviderPaymentStatus;
  environment: BillingEnvironment | null;
  expiresAt: Date | null;
};

/** Paiement tel que relu chez le prestataire : seule source acceptée pour activer un abonnement. */
export type ProviderPayment = {
  reference: string;
  status: ProviderPaymentStatus;
  rawStatus: string;
  /** Nul si le montant renvoyé n'est pas un entier exact (traité comme montant incorrect). */
  amountXof: bigint | null;
  currency: string | null;
  environment: BillingEnvironment | null;
  metadata: Record<string, string>;
  paymentMethod: string | null;
};

export type WebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "not_configured" | "missing_headers" | "bad_timestamp" | "stale" | "bad_signature";
      /** Diagnostic seulement (journaux) : variante de signature qui aurait correspondu. Ne rend JAMAIS l'événement valide. */
      variant?: string | null };

export interface BillingProvider {
  readonly name: "geniuspay";
  readonly environment: BillingEnvironment;
  createCheckout(input: CheckoutRequest): Promise<CheckoutSession>;
  /** `null` si le prestataire ne connaît pas cette référence. */
  getPayment(reference: string): Promise<ProviderPayment | null>;
  verifyWebhook(rawBody: string, headers: Headers, now?: Date): WebhookVerification;
}

/**
 * Échec d'un appel au prestataire. `code` est celui du prestataire (`PAYMENT_INIT_FAILED`…) ou un code local
 * (`network`, `timeout`, `invalid_response`). Le message n'est jamais montré tel quel au commerçant.
 */
export class BillingProviderError extends Error {
  override readonly name = "BillingProviderError";
  constructor(readonly code: string, readonly httpStatus: number | null, message: string) { super(message); }
}
