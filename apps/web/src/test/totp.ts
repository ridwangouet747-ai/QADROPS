import { createHmac } from "node:crypto";

/**
 * Code TOTP (RFC 6238, HMAC-SHA1, 6 chiffres, 30 s) calculé indépendamment de Better Auth, à partir de
 * l'adresse `otpauth://` remise à l'activation : les tests vérifient ainsi le format standard que lira
 * l'application d'authentification du propriétaire.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string) {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0; let value = 0; const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Secret base32 invalide.");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpSecretFromUri(uri: string) {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:" || url.host !== "totp") throw new Error("Adresse otpauth://totp attendue.");
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("Secret absent de l'adresse.");
  return secret;
}

export function totpCode(base32Secret: string, at = Date.now(), period = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / period)));
  const digest = createHmac("sha1", base32Decode(base32Secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}
