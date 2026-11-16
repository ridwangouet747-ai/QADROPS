import type { Locale } from "@/lib/i18n/config";

/*
 * Captures de la section « Les vrais écrans » de la page publique (mission du 2026-11-16).
 *
 * Provenance : application réelle lancée en aperçu local (base PGlite en mémoire, jamais une base réelle), commerce
 * renommé « Boutique de test » par ses propres réglages, deux ventes de test enregistrées par l'API, bandeau d'aperçu
 * et invitation d'installation masqués. Une capture par langue (fr, en, ar), redimensionnée en deux largeurs (webp).
 * La section et chaque texte alternatif disent qu'il s'agit de données de test (landing-content.test.ts).
 *
 * Seules les images listées ici sont servies sous public/landing/apercu ; le test le vérifie dans les deux sens.
 * Pour refaire les captures : relancer l'aperçu, recapturer les huit écrans dans chaque langue, puis mettre à jour
 * les largeurs et hauteurs ci-dessous avec les dimensions réelles des fichiers.
 */

type ScreenSize = { widths: readonly [number, number]; height: number };

const desktop: ScreenSize = { widths: [720, 1440], height: 900 };
const screenSizes = {
  dashboard: desktop, pos: desktop, products: desktop, stock: desktop, customers: desktop, reports: desktop,
  mobile: { widths: [390, 780], height: 1688 },
  receipt: { widths: [300, 444], height: 576 },
} as const satisfies Record<string, ScreenSize>;

/* Le ticket arabe est plus haut (libellés sur deux lignes). */
const localeOverrides: Partial<Record<Locale, Partial<Record<InterfaceScreenKey, ScreenSize>>>> = {
  ar: { receipt: { widths: [300, 444], height: 612 } },
};

export type InterfaceScreenKey = keyof typeof screenSizes;
export const interfaceScreenKeys = Object.keys(screenSizes) as InterfaceScreenKey[];

const sizes: Record<InterfaceScreenKey, string> = {
  dashboard: "(min-width: 1024px) 800px, 100vw",
  pos: "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw",
  products: "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw",
  stock: "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw",
  customers: "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw",
  reports: "(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw",
  mobile: "272px",
  receipt: "256px",
};

const localesWithScreens: readonly Locale[] = ["fr", "en", "ar"];

function sizeOf(locale: Locale, key: InterfaceScreenKey): ScreenSize {
  return localeOverrides[locale]?.[key] ?? screenSizes[key];
}

const file = (locale: Locale, key: InterfaceScreenKey, width: number) => `${locale}/${key}-${width}.webp`;

/** Image d'un écran pour une langue : source, jeu de largeurs et dimensions intrinsèques (réserve la place, CLS nul). */
export function interfaceScreen(locale: Locale, key: InterfaceScreenKey) {
  const { widths, height } = sizeOf(locale, key);
  const url = (width: number) => `/landing/apercu/${file(locale, key, width)}`;
  return {
    src: url(widths[1]),
    srcSet: widths.map((width) => `${url(width)} ${width}w`).join(", "),
    sizes: sizes[key],
    width: widths[1],
    height,
  };
}

/** Chemins (relatifs à public/landing/apercu) de toutes les images servies. */
export function interfaceScreenFiles(): string[] {
  return localesWithScreens.flatMap((locale) => interfaceScreenKeys.flatMap((key) => sizeOf(locale, key).widths.map((width) => file(locale, key, width))));
}
