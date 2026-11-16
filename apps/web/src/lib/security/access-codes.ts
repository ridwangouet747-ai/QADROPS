import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Codes secrets remis à une personne (2026-11-16) : deux familles strictement séparées.
 *
 * - `commercial` : code d'accès commercial remis par Qadr Agency après un paiement vérifié à la main
 *   (`QADR-XXXX-XXXX-XXXX-XXXX`, 16 symboles, environ 79 bits) ;
 * - `invite` : code d'invitation d'un employé, créé par un commerce (`EQP-XXXX-XXXX-XXXX`, 12 symboles,
 *   environ 59 bits, expirant, limité en tentatives).
 *
 * Aucun code n'est stocké en clair : la base ne garde que HMAC-SHA256(clé, code normalisé). La clé est dérivée
 * (HKDF) de `QADR_CODE_SECRET`, ou à défaut de `BETTER_AUTH_SECRET`, avec une étiquette propre à chaque famille :
 * une empreinte de code commercial ne peut jamais correspondre à un code d'invitation, même identique.
 * Changer ce secret rend inutilisables les codes non encore utilisés (docs/commercial-access-codes.md).
 */

export type AccessCodeFamily = "commercial" | "invite";

/** Sans 0/O, 1/I/L : lisible au téléphone et à l'écrit. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const formats: Record<AccessCodeFamily, { prefix: string; groups: number }> = {
  commercial: { prefix: "QADR", groups: 4 },
  invite: { prefix: "EQP", groups: 3 },
};

const PREVIEW_SECRET = "qadr-preview-only-secret-never-in-production-000";

function rootSecret(source: Record<string, string | undefined> = process.env) {
  const secret = source.QADR_CODE_SECRET?.trim() || source.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (source.NODE_ENV === "production" || source.VERCEL_ENV === "production" || source.VERCEL_ENV === "preview") {
    throw new Error("QADR_CODE_SECRET ou BETTER_AUTH_SECRET (32 caractères au moins) est requis pour les codes d'accès.");
  }
  return PREVIEW_SECRET;
}

const keyCache = new Map<string, Buffer>();
function familyKey(family: AccessCodeFamily, source?: Record<string, string | undefined>) {
  const secret = rootSecret(source);
  const cacheKey = `${family}:${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "qadr-ops-access-codes", `qadr-${family}-code-v1`, 32));
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** Génère un code aléatoire (CSPRNG) au format de sa famille. Le code brut n'est montré qu'une fois. */
export function generateAccessCode(family: AccessCodeFamily) {
  const { prefix, groups } = formats[family];
  const parts = Array.from({ length: groups }, () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(""));
  return `${prefix}-${parts.join("-")}`;
}

/**
 * Forme canonique d'un code saisi : majuscules, sans espaces ni tirets. Rend `null` si le texte ne peut pas
 * être un code de la famille (préfixe, longueur ou symbole hors alphabet) : aucune requête en base dans ce cas.
 */
export function normalizeAccessCode(family: AccessCodeFamily, raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { prefix, groups } = formats[family];
  if (!compact.startsWith(prefix)) return null;
  const body = compact.slice(prefix.length);
  if (body.length !== groups * 4) return null;
  for (const char of body) if (!CODE_ALPHABET.includes(char)) return null;
  return `${prefix}${body}`;
}

/** Famille annoncée par le préfixe : permet un message utile (« ce code sert à rejoindre une équipe »). */
export function accessCodeFamilyOf(raw: unknown): AccessCodeFamily | null {
  if (typeof raw !== "string") return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("QADR")) return "commercial";
  if (compact.startsWith("EQP")) return "invite";
  return null;
}

/** Empreinte stockée en base (hex). `normalized` doit venir de `normalizeAccessCode`. */
export function hashAccessCode(family: AccessCodeFamily, normalized: string, source?: Record<string, string | undefined>) {
  return createHmac("sha256", familyKey(family, source)).update(normalized).digest("hex");
}

/** Quatre derniers symboles, pour reconnaître un code dans une liste sans jamais l'afficher en entier. */
export function accessCodeHint(normalized: string) {
  return normalized.slice(-4);
}

export function sameDigest(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Jeton signé court (laissez-passer) : `base64url(json).hmac`. Sert à porter, dans un cookie HttpOnly, l'identifiant
 * d'un code commercial vérifié entre la page de saisie, l'inscription et la création du commerce. Il ne contient
 * jamais le code ; le code est relu et revérifié en base à chaque étape.
 */
export function signPass(payload: Record<string, unknown>, source?: Record<string, string | undefined>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", familyKey("commercial", source)).update(`pass.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPass<T extends Record<string, unknown>>(token: unknown, source?: Record<string, string | undefined>): T | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", familyKey("commercial", source)).update(`pass.${body}`).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
}
