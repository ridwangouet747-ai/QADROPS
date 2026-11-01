/**
 * En-tête qui porte l'adresse IP du visiteur, pour la limitation de débit de Better Auth.
 * Sur Cloudflare Workers, `x-forwarded-for` (défaut de Better Auth) est absent : sans réglage, tous les
 * visiteurs partageraient un seul compteur et quelques échecs bloqueraient tout le monde. Cloudflare
 * remplit et écrase lui-même `cf-connecting-ip`, qu'un client ne peut donc pas falsifier.
 * Ailleurs, cet en-tête serait falsifiable : on garde `x-forwarded-for`, renseigné par l'hébergeur.
 * La détection repose sur `navigator.userAgent`, fixé par le runtime Workers et non par la requête.
 */
export function clientIpHeaders(userAgent: string | undefined = globalThis.navigator?.userAgent) {
  return userAgent === "Cloudflare-Workers" ? ["cf-connecting-ip"] : ["x-forwarded-for"];
}
