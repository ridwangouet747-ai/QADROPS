/**
 * Vente en attente de réponse : la clé d'idempotence survit à un rechargement de l'onglet.
 *
 * Cas visé : « Encaisser », pas de réponse (réseau coupé), la caissière recharge la page puis ressaisit le même
 * panier. Sans mémoire, une nouvelle clé partait et la vente, peut-être déjà enregistrée, l'était deux fois.
 * Désormais la même vente (même empreinte) réutilise la même clé : le serveur rejoue le premier résultat.
 *
 * Ce qui est gardé, dans sessionStorage (cet onglet seulement, effacé à sa fermeture et à la déconnexion) :
 * l'empreinte SHA-256 de la vente, la clé et l'heure. Aucun article, montant, client ni identifiant lisible.
 * Une vente n'est jamais présentée comme enregistrée sur la foi de ce stockage : seule la réponse du serveur compte.
 */
const storageKey = "qadr-pos-pending-sale";
/** Au-delà, une vente identique est une nouvelle vente (même panier vendu deux fois dans la journée). */
export const pendingSaleTtlMs = 2 * 60 * 60 * 1000;

type Pending = { digest: string; key: string; at: number };

function storage(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

export async function saleDigest(fingerprint: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qadr-pos:${fingerprint}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Clé gardée pour cette même vente, si elle date de moins de `pendingSaleTtlMs`. */
export function pendingSaleKey(digest: string, now = Date.now()): string | null {
  try {
    const raw = storage()?.getItem(storageKey);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<Pending>;
    if (pending.digest !== digest || typeof pending.key !== "string" || typeof pending.at !== "number") return null;
    return now - pending.at <= pendingSaleTtlMs ? pending.key : null;
  } catch { return null; }
}

export function rememberPendingSale(digest: string, key: string, now = Date.now()) {
  try { storage()?.setItem(storageKey, JSON.stringify({ digest, key, at: now } satisfies Pending)); } catch { /* stockage indisponible : mémoire seule */ }
}

/** Réponse du serveur reçue (vente enregistrée), déconnexion ou changement de commerce. */
export function forgetPendingSale() {
  try { storage()?.removeItem(storageKey); } catch { /* rien à effacer */ }
}
