/**
 * Ouverture des inscriptions (2026-11-13).
 *
 * Tant que l'équipe Vercel est en offre Hobby (usage personnel ou non commercial seulement), la production ne
 * doit pas accueillir de commerçants tiers. Cette règle le rend technique : en production Vercel, seuls les
 * comptes dont l'adresse figure dans `QADR_REGISTRATION_ALLOWLIST` peuvent être créés par une requête HTTP
 * (inscription par e-mail, retour Google ou Apple, invitation acceptée par un nouveau compte).
 *
 * - `QADR_REGISTRATION=open` : inscriptions ouvertes à tous (à poser seulement avec une offre commerciale).
 * - `QADR_REGISTRATION_ALLOWLIST=a@exemple.ci,b@exemple.ci` : seules ces adresses (casse ignorée).
 * - rien en production Vercel (`VERCEL_ENV=production`) : **aucune** inscription.
 * - rien ailleurs (développement, tests, Preview) : ouvertes, comme avant.
 *
 * Un refus prend la forme de l'échec d'inscription générique (`422 SIGN_UP_FAILED`) : la réponse ne dit pas
 * si l'adresse figure sur la liste. Les créations faites par le serveur (scripts, console) ne sont pas visées.
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
