import { z, type ZodType } from "zod";
import { CommercialError } from "./commercial";

/**
 * Curseurs de pagination opaques (JSON en base64url). Ils ne portent que des clés de tri
 * (nom + identifiant, date + identifiant) : jamais d'identifiant de commerce, toujours pris dans la session.
 */
export function encodeCursor(value: Record<string, string>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(raw: string | null | undefined, schema: ZodType<T>): T | null {
  if (!raw) return null;
  try {
    if (raw.length > 512) throw new Error("too long");
    return schema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw new CommercialError("Le curseur de pagination est invalide. Rechargez la liste.", 400);
  }
}

export const productCursorSchema = z.object({ name: z.string().max(200), id: z.string().min(1).max(100) });
/** `at` est l'horodatage textuel de PostgreSQL (« 2026-10-30 21:47:00.123456+00 »), relu tel quel en SQL. */
export const movementCursorSchema = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/), id: z.string().min(1).max(100) });

/** Taille de page bornée : 1 à 100, 24 par défaut. */
export function pageLimit(raw: string | number | null | undefined, fallback = 24) {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : fallback;
}

/** Motif ILIKE littéral : % et _ saisis par le commerçant ne deviennent pas des jokers. */
export function likePattern(query: string) {
  return `%${query.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
