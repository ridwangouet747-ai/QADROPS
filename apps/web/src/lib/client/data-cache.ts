/**
 * Données déjà reçues, gardées en mémoire de l'onglet pour réafficher un écran tout de suite quand on y revient
 * (mission performance du 2026-11-24). L'écran affiche la dernière réponse connue, puis la remplace dès que la
 * nouvelle arrive : le serveur reste la seule référence et chaque visite le réinterroge.
 *
 * Isolation : chaque entrée porte la portée « compte:commerce » posée par l'espace commerçant. Changer de portée
 * (autre commerce, autre compte) vide tout ; la déconnexion vide tout. Rien n'est écrit sur le disque (ni
 * localStorage, ni IndexedDB, ni service worker) : un rechargement de la page repart de zéro.
 */
type Entry = { scope: string; value: unknown };

const MAX_ENTRIES = 40;
const store = new Map<string, Entry>();
let scope: string | null = null;

/** Portée active ; une portée différente efface toutes les données gardées. */
export function setClientCacheScope(next: string | null) {
  if (next === scope) return;
  store.clear();
  scope = next;
}

export function clearClientCache() {
  store.clear();
  scope = null;
}

export function readCached<T>(key: string): T | undefined {
  if (!scope) return undefined;
  const entry = store.get(key);
  return entry && entry.scope === scope ? entry.value as T : undefined;
}

/** Garde une réponse réussie ; sans portée (hors espace commerçant), rien n'est gardé. */
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
