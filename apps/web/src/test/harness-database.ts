/**
 * Remplaçant de `@/lib/db/client` pour les tests de routes HTTP (voir `http-harness.ts`).
 *
 * C'est le SEUL module remplacé : chaque test de route déclare
 * `vi.mock("@/lib/db/client", () => import("@/test/harness-database"))`. Better Auth, la résolution de
 * session, l'appartenance au commerce, les permissions et les services métier restent ceux de
 * l'application ; seule la connexion Neon est remplacée par une base PGlite en mémoire.
 */
const DATABASE_KEY = Symbol.for("qadr-ops.http-harness.database");
type HarnessGlobal = typeof globalThis & { [DATABASE_KEY]?: unknown };

export function installHarnessDatabase(database: unknown) {
  (globalThis as HarnessGlobal)[DATABASE_KEY] = database;
}

/** Même signature que l'original : l'URL est ignorée, aucune connexion réseau n'est ouverte. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getDatabase(_url?: string) {
  const database = (globalThis as HarnessGlobal)[DATABASE_KEY];
  if (!database) throw new Error("Harnais HTTP : base PGlite non installée (appelez startHttpHarness dans beforeAll).");
  return database;
}
