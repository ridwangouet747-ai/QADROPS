import { MICROS } from "./quantity";

export type StockStatus = "ok" | "low" | "out";
export type MovementDirection = "in" | "out";

/** Lit une quantité décimale signée (« -2.500000 ») en micro-unités, ou null si illisible. */
export function signedMicros(value: string | null | undefined): bigint | null {
  const match = /^(-)?(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec((value ?? "").trim());
  if (!match) return null;
  const micros = BigInt(match[2]!) * MICROS + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -micros : micros;
}

/**
 * Statut d'un article : rupture si le stock est nul ou négatif, faible s'il atteint le seuil
 * d'alerte (un seuil à zéro désactive l'alerte), sinon en stock. Même règle que le tableau de bord.
 */
export function stockStatus(onHand: string, threshold: string | null | undefined): StockStatus {
  const quantity = signedMicros(onHand) ?? 0n;
  if (quantity <= 0n) return "out";
  const limit = signedMicros(threshold) ?? 0n;
  return limit > 0n && quantity <= limit ? "low" : "ok";
}

export function movementDirection(delta: string): MovementDirection {
  return (signedMicros(delta) ?? 0n) < 0n ? "out" : "in";
}

/** Arrondit un montant décimal en chaîne (coût moyen) au franc CFA le plus proche, sans flottant. */
export function roundXof(value: string | null | undefined): string | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec((value ?? "").trim());
  if (!match) return null;
  let whole = BigInt(match[2]!);
  if ((match[3] ?? "0")[0]! >= "5") whole += 1n;
  return `${match[1] && whole > 0n ? "-" : ""}${whole}`;
}
