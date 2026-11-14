import { z } from "zod";
import { LOGO_MAX_CHARS } from "@/lib/business-logo-limits";

/**
 * Logo du commerce : petite image (≤ 256 px, réduite dans le navigateur) en data URL, enregistrée dans
 * `organization.logo`. Pas de stockage objet : aucune dépendance à R2, rien à purger, rendu identique sur
 * l'en-tête, le choix du commerce et les reçus. Le type annoncé doit correspondre aux premiers octets.
 */
export const logoSchema = z.string().max(LOGO_MAX_CHARS)
  .refine((value) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) && logoBytesMatch(value), "Logo invalide");

/** Le type annoncé du logo doit correspondre à ses premiers octets (pas seulement à l'extension). */
export function logoBytesMatch(dataUrl: string) {
  const [, kind = "", payload = ""] = /^data:image\/(png|jpeg|webp);base64,(.*)$/.exec(dataUrl) ?? [];
  const bytes = Buffer.from(payload.slice(0, 24), "base64");
  if (kind === "png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (kind === "webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
