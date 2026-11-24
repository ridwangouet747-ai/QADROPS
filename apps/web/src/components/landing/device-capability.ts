/**
 * Effets décoratifs de la page publique (mouvement GSAP, ticket 3D) : réservés aux appareils et réseaux qui les
 * supportent. Mouvement réduit demandé, économie de données, réseau lent annoncé ou appareil modeste (moins de
 * 4 cœurs ou de 2 Go) : la page reste statique, complète et lisible, sans télécharger ces bibliothèques.
 */
export function decorativeEffectsAllowed() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (["slow-2g", "2g", "3g"].includes(nav.connection?.effectiveType ?? "")) return false;
  return (nav.deviceMemory ?? 4) >= 2 && (nav.hardwareConcurrency ?? 4) >= 4;
}

/** Après l'événement load, au premier moment de repos (au plus tard 3 s ; 1,5 s sans requestIdleCallback). */
export function whenPageIdle() {
  return new Promise<void>((resolve) => {
    const idle = () => { if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 3000 }); else setTimeout(resolve, 1500); };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
}
