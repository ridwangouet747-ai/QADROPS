/**
 * Reconnaît une violation d'unicité PostgreSQL (SQLSTATE 23505) sur une contrainte donnée, y compris quand
 * l'erreur du pilote est enveloppée (`cause`). Sert aux courses « vérification puis insertion » : deux requêtes
 * simultanées lisent toutes deux « libre », l'index unique en refuse une, et la route doit répondre 409, jamais 500.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "23505") return String(candidate.constraint ?? candidate.message ?? "").includes(constraint);
    current = candidate.cause;
  }
  return false;
}
