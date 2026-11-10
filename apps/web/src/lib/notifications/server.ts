import { runAfterResponse } from "../auth/server";
import type { CommercialDatabase } from "../domain/commercial";
import { processNotificationOutbox } from "../domain/notifications";
import { readVapidKeys, vapidSubjectProblem } from "./vapid-config";
import { createWebPushSender, type PushSender } from "./web-push";

let placeholderWarned = false;

/**
 * Clés VAPID lues dans l'environnement ; sans elles, les notifications internes marchent et le push est sauté
 * (« non configuré »). En production, un sujet d'exemple (`@example.com`) désactive aussi le push (voir
 * `vapid-config.ts`) ; un avertissement sans valeur est écrit une fois par processus.
 */
export function vapidFromEnvironment() {
  const keys = readVapidKeys();
  if (!keys && !placeholderWarned && process.env.NODE_ENV === "production" && process.env.VAPID_PUBLIC_KEY?.trim()
    && vapidSubjectProblem(process.env.VAPID_SUBJECT) === "placeholder") {
    placeholderWarned = true;
    console.warn(JSON.stringify({ event: "push.vapid_subject_placeholder", detail: "VAPID_SUBJECT désigne un domaine d’exemple : push désactivé." }));
  }
  return keys;
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
