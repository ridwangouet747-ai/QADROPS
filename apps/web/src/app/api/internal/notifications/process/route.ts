import { isCronAuthorized } from "@/lib/cron-auth";
import { createDatabase } from "@/lib/db/client";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { enqueueExpiringSubscriptions, processNotificationOutbox } from "@/lib/domain/notifications";
import { pushSenderFromEnvironment } from "@/lib/notifications/server";

export const runtime = "nodejs";

/**
 * Tâche planifiée : rattrape la boîte d'envoi et ajoute les échéances d'abonnement.
 * - GET : Vercel Cron, qui envoie `Authorization: Bearer <CRON_SECRET>` (même secret que /api/cron/subscriptions) ;
 * - POST : planificateur externe, avec NOTIFICATIONS_CRON_SECRET (ou CRON_SECRET).
 * Sans secret configuré, la route refuse tout.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), [process.env.NOTIFICATIONS_CRON_SECRET, process.env.CRON_SECRET])) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  const db = createDatabase() as unknown as CommercialDatabase;
  const expiring = await enqueueExpiringSubscriptions(db);
  const summary = await processNotificationOutbox(db, { sender: pushSenderFromEnvironment(), limit: 100 });
  return Response.json({ expiring, ...summary });
}

export const GET = handle;
export const POST = handle;
