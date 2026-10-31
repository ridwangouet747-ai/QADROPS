/**
 * Destination après connexion : uniquement un chemin interne. Refuse les URL absolues, les chemins
 * « //domaine » et « /\domaine » que le navigateur interprète comme un autre site (redirection ouverte).
 */
export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Un caractère de contrôle (retour à la ligne, tabulation…) n'a rien à faire dans un chemin légitime.
  for (const char of value) if (char.charCodeAt(0) < 0x20) return null;
  return value;
}
