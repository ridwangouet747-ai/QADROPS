/*
 * Images en trame pour l'imprimante thermique (mission 11, phase 5) : fonctions pures, sans dépendance,
 * utilisables côté serveur, dans le navigateur et dans les tests. Le décodage des fichiers (PNG, JPEG,
 * WebP) est fait par le navigateur (`raster-canvas.ts`), qui fournit des pixels RGBA ; ce module les
 * convertit en niveaux de gris, les met à l'échelle du papier et les réduit à 1 bit (seuil ou tramage).
 *
 * Les calculs d'image utilisent des nombres à virgule : ils ne portent jamais sur un montant.
 */

/** Image 1 bit prête pour GS v 0 : `width` multiple de 8, lignes empaquetées, bit de poids fort à gauche, 1 = noir. */
export type MonoBitmap = { width: number; height: number; data: Uint8Array };
/** Niveaux de gris : 0 = noir, 255 = blanc. */
export type GrayImage = { width: number; height: number; data: Uint8Array };

/** Pixels RGBA (canvas) → gris, la transparence étant posée sur du blanc (le papier). */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  if (rgba.length !== width * height * 4) throw new Error("Pixels RGBA mal formés.");
  const data = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const alpha = rgba[index * 4 + 3]! / 255;
    const luminance = 0.299 * rgba[index * 4]! + 0.587 * rgba[index * 4 + 1]! + 0.114 * rgba[index * 4 + 2]!;
    data[index] = Math.round(luminance * alpha + 255 * (1 - alpha));
  }
  return { width, height, data };
}

/** Mise à l'échelle par moyenne de zone (réduction) ou plus proche voisin (agrandissement). */
export function scaleGray(image: GrayImage, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  const sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil((x + 1) * sx)));
      let sum = 0;
      for (let row = y0; row < y1; row += 1) for (let column = x0; column < x1; column += 1) sum += image.data[row * image.width + column]!;
      data[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, data };
}

/**
 * Taille du logo sur le ticket : au plus 60 % de la largeur imprimable et 120 points de haut en 58 mm
 * (160 en 80 mm), proportions gardées, agrandi au plus deux fois (un petit logo resterait illisible).
 */
export function logoSize(source: { width: number; height: number }, dots: number) {
  const maxWidth = Math.floor((dots * 0.6) / 8) * 8;
  const maxHeight = dots <= 384 ? 120 : 160;
  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 2);
  return { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
}

/**
 * Réduction à 1 bit. `threshold` convient au texte et aux logos en aplats ; `atkinson` (tramage qui
 * diffuse 6/8 de l'erreur) garde les dégradés d'un logo photographique sans noircir les aplats.
 */
export function toMonochrome(image: GrayImage, method: "threshold" | "atkinson" = "threshold", threshold = 128) {
  const black = new Uint8Array(image.width * image.height);
  if (method === "threshold") {
    for (let index = 0; index < black.length; index += 1) black[index] = image.data[index]! < threshold ? 1 : 0;
    return black;
  }
  const work = Float32Array.from(image.data);
  const spread = (x: number, y: number, error: number) => {
    if (x >= 0 && x < image.width && y < image.height) work[y * image.width + x]! += error;
  };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      const value = work[index]!;
      const ink = value < threshold;
      black[index] = ink ? 1 : 0;
      const error = (value - (ink ? 0 : 255)) / 8;
      spread(x + 1, y, error); spread(x + 2, y, error); spread(x - 1, y + 1, error); spread(x, y + 1, error); spread(x + 1, y + 1, error); spread(x, y + 2, error);
    }
  }
  return black;
}

/** Place une image 1 bit au centre d'une bande de `dots` points de large et l'empaquette pour GS v 0. */
export function packCentered(black: Uint8Array, width: number, height: number, dots: number): MonoBitmap {
  if (dots % 8 !== 0 || width > dots) throw new Error("Largeur d'image incompatible avec le papier.");
  const bytesPerRow = dots / 8;
  const data = new Uint8Array(bytesPerRow * height);
  const offset = Math.floor((dots - width) / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!black[y * width + x]) continue;
      const column = offset + x;
      data[y * bytesPerRow + (column >> 3)]! |= 0x80 >> (column & 7);
    }
  }
  return { width: dots, height, data };
}

/** Logo du commerce : pixels RGBA → image 1 bit centrée à la largeur du papier. `null` si l'image est vide. */
export function logoBitmap(rgba: ArrayLike<number>, width: number, height: number, dots: number, method: "threshold" | "atkinson" = "atkinson"): MonoBitmap | null {
  if (width < 1 || height < 1) return null;
  const size = logoSize({ width, height }, dots);
  const black = toMonochrome(scaleGray(rgbaToGray(rgba, width, height), size.width, size.height), method);
  if (!black.some(Boolean)) return null;
  return packCentered(black, size.width, size.height, dots);
}

/** Superpose des images de même largeur (logo puis texte, par exemple). */
export function stackBitmaps(bitmaps: MonoBitmap[]): MonoBitmap {
  const width = bitmaps[0]?.width ?? 8;
  if (bitmaps.some((bitmap) => bitmap.width !== width)) throw new Error("Images de largeurs différentes.");
  const height = bitmaps.reduce((sum, bitmap) => sum + bitmap.height, 0);
  const data = new Uint8Array((width / 8) * height);
  let offset = 0;
  for (const bitmap of bitmaps) { data.set(bitmap.data, offset); offset += bitmap.data.length; }
  return { width, height, data };
}
