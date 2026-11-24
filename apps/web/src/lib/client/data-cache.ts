/**
 * Données déjà reçues, gardées en mémoire de l'onglet pour réafficher un écran tout de suite quand on y revient
 * (mission performance du 2026-11-24). L'écran affiche la dernière réponse connue, puis la remplace dès que la
 * nouvelle arrive : le serveur reste la seule référence et chaque visite le réinterroge.
 *
 * Isolation : chaque entrée porte la portée « compte:commerce » posée par l'espace commerçant. Changer de portée
 * (autre commerce, autre compte) vide tout ; la déconnexion vide tout. Rien n'est écrit sur le disque (ni
 * localStorage, ni IndexedDB, ni service worker) : un rechargement de la page repart de zéro.
 *
 * Autres onglets : la mise en page persistante ne se recalcule pas à chaque navigation, donc un onglet resté ouvert
 * garderait sa portée si le commerce ou le compte change ailleurs. Connexion, choix du commerce et déconnexion
 * l'annoncent (`announceAccountChange`) ; chaque onglet qui l'apprend vide tout et **révoque** sa portée : elle ne
 * peut plus être reprise dans cet onglet, et le cache y reste éteint jusqu'au prochain rendu serveur d'une autre
 * portée (ou un rechargement). Un refus 401/403 fait de même : la session ou le droit a changé.
 */
type Entry = { scope: string; value: unknown };

const MAX_ENTRIES = 40;
const CHANNEL = "qadr-client-cache";
const store = new Map<string, Entry>();
const revoked = new Set<string>();
let scope: string | null = null;
let channel: BroadcastChannel | null = null;

function listen() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => revokeClientCache();
  } catch { channel = null; }
}

/** Portée active ; une portée différente efface toutes les données gardées. Une portée révoquée reste éteinte. */
export function setClientCacheScope(next: string | null) {
  listen();
  const effective = next && revoked.has(next) ? null : next;
  if (effective === scope) return;
  store.clear();
  scope = effective;
}

/** Vide tout ; la portée courante n'est pas révoquée (elle peut être reposée par la mise en page). */
export function clearClientCache() {
  store.clear();
  scope = null;
}

/** Vide tout et interdit de reprendre la portée courante dans cet onglet (compte ou commerce changé). */
export function revokeClientCache() {
  if (scope) revoked.add(scope);
  clearClientCache();
}

/**
 * Prévient les autres onglets qu'on s'est connecté, déconnecté ou qu'on a changé de commerce (ils révoquent leur
 * portée) et vide celui-ci, où la mise en page reposera la nouvelle portée au prochain rendu serveur.
 */
export function announceAccountChange() {
  clearClientCache();
  listen();
  try { channel?.postMessage("account-changed"); } catch { /* onglet unique ou navigateur sans canal : rien à prévenir */ }
}

export function readCached<T>(key: string): T | undefined {
  if (!scope) return undefined;
  const entry = store.get(key);
  return entry && entry.scope === scope ? entry.value as T : undefined;
}

/** Garde une réponse réussie ; sans portée (hors espace commerçant, ou portée révoquée), rien n'est gardé. */
export function writeCached(key: string, value: unknown) {
  if (!scope) return;
  store.delete(key);
  store.set(key, { scope, value });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

/** Retire les entrées dont la clé commence par ce préfixe (après une écriture qui les rend fausses). */
export function forgetCached(prefix: string) {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
}

let writesWatched = false;
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** Vrai pour une écriture vers l'API de l'application (vente, produit, stock, réglages, compte…). */
export function isApiWrite(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (readMethods.has(method)) return false;
  const raw = input instanceof Request ? input.url : String(input);
  try { return new URL(raw, "http://local").pathname.startsWith("/api/"); } catch { return false; }
}

/**
 * Toute écriture vers l'API, quelle que soit sa réponse (une vente sans réponse a peut-être été enregistrée), vide
 * les données gardées au départ et à l'arrivée : en revenant sur un écran après une vente, une modification de
 * produit ou de stock, on n'affiche jamais les chiffres d'avant. Installé une fois par la mise en page commerçant.
 */
export function watchApiWrites() {
  if (writesWatched || typeof window === "undefined" || typeof window.fetch !== "function") return;
  writesWatched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiWrite(input, init)) return original(input, init);
    store.clear();
    return original(input, init).finally(() => store.clear());
  };
}

/**
 * Après un refus du serveur : 401 (session expirée ou fermée) et 403 (droit, commerce ou abonnement changé) vident
 * tout et révoquent la portée ; tout autre statut n'oublie que l'entrée concernée.
 */
export function forgetAfterRefusal(key: string, status: number | null) {
  if (status === 401 || status === 403) revokeClientCache();
  else forgetCached(key);
}
