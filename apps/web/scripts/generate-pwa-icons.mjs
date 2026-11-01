/*
 * Génère les icônes PNG de l'application installable (mission 11, phase 2) à partir d'un dessin SVG :
 * la tuile « Q » de l'en-tête (dégradé de la marque). Les PNG produits sont versionnés dans public/icons ;
 * relancer ce script seulement si le dessin change : `node scripts/generate-pwa-icons.mjs`.
 * `sharp` est déjà présent comme dépendance facultative de Next.js : aucune dépendance ajoutée.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const gradient = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#7366f6"/><stop offset="0.48" stop-color="#5b4df2"/><stop offset="1" stop-color="#4535d8"/></linearGradient>`;
// « Q » dessiné en traits (anneau + queue) : aucun rendu de police, donc identique sur toutes les machines.
const glyph = (scale) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="58" stroke-linecap="round">
  <circle cx="246" cy="242" r="128"/><path d="M286 284 398 396"/></g>`;

const tile = (scale, radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${gradient}</defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>${glyph(scale)}</svg>`;

const outDir = resolve(process.cwd(), "public/icons");
mkdirSync(outDir, { recursive: true });
const jobs = [
  // « any » : tuile arrondie, comme dans l'en-tête.
  { file: "icon-192.png", size: 192, svg: tile(1, 112) },
  { file: "icon-512.png", size: 512, svg: tile(1, 112) },
  // « maskable » : fond plein bord à bord, dessin réduit dans la zone sûre (cercle de 80 %).
  { file: "icon-maskable-512.png", size: 512, svg: tile(0.72, 0) },
  // Écran d'accueil iOS : fond plein (iOS arrondit lui-même), pas de transparence.
  { file: "apple-touch-icon.png", size: 180, svg: tile(0.86, 0) },
];
for (const job of jobs) {
  await sharp(Buffer.from(job.svg)).resize(job.size, job.size).png({ compressionLevel: 9 }).toFile(resolve(outDir, job.file));
  console.log(`public/icons/${job.file} (${job.size}×${job.size})`);
}
