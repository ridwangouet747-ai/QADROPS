/*
 * Garde-fou des tests de charge Qadr Ops (mission 11, phase 7).
 *
 * Un test de charge ne vise JAMAIS la production : il crée des ventes, sature la base et coûte des
 * ressources facturées. Ce module refuse toute cible dont le nom d'hôte ne porte pas un marqueur
 * explicite de préproduction. Il n'existe volontairement aucune option pour passer outre.
 *
 * Module sans dépendance k6 : il est aussi vérifié par Vitest (src/test/load-test-guard.test.ts).
 */

/** Libellés de nom d'hôte acceptés (un libellé complet, séparé par « . » ou « - »). */
export const PREPRODUCTION_LABELS = ["staging", "preview", "preprod", "qa", "sandbox", "test", "dev"];

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

/**
 * Renvoie l'URL normalisée (sans « / » final) si elle désigne une préproduction, sinon lève une erreur.
 * Acceptées : localhost, 127.0.0.1, [::1], *.localhost, *.test, ou un hôte dont un libellé est l'un de
 * PREPRODUCTION_LABELS (ex. staging.exemple.com, qadr-ops-git-main-preview.vercel.app).
 */
export function assertPreproductionTarget(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("QADR_LOAD_BASE_URL est obligatoire (URL de la préproduction, jamais la production).");
  }
  // Analyse sans `URL` : l'objet global n'existe pas dans tous les environnements k6.
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(raw.trim());
  if (!parts) throw new Error("QADR_LOAD_BASE_URL n'est pas une URL valide.");
  const scheme = parts[1].toLowerCase();
  const authority = parts[2];
  if (scheme !== "https" && scheme !== "http") throw new Error("QADR_LOAD_BASE_URL doit commencer par http:// ou https://.");
  if (authority.includes("@")) throw new Error("QADR_LOAD_BASE_URL ne doit contenir aucun identifiant.");
  const hostPort = /^(\[::1\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(authority);
  if (!hostPort || hostPort[1].startsWith(".") || hostPort[1].endsWith(".") || hostPort[1].includes("..")) {
    throw new Error("QADR_LOAD_BASE_URL n'est pas une URL valide.");
  }
  const host = hostPort[1].toLowerCase();
  const local = LOCAL_HOSTS.includes(host) || host.endsWith(".localhost") || host.endsWith(".test");
  const labels = host.split(/[.-]/);
  const marked = labels.some((label) => PREPRODUCTION_LABELS.includes(label));
  if (!local && !marked) {
    throw new Error(`Cible refusée : « ${host} » ne porte aucun marqueur de préproduction (${PREPRODUCTION_LABELS.join(", ")}, localhost). `
      + "Les tests de charge ne s'exécutent jamais contre la production.");
  }
  if (!local && scheme !== "https") throw new Error("Une préproduction distante doit être servie en HTTPS.");
  const port = hostPort[2] && !((scheme === "https" && hostPort[2] === "443") || (scheme === "http" && hostPort[2] === "80")) ? `:${hostPort[2]}` : "";
  return `${scheme}://${host}${port}${parts[3].replace(/\/+$/, "")}`;
}
