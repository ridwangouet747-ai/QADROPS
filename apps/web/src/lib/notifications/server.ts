import { runAfterResponse } from "../auth/server";
import type { CommercialDatabase } from "../domain/commercial";
import { processNotificationOutbox } from "../domain/notifications";
import { createWebPushSender, type PushSender } from "./web-push";

/** Clés VAPID lues dans l'environnement ; sans elles, les notifications internes marchent et le push est sauté (« non configuré »). */
export function vapidFromEnvironment() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function pushSenderFromEnvironment(): PushSender | null {
  const keys = vapidFromEnvironment();
  return keys ? createWebPushSender(keys) : null;
}

/**
 * Traitement après la réponse HTTP : l'opération métier est déjà validée et renvoyée ; une panne du
 * traitement (base occupée, service push en panne) ne la touche pas. La tâche planifiée rattrape le reste.
 */
export function processNotificationsAfterResponse(db: CommercialDatabase) {
  runAfterResponse(processNotificationOutbox(db, { sender: pushSenderFromEnvironment(), limit: 10 }).catch(() => undefined));
}
