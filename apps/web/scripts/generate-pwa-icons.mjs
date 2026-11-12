/*
 * Génère toutes les icônes de l'application (onglet du navigateur, écran d'accueil, manifest) à partir
 * d'UNE source : `public/brand/qadr-app-icon.svg` (ou `qadr-app-icon.png`, au moins 1024 px, si le logo
 * officiel est fourni en image). Remplacer ce fichier puis relancer `node scripts/generate-pwa-icons.mjs`
 * depuis `apps/web` suffit à changer l'icône partout. Les PNG produits sont versionnés dans public/icons.
 * `sharp` est déjà présent comme dépendance facultative de Next.js : aucune dépendance ajoutée.
 *
 * Source SVG attendue : un fond plein cadre de 512 × 512 (`<rect width="512" height="512" …>`) et le dessin
 * dans `<g id="mascotte" …>`, ce qui permet d'arrondir la tuile et de réduire le dessin dans la zone sûre
 * des icônes « maskable ». Une source PNG est simplement redimensionnée (fond plein cadre exigé).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const brandDir = resolve(process.cwd(), "public/brand");
const svgPath = resolve(brandDir, "qadr-app-icon.svg");
const pngPath = resolve(brandDir, "qadr-app-icon.png");
const outDir = resolve(process.cwd(), "public/icons");
mkdirSync(outDir, { recursive: true });

const jobs = [
  // « any » : tuile arrondie.
  { file: "icon-192.png", size: 192, radius: 112, scale: 1 },
  { file: "icon-512.png", size: 512, radius: 112, scale: 1 },
  // Onglet du navigateur.
  { file: "favicon-32.png", size: 32, radius: 112, scale: 1.12 },
  { file: "favicon-48.png", size: 48, radius: 112, scale: 1.12 },
  // « maskable » : fond plein bord à bord, dessin réduit dans la zone sûre (cercle de 80 %).
  { file: "icon-maskable-512.png", size: 512, radius: 0, scale: 0.74 },
  // Écran d'accueil iOS : fond plein (iOS arrondit lui-même), pas de transparence.
  { file: "apple-touch-icon.png", size: 180, radius: 0, scale: 0.9 },
];

const roundedMask = (radius) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}"/></svg>`);

async function fromSvg(job) {
  const source = readFileSync(svgPath, "utf8");
  const background = '<rect width="512" height="512"';
  const drawing = '<g id="mascotte"';
  if (!source.includes(background) || !source.includes(drawing)) throw new Error("qadr-app-icon.svg : fond 512 × 512 ou groupe « mascotte » introuvable (voir l'en-tête de ce script).");
  const svg = source
    .replace(background, `${background} rx="${job.radius}"`)
    .replace(drawing, `<g transform="translate(256 256) scale(${job.scale}) translate(-256 -256)">${drawing}`)
    .replace("</svg>", "</g></svg>");
  return sharp(Buffer.from(svg), { density: 300 }).resize(job.size, job.size);
}

async function fromPng(job) {
  // Image fournie : pas de réduction du dessin possible, la zone sûre doit déjà être respectée par le fichier.
  const base = sharp(pngPath).resize(512, 512, { fit: "cover" });
  const image = job.radius > 0 ? sharp(await base.composite([{ input: roundedMask(job.radius), blend: "dest-in" }]).png().toBuffer()) : base.flatten({ background: "#03108e" });
  return image.resize(job.size, job.size);
}

const usePng = existsSync(pngPath);
if (!usePng && !existsSync(svgPath)) throw new Error("Aucune source : public/brand/qadr-app-icon.svg ou qadr-app-icon.png.");
for (const job of jobs) {
  const image = await (usePng ? fromPng(job) : fromSvg(job));
  await image.png({ compressionLevel: 9 }).toFile(resolve(outDir, job.file));
  console.log(`public/icons/${job.file} (${job.size}×${job.size}) depuis ${usePng ? "qadr-app-icon.png" : "qadr-app-icon.svg"}`);
}
