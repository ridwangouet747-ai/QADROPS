/*
 * Profils d'imprimante thermique (mission 11, phase 5). Un profil réunit ce que le moteur doit savoir pour
 * produire un ticket lisible : largeur du papier (points et colonnes de la police A), page de codes du mode
 * texte et mode d'écriture (texte, image ou automatique).
 *
 * Rien ici n'a été vérifié sur une imprimante réelle (blocage B-2) : les numéros de page de codes sont ceux
 * du jeu de commandes Epson (ESC t n), repris par la plupart des imprimantes « compatibles ESC/POS », mais
 * certains modèles génériques numérotent autrement. Le mode « image » ne dépend d'aucune page de codes.
 */

export type PaperWidth = 58 | 80;
export type CodePage = "pc858" | "pc850" | "wpc1252";
export type RenderMode = "auto" | "text" | "raster";

export const codePages: readonly CodePage[] = ["pc858", "pc850", "wpc1252"];
export const renderModes: readonly RenderMode[] = ["auto", "text", "raster"];

/**
 * Largeur imprimable : 384 points (48 octets par ligne d'image) en 58 mm, 576 points (72 octets) en 80 mm,
 * soit 32 et 48 colonnes en police A (12 × 24 points).
 */
export const paperProfiles: Record<PaperWidth, { widthMm: PaperWidth; dots: number; columns: number }> = {
  58: { widthMm: 58, dots: 384, columns: 32 },
  80: { widthMm: 80, dots: 576, columns: 48 },
};

/** Numéro de la page de codes pour ESC t n (table Epson). */
export const codePageSelector: Record<CodePage, number> = { pc858: 19, pc850: 2, wpc1252: 16 };

export type PrinterProfile = { paperWidthMm: PaperWidth; dots: number; columns: number; codePage: CodePage; renderMode: RenderMode };

export function resolveProfile(device: { paperWidthMm: number; codePage?: string | null; renderMode?: string | null }): PrinterProfile {
  const width: PaperWidth = device.paperWidthMm === 58 ? 58 : 80;
  const codePage = codePages.includes(device.codePage as CodePage) ? device.codePage as CodePage : "pc858";
  const renderMode = renderModes.includes(device.renderMode as RenderMode) ? device.renderMode as RenderMode : "auto";
  return { paperWidthMm: width, dots: paperProfiles[width].dots, columns: paperProfiles[width].columns, codePage, renderMode };
}

/**
 * Mode retenu pour un ticket. En automatique, l'image est choisie dès que le texte ne passe pas par la page
 * de codes (arabe, ou tout caractère qui sortirait en « ? »), et pour tout ticket en arabe : les pages de
 * codes arabes (CP864, Windows-1256) exigent la mise en forme contextuelle et l'ordre visuel, et leur
 * numérotation varie d'un fabricant à l'autre. L'image, rendue par le navigateur, est la voie la plus sûre
 * sans matériel pour vérifier.
 */
export function chooseRender(profile: PrinterProfile, ticket: { direction: "ltr" | "rtl"; unsupportedCharacters: number }): "text" | "raster" {
  if (profile.renderMode !== "auto") return profile.renderMode;
  return ticket.direction === "rtl" || ticket.unsupportedCharacters > 0 ? "raster" : "text";
}
