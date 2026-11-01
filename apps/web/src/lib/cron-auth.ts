import { timingSafeEqual } from "node:crypto";

/**
 * Jeton `Authorization: Bearer …` des tâches planifiées, comparé en temps constant à chacun des secrets
 * configurés. Un secret absent ou de moins de 32 caractères n'autorise jamais rien.
 */
export function isCronAuthorized(authorization: string | null, secrets: Array<string | undefined>) {
  const given = Buffer.from((authorization ?? "").replace(/^Bearer\s+/i, ""));
  return secrets.some((value) => {
    const secret = value?.trim();
    if (!secret || secret.length < 32) return false;
    const expected = Buffer.from(secret);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
