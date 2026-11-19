/**
 * Disposition de la section Tarifs selon le nombre de cartes (2026-11-19) : chaque forfait publié dans la console
 * a sa carte, quel que soit leur nombre, plus la carte Business quand elle est montrée.
 *
 * - jusqu'à deux cartes, l'encart du code promotionnel tient à côté ;
 * - quatre cartes forment deux rangées de deux plutôt qu'une rangée de trois et une carte seule ;
 * - au-delà, trois colonnes sur grand écran, deux sur tablette, une sur téléphone : la grille s'allonge en
 *   rangées, sans défilement horizontal ni carte écrasée.
 */
export type PricingLayout = { cards: number; asideBeside: boolean; columns: 1 | 2 | 3 };

export function pricingLayout(planCount: number, withBusiness: boolean): PricingLayout {
  const cards = Math.max(0, planCount) + (withBusiness ? 1 : 0);
  const columns = cards <= 1 ? 1 : cards === 2 || cards === 4 ? 2 : 3;
  return { cards, asideBeside: cards <= 2, columns };
}

/** Classes Tailwind de la liste de cartes (une colonne sous `md`). */
export function pricingColumnsClass(columns: PricingLayout["columns"]): string {
  if (columns === 1) return "";
  return columns === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3";
}
