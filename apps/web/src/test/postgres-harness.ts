import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { databaseSchema } from "@/lib/db/schema";

/**
 * Mission 14 : exécuter les tests de routes (`http-harness.ts`) sur un vrai PostgreSQL Neon plutôt que
 * sur PGlite, pour prouver la compatibilité réelle (types renvoyés, transactions, verrous, contraintes).
 *
 * Activation volontaire et bornée :
 * - `QADR_TEST_POSTGRES_URL` : connexion directe (sans `-pooler`) à une base de STAGING ;
 * - `QADR_TEST_POSTGRES_TARGET=staging` : déclaration explicite de la cible.
 * La base `neondb` (base par défaut des branches Neon, donc de la branche principale) est refusée.
 *
 * Chaque harnais crée sa propre base jetable `qadr_t_<aléa>`, y applique toutes les migrations, puis la
 * supprime à la fermeture : aucune donnée existante n'est lue ni modifiée.
 */
export type HarnessClient = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

export function postgresHarnessTarget(env: Record<string, string | undefined> = process.env) {
  const url = env.QADR_TEST_POSTGRES_URL?.trim();
  if (!url) return null;
  if (env.QADR_TEST_POSTGRES_TARGET !== "staging") {
    throw new Error("Harnais PostgreSQL : définissez QADR_TEST_POSTGRES_TARGET=staging après avoir vérifié la cible.");
  }
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  if (!database || database === "neondb" || database === "postgres") {
    throw new Error("Harnais PostgreSQL : base refusée (utilisez une base de staging dédiée, jamais neondb).");
  }
  if (parsed.hostname.includes("-pooler")) {
    throw new Error("Harnais PostgreSQL : utilisez la connexion directe (sans -pooler) pour créer les bases jetables.");
  }
  return parsed;
}

function pool(url: URL | string) {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  return new Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 20_000 });
}

export async function openPostgresHarness(target: URL) {
  const name = `qadr_t_${randomBytes(6).toString("hex")}`;
  const admin = pool(target);
  await admin.query(`create database ${name}`);
  const url = new URL(target.toString());
  url.pathname = `/${name}`;
  const connection = pool(url);
  const db = drizzle({ client: connection, schema: databaseSchema });
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  const client: HarnessClient = {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await connection.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async close() {
      await connection.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
  return { client, db };
}
