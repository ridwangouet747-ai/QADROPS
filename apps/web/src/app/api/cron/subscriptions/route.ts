import * as Sentry from "@sentry/nextjs";
import { timingSafeEqual } from "node:crypto";
import { getBillingProvider } from "@/lib/billing";
import { getDatabase } from "@/lib/db/client";
import { errorResponse } from "@/lib/domain/business-context";
import { purgeStoredFiles } from "@/lib/domain/stored-files";
import { reconcilePendingSubscriptionPayments } from "@/lib/domain/subscription-billing";
import { expireDueSubscriptions } from "@/lib/domain/subscription-lifecycle";
import { getFileStorage } from "@/lib/storage/config";

export const runtime = "nodejs";

/**
 * Passage planifié quotidien des abonnements (Vercel Cron ou équivalent), protégé par CRON_SECRET :
 * rapprochement des paiements GeniusPay restés en attente, expiration, puis purge du stockage privé.
 * Sans secret configuré, la route n'existe pas. L'accès est de toute façon refusé dès l'échéance
 * par assertBusinessOperational, et la console normalise les statuts à chaque lecture.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return new Response(null, { status: 404 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 401 });
  try {
    const db = getDatabase();
    // Rapprochement GeniusPay d'abord : un paiement abouti dont le webhook s'est perdu prolonge l'abonnement
    // avant le passage d'expiration. Une panne du prestataire n'empêche jamais l'expiration.
    let billing: Awaited<ReturnType<typeof reconcilePendingSubscriptionPayments>> | { error: true };
    try { billing = await reconcilePendingSubscriptionPayments(db, getBillingProvider()); } catch (error) {
      Sentry.captureException(error);
      billing = { error: true };
    }
    const subscriptions = await expireDueSubscriptions(db);
    // Même passage quotidien (aucun nouvel horaire à déclarer) : fichiers échus et orphelins du stockage privé.
    // Une panne du stockage n'empêche pas l'expiration des abonnements, déjà faite ci-dessus.
    const storage = await Promise.resolve().then(() => purgeStoredFiles(db, getFileStorage())).catch((error: unknown) => {
      Sentry.captureException(error);
      return { error: "storage_purge_failed" as const };
    });
    return Response.json({ ...subscriptions, billing, storage });
  } catch (error) { return errorResponse(error); }
}
