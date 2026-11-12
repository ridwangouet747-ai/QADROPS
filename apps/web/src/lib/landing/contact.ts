/*
 * Canal de contact de Qadr Agency pour l'offre Business de la page publique. Il vient de `QADR_CONTACT_URL` :
 * aucune adresse ni aucun numéro n'est écrit dans le code. Formes acceptées :
 *   mailto:adresse@domaine · tel:+2250700000000 · https://wa.me/2250700000000 · toute page en https://
 * Sans valeur valide, l'offre Business n'a pas de bouton ; en production elle n'est alors pas affichée du tout
 * (voir pricing-section.tsx) : la page ne propose jamais un contact qui n'existe pas.
 */
export type ContactChannel = { href: string; kind: "email" | "phone" | "whatsapp" | "web" };

export function readContactChannel(environment: Readonly<Record<string, string | undefined>> = process.env): ContactChannel | null {
  const value = environment.QADR_CONTACT_URL?.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^mailto:[^@\s?]+@[^@\s?]+\.[^@\s?]+$/i.test(value)) return { href: value, kind: "email" };
  if (/^tel:\+?[0-9]{8,15}$/.test(value)) return { href: value, kind: "phone" };
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "wa.me" || host === "api.whatsapp.com") return { href: url.toString(), kind: "whatsapp" };
  return { href: url.toString(), kind: "web" };
}
