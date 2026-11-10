/*
 * Lecture des clés VAPID (mission 16). Module pur, sans dépendance serveur, pour être testé seul.
 *
 * `VAPID_SUBJECT` est le contact que le service push (Google, Mozilla, Microsoft, Apple) utilise pour joindre
 * l'exploitant de l'application en cas d'abus ou de panne (RFC 8292 § 2.1 : `mailto:` ou URL `https:`).
 * Une adresse d'exemple (`example.com`, RFC 2606) ou locale n'atteint personne : le service push ne peut pas
 * prévenir avant de bloquer les envois, et certains services refusent un sujet invalide. En production, un
 * tel sujet désactive le push (comportement « non configuré », les notifications internes continuent) au lieu
 * de partir avec un contact inexistant.
 */

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type VapidSubjectProblem = "missing" | "format" | "placeholder";

/** Domaines réservés à l'exemple ou au réseau local (RFC 2606, RFC 6761) et l'exemple français du script. */
const PLACEHOLDER_HOST = /(^|\.)(example|exemple)\.(com|org|net|fr)$|(^|\.)(example|test|invalid|localhost|local)$|^localhost$|^127\.|^\[?::1\]?$/i;

function subjectHost(subject: string) {
  if (subject.startsWith("mailto:")) {
    const address = subject.slice("mailto:".length);
    const match = /^[^@\s]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec(address);
    return match ? match[1]!.toLowerCase() : null;
  }
  if (subject.startsWith("https://") && URL.canParse(subject)) {
    const url = new URL(subject);
    return url.hostname && !url.username && !url.password ? url.hostname.toLowerCase() : null;
  }
  return null;
}

/** Problème du sujet VAPID, ou `null` s'il est utilisable. */
export function vapidSubjectProblem(subject: string | undefined): VapidSubjectProblem | null {
  const value = subject?.trim();
  if (!value) return "missing";
  const host = subjectHost(value);
  if (!host) return "format";
  return PLACEHOLDER_HOST.test(host) ? "placeholder" : null;
}

/**
 * Clés VAPID lues dans l'environnement, ou `null` (push « non configuré »). Hors production, un sujet
 * d'exemple reste toléré pour les essais locaux ; en production il est refusé.
 */
export function readVapidKeys(source: NodeJS.ProcessEnv = process.env): VapidKeys | null {
  const publicKey = source.VAPID_PUBLIC_KEY?.trim();
  const privateKey = source.VAPID_PRIVATE_KEY?.trim();
  const subject = source.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  const problem = vapidSubjectProblem(subject);
  if (problem === "missing" || problem === "format") return null;
  if (problem === "placeholder" && source.NODE_ENV === "production") return null;
  return { publicKey, privateKey, subject };
}
