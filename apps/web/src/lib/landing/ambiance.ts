/*
 * Images d'ambiance de la page publique (2026-11-17) : trois photos de boutiques et le fond « salle quadrillée ».
 *
 * Provenance : images fournies par le propriétaire, générées par IA. Ce sont des illustrations des métiers visés,
 * jamais des clients, des témoignages ni des preuves de résultats : texte alternatif « Illustration : … » et mention
 * visible sous la section des commerces (landing-content.test.ts). Recadrages choisis pour écarter les marques
 * (enseignes de luxe de la boutique de vêtements, panneau de modèles de téléphones, grands cartons d'outillage) ;
 * détail et procédure dans docs/product/landing-page.md § 5 bis.
 *
 * Seules les images listées ici sont servies sous public/landing/ambiance ; le test le vérifie dans les deux sens.
 * Le fond de salle est lu par landing.css (url en dur dans la feuille de style) ; il est listé ici pour ce contrôle.
 */

export type AmbianceSector = "hardware" | "phones" | "clothing";

type Photo = {
  name: string;
  widths: readonly [number, number];
  /** Hauteur de la grande largeur (rapport conservé pour la petite). */
  height: number;
  /** Cadrage dans la carte : bande paysage (téléphone, tablette), puis portrait 4:5 (≥ 1024 px). */
  position: string;
  positionLg: string;
};

const photos: Record<AmbianceSector, Photo> = {
  hardware: { name: "quincaillerie", widths: [368, 736], height: 920, position: "50% 18%", positionLg: "50% 50%" },
  phones: { name: "telephonie", widths: [300, 600], height: 750, position: "50% 88%", positionLg: "50% 50%" },
  clothing: { name: "vetements", widths: [368, 736], height: 570, position: "50% 30%", positionLg: "18% 50%" },
};

export const ambianceRoomFile = "salle-quadrillee.webp";

const url = (file: string) => `/landing/ambiance/${file}`;
const file = (name: string, width: number) => `${name}-${width}.webp`;

/** Photo d'ambiance d'un métier : source, jeu de largeurs, dimensions intrinsèques et cadrage. */
export function ambiancePhoto(sector: AmbianceSector) {
  const photo = photos[sector];
  return {
    src: url(file(photo.name, photo.widths[1])),
    srcSet: photo.widths.map((width) => `${url(file(photo.name, width))} ${width}w`).join(", "),
    sizes: "(min-width: 1024px) 280px, (min-width: 640px) 50vw, 100vw",
    width: photo.widths[1],
    height: photo.height,
    position: photo.position,
    positionLg: photo.positionLg,
  };
}

export const ambianceSectors = Object.keys(photos) as AmbianceSector[];

/** Fichiers (relatifs à public/landing/ambiance) de toutes les images servies. */
export function ambianceFiles(): string[] {
  return [ambianceRoomFile, ...ambianceSectors.flatMap((sector) => photos[sector].widths.map((width) => file(photos[sector].name, width)))];
}
