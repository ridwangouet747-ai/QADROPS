/*
 * Identité de marque : la SEULE liste des fichiers du logo. Aucun composant n'écrit un chemin de logo lui-même ;
 * tous passent par `components/brand/brand-logo.tsx`, qui lit cette liste.
 *
 * État au 2026-11-10 : les fichiers de `public/brand/` sont une INTERPRÉTATION PROVISOIRE de la mascotte
 * (pieuvre bleue au sac), en attendant le fichier officiel du propriétaire. Pour installer le logo officiel :
 *   1. remplacer `public/brand/qadr-mark.svg` (couleur) et `qadr-mark-mono.svg` (une encre), ou déposer des PNG
 *      et corriger `src`, `width` et `height` ci-dessous ;
 *   2. remplacer `public/brand/qadr-app-icon.svg` (ou déposer `qadr-app-icon.png`, 1024 px au moins) ;
 *   3. lancer `node scripts/generate-pwa-icons.mjs` depuis `apps/web` (onglet, écran d'accueil, manifest) ;
 *   4. passer `provisional` à `false`.
 * Voir docs/design/direction-artistique.md § 5.
 */
export const brand = {
  name: "Qadr Ops",
  provisional: true,
  /** Marque en couleur : fonds clairs et fonds bleu nuit. */
  mark: { src: "/brand/qadr-mark.svg", width: 196, height: 184 },
  /** Marque à une encre : console Super Admin (identité monochrome), impressions. */
  markMono: { src: "/brand/qadr-mark-mono.svg", width: 196, height: 184 },
  /** Icônes produites par scripts/generate-pwa-icons.mjs à partir de public/brand/qadr-app-icon.svg. */
  icons: {
    favicon32: "/icons/favicon-32.png",
    favicon48: "/icons/favicon-48.png",
    icon192: "/icons/icon-192.png",
    icon512: "/icons/icon-512.png",
    maskable512: "/icons/icon-maskable-512.png",
    appleTouch: "/icons/apple-touch-icon.png",
  },
} as const;

export type BrandTone = "color" | "mono";
