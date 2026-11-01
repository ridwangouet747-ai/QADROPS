import type { Metadata } from "next";
import { cookies } from "next/headers";
import { localeCookie, resolveLocale, type Locale } from "./config";
import { createTranslator, type MessageKey } from "./translate";

export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(localeCookie)?.value);
}

/** Titre d'onglet traduit dans la langue de la session ; ces pages privées ne sont pas indexées. */
export async function localizedPageMetadata(titleKey: MessageKey): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t(titleKey), robots: { index: false } };
}
