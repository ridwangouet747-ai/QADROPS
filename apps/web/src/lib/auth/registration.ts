/**
 * Qui peut créer un compte par requête HTTP (inscription par e-mail ou par nom d'utilisateur, retour Google ou
 * Apple, invitation acceptée par un nouveau compte).
 *
 * **Mode code (2026-11-18)** : quand un code commercial est exigé (`accessCodeRequired()` de commercial/mode.ts,
 * c'est-à-dire le mode `manual_code` sur tout déploiement), c'est le code `QADR-` qui autorise l'inscription :
 * un laissez-passer valide dont le code est relu en base (ni utilisé, ni révoqué, ni expiré), ou une invitation par
 * e-mail en attente pour cette adresse. La règle ci-dessous n'est alors **pas** consultée : aucun nom ni aucune
 * adresse n'a besoin d'être ajouté à une variable Vercel, et rien n'est ouvert sans code.
 *
 * **Sans code exigé** (mode `geniuspay`, développement local, tests), la règle du 2026-11-13 s'applique :
 * - `QADR_REGISTRATION=open` : inscriptions ouvertes à tous (à poser seulement avec une offre commerciale).
 * - `QADR_REGISTRATION_ALLOWLIST=a@exemple.ci,b@exemple.ci` : seules ces adresses (casse ignorée).
 * - rien en production Vercel (`VERCEL_ENV=production`) : **aucune** inscription.
 * - rien ailleurs (développement, tests, Preview) : ouvertes, comme avant.
 *
 * Un refus prend la forme de l'échec d'inscription générique (`422 SIGN_UP_FAILED`) : la réponse ne dit pas
 * quelle barrière a joué. Les créations faites par le serveur (scripts, console, propriétaire de la plateforme
 * créé depuis `QADR_OWNER_USERNAME`) ne sont pas visées. Un code commercial n'accorde jamais le droit plateforme :
 * il ouvre un compte de commerçant, puis un commerce, rien d'autre.
 */
export type RegistrationPolicy = { mode: "open" } | { mode: "allowlist"; emails: ReadonlySet<string> };

export function registrationPolicy(source: Record<string, string | undefined> = process.env): RegistrationPolicy {
  if (source.QADR_REGISTRATION?.trim() === "open") return { mode: "open" };
  const emails = new Set((source.QADR_REGISTRATION_ALLOWLIST ?? "").split(",")
    .map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0));
  if (emails.size > 0) return { mode: "allowlist", emails };
  if (source.VERCEL_ENV === "production") return { mode: "allowlist", emails };
  return { mode: "open" };
}

export function registrationAllows(policy: RegistrationPolicy, email: unknown): boolean {
  if (policy.mode === "open") return true;
  return typeof email === "string" && policy.emails.has(email.trim().toLowerCase());
}

/**
 * Inscription sans e-mail (2026-11-17, docs/authentication.md § 12) : une entrée de la liste qui ne contient pas
 * « @ » désigne un nom d'utilisateur (casse ignorée). Une adresse e-mail de la liste n'ouvre jamais un nom
 * d'utilisateur, et inversement.
 */
export function registrationAllowsUsername(policy: RegistrationPolicy, username: unknown): boolean {
  if (policy.mode === "open") return true;
  if (typeof username !== "string") return false;
  const name = username.trim().toLowerCase();
  return name.length > 0 && !name.includes("@") && policy.emails.has(name);
}
