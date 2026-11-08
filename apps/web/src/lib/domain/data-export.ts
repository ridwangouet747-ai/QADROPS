import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditEvent, member, organization, user } from "../db/schema";
import { csvDocument } from "../exports/csv";
import { createZip } from "../exports/zip";
import { CommercialError, type CommercialDatabase } from "./commercial";

/*
 * Export complet des données d'un commerce (mission 13, docs/privacy/data-export.md) : droit à la
 * portabilité et sortie du service. Archive ZIP produite en mémoire, envoyée directement, jamais stockée.
 *
 * - Commerce : celui de la session ; chaque table est lue avec `business_id = <commerce>`, rien d'autre.
 * - Droit : propriétaire du commerce uniquement (responsable des données) ; trace `business.data_exported`.
 * - Contenu : toutes les tables qui portent `business_id`, sauf les tables techniques de `EXCLUDED_TABLES`.
 *   Une nouvelle table est donc exportée par défaut ; le test fige la liste pour imposer une relecture.
 * - Secrets jamais exportés : toute colonne dont le nom évoque un jeton, un secret, une empreinte, une clé
 *   ou une signature est retirée (`REDACTED_COLUMN`), et le manifeste liste ce qui a été retiré.
 * - Exactitude : le JSON de chaque ligne est écrit par PostgreSQL (montants `bigint` et quantités `numeric`
 *   restent exacts, jamais convertis en nombre flottant) ; le CSV passe par `csvDocument` (anti-formules).
 * - Borne : au plus `DATA_EXPORT_LIMITS.rowsPerTable` lignes par table ; au-delà, refus (422) plutôt
 *   qu'une archive incomplète présentée comme complète.
 */

export const DATA_EXPORT_LIMITS = { rowsPerTable: 100_000 } as const;

/** Tables techniques, sans valeur pour le commerçant ou propres à la plateforme. */
export const EXCLUDED_TABLES = new Set([
  "idempotency_record",          // réponses mises en cache pour rejouer une requête
  "notification_outbox",         // file d'envoi interne
  "payment_provider_event",      // journal technique des appels du prestataire de paiement
  "promotion_eligible_business", // ciblage commercial interne de Qadr Agency
  "notification",                // boîtes de réception personnelles des membres, éphémères
]);

/** Colonnes jamais exportées (jetons d'appairage, clés d'objets privés, empreintes, signatures…). */
export const REDACTED_COLUMN = /(token|secret|hash|password|signature|p256dh|(^|_)auth$|(^|_)key$|object_key|storage_key)/;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

type TableShape = { table: string; columns: string[]; redacted: string[] };

async function exportableTables(db: CommercialDatabase): Promise<TableShape[]> {
  const result = await db.execute(sql`select c.table_name as "table", c.column_name as "column"
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name in (
      select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id')
    order by c.table_name, c.ordinal_position`);
  const shapes = new Map<string, TableShape>();
  for (const row of (result as unknown as { rows: { table: string; column: string }[] }).rows) {
    if (EXCLUDED_TABLES.has(row.table)) continue;
    if (!IDENTIFIER.test(row.table) || !IDENTIFIER.test(row.column)) throw new Error("Nom de table ou de colonne inattendu.");
    const shape = shapes.get(row.table) ?? { table: row.table, columns: [], redacted: [] };
    (REDACTED_COLUMN.test(row.column) ? shape.redacted : shape.columns).push(row.column);
    shapes.set(row.table, shape);
  }
  return [...shapes.values()];
}

async function tableRows(db: CommercialDatabase, shape: TableShape, businessId: string, cap: number) {
  const name = sql.raw(`"${shape.table}"`);
  const cells = sql.raw(`array[${shape.columns.map((column) => `t."${column}"::text`).join(", ")}]::text[]`);
  const removed = sql.raw(`array[${shape.redacted.map((column) => `'${column}'`).join(", ")}]::text[]`);
  const result = await db.execute(sql`select (to_jsonb(t) - ${removed})::text as json, ${cells} as cells
    from ${name} t where t.business_id = ${businessId} order by 1 limit ${cap + 1}`);
  return (result as unknown as { rows: { json: string; cells: (string | null)[] }[] }).rows;
}

export async function buildBusinessDataArchive(db: CommercialDatabase, input: { businessId: string; actorUserId: string },
  now = new Date(), limits: { rowsPerTable: number } = DATA_EXPORT_LIMITS) {
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId))).limit(1);
  if (membership?.role !== "owner") throw new CommercialError("Seul le propriétaire du commerce peut exporter toutes ses données.", 403, "forbidden");

  const [business] = await db.select({ id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt })
    .from(organization).where(eq(organization.id, input.businessId)).limit(1);
  if (!business) throw new CommercialError("Commerce introuvable.", 404, "not_found");
  const members = await db.select({ userId: member.userId, name: user.name, email: user.email, role: member.role, joinedAt: member.createdAt })
    .from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, input.businessId)).orderBy(member.createdAt);

  const files: { name: string; content: string }[] = [];
  const tables: { table: string; rows: number; redactedColumns: string[] }[] = [];
  for (const shape of await exportableTables(db)) {
    const rows = await tableRows(db, shape, input.businessId, limits.rowsPerTable);
    if (rows.length > limits.rowsPerTable) {
      throw new CommercialError(`Export trop volumineux (table ${shape.table}) : contactez l’assistance pour un export accompagné.`, 422, "export_too_large");
    }
    files.push({ name: `json/${shape.table}.json`, content: `[\n${rows.map((row) => row.json).join(",\n")}\n]\n` });
    files.push({ name: `csv/${shape.table}.csv`, content: csvDocument([shape.columns, ...rows.map((row) => row.cells)]) });
    tables.push({ table: shape.table, rows: rows.length, redactedColumns: shape.redacted });
  }

  const manifest = {
    format: "qadr-ops-business-export", version: 1, generatedAt: now.toISOString(),
    business: { ...business, createdAt: business.createdAt.toISOString() },
    members: members.map((entry) => ({ ...entry, joinedAt: entry.joinedAt.toISOString() })),
    tables, excludedTables: [...EXCLUDED_TABLES].sort(),
    notes: [
      "Montants en francs CFA (XOF), entiers ; quantités en décimal exact (texte).",
      "Les colonnes listées dans redactedColumns (jetons, clés, empreintes) ne sont jamais exportées.",
      "Les fichiers déposés (imports, logos) ne sont pas inclus : seule leur description l'est (table stored_file).",
    ],
  };
  files.unshift({ name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` });

  // Trace en ajout seul : qui a exporté, quand, combien de lignes. Aucune donnée exportée dans la trace.
  await db.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "business.data_exported",
    entityType: "business", entityId: input.businessId, occurredAt: now,
    metadata: { tables: tables.length, rows: tables.reduce((sum, entry) => sum + entry.rows, 0) } });

  return { archive: createZip(files), fileName: `qadr-ops-donnees-${business.slug}-${now.toISOString().slice(0, 10)}.zip`, tables };
}
