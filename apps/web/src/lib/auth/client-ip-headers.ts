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

/**
 * Adresse du visiteur lue sur les mêmes en-têtes de confiance que Better Auth (voir ci-dessus), pour
 * une limite de tentatives par adresse. Premier élément de `x-forwarded-for` (le client, ajouté par
 * l'hébergeur). Sans en-tête, toutes les requêtes partagent la clé « unknown » : plus strict, jamais plus
 * permissif.
 */
export function clientIpFrom(headers: Headers, names: string[] = clientIpHeaders()) {
  for (const name of names) {
    const value = headers.get(name)?.split(",")[0]?.trim();
    if (value) return value.slice(0, 64);
  }
  return "unknown";
}
