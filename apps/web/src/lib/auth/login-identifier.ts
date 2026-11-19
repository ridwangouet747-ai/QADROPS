/**
 * Page /login : un seul champ « E-mail ou nom d'utilisateur » (2026-11-19).
 *
 * Un nom d'utilisateur ne contient jamais « @ » (`usernameSchema` : lettres, chiffres, point, tiret bas) : tout
 * identifiant qui en porte un part vers la connexion par e-mail de Better Auth, tout autre vers
 * `/api/account/sign-in/username` (employés invités par code, comptes sans e-mail).
 */
export type LoginMode = "email" | "username";

export function loginMode(identifier: string): LoginMode {
  return identifier.includes("@") ? "email" : "username";
}
