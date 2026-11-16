import { getRuntimeDatabase } from "@/lib/db/runtime";
import { getBillingProvider, getConfiguredBillingProvider } from "@/lib/billing";
import { commercialMode } from "@/lib/commercial/mode";
import { errorResponse } from "@/lib/domain/business-context";
import { handleGeniusPayWebhook, recordPausedGeniusPayWebhook } from "@/lib/domain/subscription-billing";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 65_536;

/**
 * Webhook GeniusPay des paiements d'abonnement. Sans configuration (secret absent), la route refuse tout.
 * Le corps est lu BRUT (`request.text()`) : la signature porte sur les octets reçus, jamais sur un JSON ré-encodé.
 * Aucune session : l'authenticité vient de la signature, puis de la relecture du paiement par l'API.
 * Mode `manual_code` (2026-11-16) : signature toujours vérifiée, événement enregistré « en pause », aucun droit
 * accordé, aucun appel à GeniusPay (docs/billing-geniuspay.md § pause).
 */
export async function POST(request: Request) {
  try {
    const paused = commercialMode() !== "geniuspay";
    const billing = paused ? getConfiguredBillingProvider() : getBillingProvider();
    if (!billing.available) return Response.json({ error: "billing_unavailable" }, { status: 503 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const db = await getRuntimeDatabase();
    const result = paused
      ? await recordPausedGeniusPayWebhook(db, billing, rawBody, request.headers)
      : await handleGeniusPayWebhook(db, billing, rawBody, request.headers);
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
