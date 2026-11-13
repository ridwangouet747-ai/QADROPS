/*
 * Migration de la base de PRODUCTION (branche Neon `main`), 2026-11-13.
 *
 * Pourquoi un script distinct de `migrate.ts` : celui-ci utilise le migrateur `neon-http`, qui exécute chaque
 * instruction hors transaction ; un échec au milieu laisserait un schéma partiel sans journal
 * (`docs/engineering/neon-production-plan.md` § 3). Ici, le migrateur `neon-serverless` (Pool WebSocket, le
 * même que le harnais de test) applique toutes les migrations en attente ET leurs lignes de journal dans UNE
 * transaction : tout ou rien.
 *
 * Garde-fous, tous obligatoires :
 * - `QADR_DB_TARGET=production` ;
 * - connexion directe (`DATABASE_URL_UNPOOLED`, repli `DATABASE_URL`), jamais `-pooler` ;
 * - `QADR_MIGRATION_CONFIRM` = `MIGRER LA PRODUCTION <hôte>/<base>` : la phrase nomme la cible exacte ;
 * - refus si `public` contient des tables sans journal Drizzle (état inconnu) ;
 * - seules l'adresse de l'hôte, la base et des comptes sont affichés, jamais la chaîne de connexion.
 *
 * Avant : sauvegarde `pg_dump` restaurée avec succès (`docs/engineering/backup-restore.md`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { requireMigrationDatabaseUrl } from "../src/lib/env";

export type ProductionMigrationTarget = { url: URL; label: string };

export function productionMigrationTarget(source: Record<string, string | undefined>): ProductionMigrationTarget {
  if (source.QADR_DB_TARGET !== "production") {
    throw new Error("Refus : définissez QADR_DB_TARGET=production après avoir vérifié la cible et sa sauvegarde.");
  }
  const url = new URL(requireMigrationDatabaseUrl(source as NodeJS.ProcessEnv));
  if (url.hostname.includes("-pooler")) {
    throw new Error("Refus : utilisez la connexion directe (sans -pooler) pour migrer.");
  }
  const database = url.pathname.replace(/^\//, "");
  if (!database) throw new Error("Refus : la chaîne de connexion ne nomme aucune base.");
  const label = `${url.hostname}/${database}`;
  if (source.QADR_MIGRATION_CONFIRM !== `MIGRER LA PRODUCTION ${label}`) {
    throw new Error(`Refus : QADR_MIGRATION_CONFIRM doit valoir exactement « MIGRER LA PRODUCTION ${label} ».`);
  }
  return { url, label };
}

type JournalEntry = { tag: string; when: number };

export function pendingMigrations(journal: JournalEntry[], lastAppliedAt: number | null): JournalEntry[] {
  return journal.filter((entry) => lastAppliedAt === null || entry.when > lastAppliedAt);
}

async function main() {
  const { url, label } = productionMigrationTarget(process.env);
  const journal = (JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  }).entries;
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 20_000 });
  try {
    const state = await pool.query<{ public_tables: string; journal_exists: boolean }>(
      `select (select count(*) from pg_tables where schemaname = 'public')::text as public_tables,
              to_regclass('drizzle.__drizzle_migrations') is not null as journal_exists`,
    );
    const { public_tables: publicTables, journal_exists: journalExists } = state.rows[0];
    let lastAppliedAt: number | null = null;
    let applied = 0;
    if (journalExists) {
      const rows = await pool.query<{ applied: string; last: string | null }>(
        `select count(*)::text as applied, max(created_at)::text as last from drizzle.__drizzle_migrations`,
      );
      applied = Number(rows.rows[0].applied);
      lastAppliedAt = rows.rows[0].last === null ? null : Number(rows.rows[0].last);
    }
    if (applied === 0 && Number(publicTables) > 0) {
      throw new Error(`Refus : ${publicTables} table(s) dans public sans journal Drizzle ; état inconnu, rien n'est fait.`);
    }
    const pending = pendingMigrations(journal, lastAppliedAt);
    console.log(`Cible : ${label} | migrations du dépôt : ${journal.length} | appliquées : ${applied} | en attente : ${pending.length}`);
    if (pending.length === 0) {
      console.log("Rien à appliquer.");
      return;
    }
    console.log(`En attente : ${pending[0].tag} … ${pending[pending.length - 1].tag}`);
    await migrate(drizzle({ client: pool }), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    const after = await pool.query<{ applied: string }>(`select count(*)::text as applied from drizzle.__drizzle_migrations`);
    console.log(`Terminé en une transaction : ${after.rows[0].applied} migration(s) au journal.`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/migrate-production.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Erreur inconnue");
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof Error) console.error(`Cause : ${cause.message}`);
    process.exitCode = 1;
  });
}
