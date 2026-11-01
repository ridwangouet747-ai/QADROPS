/*
 * Côté navigateur : envoi d'un code Qadr Agency et lecture de la réponse du serveur. Le navigateur
 * n'active rien lui-même ; il affiche uniquement ce que le serveur a confirmé.
 */

export const redeemFailures = [
  "invalid", "expired", "not_active", "revoked", "already_used", "exhausted", "business_suspended", "forbidden",
  "incompatible_subscription", "rate_limited", "validation", "network", "unavailable",
] as const;
export type RedeemFailure = (typeof redeemFailures)[number];

export type RedeemSuccess = {
  kind: "access" | "discount"; replayed: boolean; plan: { code: string; name: string } | null;
  status?: string | null; endsAt?: string | null; grantDays?: number | null;
  discountAmountXof?: string; amountDueXof?: string; paymentStatus?: "pending" | "no_payment_due";
};
export type RedeemOutcome = { ok: true; result: RedeemSuccess } | { ok: false; reason: RedeemFailure };

/**
 * Saisie tolérante : majuscules, et un espace entre deux groupes vaut un tiret (un code dicté ou recopié
 * d'un SMS en contient souvent). Le tiret final est conservé pendant la frappe, retiré par finalizeCode.
 */
export function normalizeCodeInput(raw: string) {
  return raw.toUpperCase().replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/^-+/, "");
}

export function finalizeCode(raw: string) {
  return normalizeCodeInput(raw).replace(/-+$/, "");
}

export function isPlausibleCode(code: string) {
  return /^[A-Z0-9-]{3,40}$/.test(code);
}

export function interpretRedeemResponse(status: number, body: unknown): RedeemOutcome {
  const data = typeof body === "object" && body !== null ? body as Record<string, unknown> : null;
  if (status >= 200 && status < 300) {
    return data && (data.kind === "access" || data.kind === "discount") && typeof data.replayed === "boolean"
      ? { ok: true, result: data as unknown as RedeemSuccess }
      : { ok: false, reason: "unavailable" };
  }
  if (status >= 500 || !data) return { ok: false, reason: "unavailable" };
  if (status === 401) return { ok: false, reason: "forbidden" };
  const code = data.code;
  return { ok: false, reason: typeof code === "string" && (redeemFailures as readonly string[]).includes(code) ? code as RedeemFailure : "unavailable" };
}

export async function redeemPromotionCode(code: string, subscriptionId: string | null, fetcher: typeof fetch = fetch): Promise<RedeemOutcome> {
  let response: Response;
  try {
    response = await fetcher("/api/business/subscription/promotion", {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify(subscriptionId ? { code, subscriptionId } : { code }),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  const body = await response.json().catch(() => null);
  return interpretRedeemResponse(response.status, body);
}
