import { timingSafeEqual } from "node:crypto";
import { createDatabase } from "@/lib/db/client";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { enqueueExpiringSubscriptions, processNotificationOutbox } from "@/lib/domain/notifications";
import { pushSenderFromEnvironment } from "@/lib/notifications/server";

export const runtime = "nodejs";

/**
 * Tâche planifiée (Vercel Cron ou équivalent) : rattrape la boîte d'envoi et ajoute les échéances
 * d'abonnement. Protégée par `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>` (32 caractères au moins) ;
 * sans secret configuré, la route refuse tout.
 */
export async function POST(request: Request) {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET?.trim();
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < 32 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = createDatabase() as unknown as CommercialDatabase;
  const expiring = await enqueueExpiringSubscriptions(db);
  const summary = await processNotificationOutbox(db, { sender: pushSenderFromEnvironment(), limit: 100 });
  return Response.json({ expiring, ...summary });
}
