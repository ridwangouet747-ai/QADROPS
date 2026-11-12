import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditEvent, member, organization, user } from "../db/schema";
import { csvCell } from "../exports/csv";
import { createZip } from "../exports/zip";
import { enterTenantScope } from "@/lib/db/tenant-scope";
import { CommercialError, type CommercialDatabase } from "./commercial";

/*
 * Export complet des données d'un commerce (missions 13 et 14, docs/privacy/data-export.md) : droit à la
 * portabilité et sortie du service. Archive ZIP produite en mémoire, envoyée directement, jamais stockée.
 *
 * - Commerce : celui de la session ; chaque table est lue avec `business_id = <commerce>`, rien d'autre.
 * - Droit : propriétaire du commerce uniquement (responsable des données) ; trace `business.data_exported`.
 * - Contenu : toutes les tables qui portent `business_id`, sauf les tables techniques de `EXCLUDED_TABLES`.
 *   Une nouvelle table est donc exportée par défaut ; le test fige la liste pour imposer une relecture.
 * - Secrets jamais exportés : toute colonne dont le nom évoque un jeton, un secret, une empreinte, une clé
 *   ou une signature est retirée (`REDACTED_COLUMN`), et le manifeste liste ce qui a été retiré.
 * - Exactitude : le JSON de chaque ligne est écrit par PostgreSQL (montants `bigint` et quantités `numeric`
 *   restent exacts, jamais convertis en nombre flottant) ; le CSV passe par `csvCell` (anti-formules), en
 *   UTF-8 avec BOM (accents et arabe lisibles dans Excel).
 *
 * Mission 14, exhaustivité :
 * - Cohérence : toutes les tables sont lues dans UNE transaction `repeatable read` en lecture seule, donc sur
 *   un même instantané : une vente enregistrée pendant l'export n'apparaît pas à moitié (lignes sans vente).
 * - Lecture paginée (`pageSize` lignes) dans l'ordre de la clé primaire (ordre total) ; le nombre de lignes
 *   lues est comparé au `count(*)` du même instantané, sinon refus.
 * - Bornes explicites (`DATA_EXPORT_LIMITS`) : lignes par table, octets bruts (mémoire du serveur) et taille de
 *   l'archive (une fonction Vercel ne renvoie pas plus de 4,5 Mo). Au-delà : refus 422 `export_too_large` avec
 *   la raison, trace `business.data_export_refused`, et JAMAIS une archive tronquée présentée comme complète.
 */

export type DataExportLimits = { rowsPerTable: number; pageSize: number; rawBytes: number; archiveBytes: number };
export const DATA_EXPORT_LIMITS: DataExportLimits = {
  rowsPerTable: 100_000,
  pageSize: 5_000,
  rawBytes: 96 * 1024 * 1024,
  archiveBytes: 4 * 1024 * 1024,
};

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

type TableShape = { table: string; columns: string[]; redacted: string[]; orderBy: string[] };
type RefusalReason = "rows_per_table" | "raw_bytes" | "archive_bytes" | "count_mismatch";

class ExportRefused extends Error {
  constructor(readonly reason: RefusalReason, readonly detail: { table?: string; rows?: number; bytes?: number }) { super(reason); }
}

const refusalMessages: Record<RefusalReason, string> = {
  rows_per_table: "Export trop volumineux : une table dépasse {limit} lignes. Contactez l’assistance pour un export accompagné ; aucune archive partielle n’est produite.",
  raw_bytes: "Export trop volumineux pour être préparé en une fois. Contactez l’assistance pour un export accompagné ; aucune archive partielle n’est produite.",
  archive_bytes: "Archive trop volumineuse pour être téléchargée directement. Contactez l’assistance pour un export accompagné ; aucune archive partielle n’est produite.",
  count_mismatch: "Les données ont changé pendant l’export. Réessayez ; aucune archive partielle n’est produite.",
};

type Executor = Pick<CommercialDatabase, "execute">;
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;

async function exportableTables(db: Executor): Promise<TableShape[]> {
  const columns = rowsOf<{ table: string; column: string }>(await db.execute(sql`select c.table_name as "table", c.column_name as "column"
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name in (
      select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id')
    order by c.table_name, c.ordinal_position`));
  const keys = rowsOf<{ table: string; column: string }>(await db.execute(sql`select tc.table_name as "table", kcu.column_name as "column"
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name and kcu.table_name = tc.table_name
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
    order by tc.table_name, kcu.ordinal_position`));
  const shapes = new Map<string, TableShape>();
  for (const row of columns) {
    if (EXCLUDED_TABLES.has(row.table)) continue;
    if (!IDENTIFIER.test(row.table) || !IDENTIFIER.test(row.column)) throw new Error("Nom de table ou de colonne inattendu.");
    const shape = shapes.get(row.table) ?? { table: row.table, columns: [], redacted: [], orderBy: [] };
    (REDACTED_COLUMN.test(row.column) ? shape.redacted : shape.columns).push(row.column);
    shapes.set(row.table, shape);
  }
  for (const key of keys) {
    const shape = shapes.get(key.table);
    if (shape && IDENTIFIER.test(key.column)) shape.orderBy.push(key.column);
  }
  return [...shapes.values()];
}

/** Une page de lignes, dans un ordre total (clé primaire ; à défaut, le contenu complet de la ligne). */
async function tablePage(db: Executor, shape: TableShape, businessId: string, offset: number, size: number) {
  const name = sql.raw(`"${shape.table}"`);
  const cells = sql.raw(`array[${shape.columns.map((column) => `t."${column}"::text`).join(", ")}]::text[]`);
  const removed = sql.raw(`array[${shape.redacted.map((column) => `'${column}'`).join(", ")}]::text[]`);
  const order = sql.raw(shape.orderBy.length ? shape.orderBy.map((column) => `t."${column}"`).join(", ") : "to_jsonb(t)::text");
  return rowsOf<{ json: string; cells: (string | null)[] }>(await db.execute(sql`select (to_jsonb(t) - ${removed})::text as json, ${cells} as cells
    from ${name} t where t.business_id = ${businessId} order by ${order} limit ${size} offset ${offset}`));
}

async function tableCount(db: Executor, table: string, businessId: string) {
  const [row] = rowsOf<{ n: string }>(await db.execute(sql`select count(*)::text as n from ${sql.raw(`"${table}"`)} t where t.business_id = ${businessId}`));
  return Number(row?.n ?? 0);
}

const sha256 = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

export async function buildBusinessDataArchive(db: CommercialDatabase, input: { businessId: string; actorUserId: string },
  now = new Date(), overrides: Partial<DataExportLimits> = {}) {
  const limits = { ...DATA_EXPORT_LIMITS, ...overrides };
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, input.businessId), eq(member.userId, input.actorUserId))).limit(1);
  if (membership?.role !== "owner") throw new CommercialError("Seul le propriétaire du commerce peut exporter toutes ses données.", 403, "forbidden");

  const audit = (eventType: string, metadata: Record<string, unknown>) => db.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId,
    actorUserId: input.actorUserId, eventType, entityType: "business", entityId: input.businessId, occurredAt: now, metadata });

  let snapshot: Awaited<ReturnType<typeof readSnapshot>>;
  try {
    snapshot = await db.transaction((tx) => readSnapshot(tx as unknown as CommercialDatabase, input.businessId, limits),
      { isolationLevel: "repeatable read", accessMode: "read only" });
  } catch (error) {
    if (!(error instanceof ExportRefused)) throw error;
    // Trace du refus, sans contenu : raison, table et volume seulement.
    await audit("business.data_export_refused", { reason: error.reason, ...error.detail });
    throw new CommercialError(refusalMessages[error.reason].replace("{limit}", limits.rowsPerTable.toLocaleString("fr-FR")), 422, "export_too_large");
  }
  const { business, members, files, tables } = snapshot;

  const manifest = {
    format: "qadr-ops-business-export", version: 2, generatedAt: now.toISOString(),
    complete: true,
    consistency: "Instantané unique (transaction repeatable read) ; chaque table relue page par page puis comparée à son nombre de lignes.",
    business: { ...business, createdAt: business.createdAt.toISOString() },
    members: members.map((entry) => ({ ...entry, joinedAt: entry.joinedAt.toISOString() })),
    tables, excludedTables: [...EXCLUDED_TABLES].sort(),
    limits: { rowsPerTable: limits.rowsPerTable },
    notes: [
      "Montants en francs CFA (XOF), entiers ; quantités en décimal exact (texte).",
      "Les colonnes listées dans redactedColumns (jetons, clés, empreintes) ne sont jamais exportées.",
      "Les fichiers déposés (imports, logos) ne sont pas inclus : seule leur description l'est (table stored_file).",
      "sha256 : empreinte de chaque fichier json/ et csv/ de cette archive, pour vérifier qu'il est intact.",
    ],
  };
  files.unshift({ name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` });
  const archive = createZip(files);
  if (archive.length > limits.archiveBytes) {
    await audit("business.data_export_refused", { reason: "archive_bytes", bytes: archive.length });
    throw new CommercialError(refusalMessages.archive_bytes, 422, "export_too_large");
  }

  // Trace en ajout seul : qui a exporté, quand, combien de lignes. Aucune donnée exportée dans la trace.
  await audit("business.data_exported", { tables: tables.length, rows: tables.reduce((sum, entry) => sum + entry.rows, 0), bytes: archive.length });

  return { archive, fileName: `qadr-ops-donnees-${business.slug}-${now.toISOString().slice(0, 10)}.zip`, tables };
}

async function readSnapshot(db: CommercialDatabase, businessId: string, limits: DataExportLimits) {
  const [business] = await db.select({ id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt })
    .from(organization).where(eq(organization.id, businessId)).limit(1);
  if (!business) throw new CommercialError("Commerce introuvable.", 404, "not_found");
  const members = await db.select({ userId: member.userId, name: user.name, email: user.email, role: member.role, joinedAt: member.createdAt })
    .from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, businessId)).orderBy(member.createdAt);

  const files: { name: string; content: string }[] = [];
  const tables: { table: string; rows: number; redactedColumns: string[]; sha256: { json: string; csv: string } }[] = [];
  let rawBytes = 0;
  // Liste des tables lue avec le rôle de l'application, PUIS lecture des lignes sous le rôle qadr_tenant (RLS,
  // migration 0025) : PostgreSQL lui-même ne rend que les lignes de ce commerce, même si une requête de cette
  // boucle perdait son filtre business_id. Une table à business_id sans droit pour qadr_tenant fait échouer
  // l'export (permission refusée) au lieu d'être lue sans protection.
  const shapes = await exportableTables(db);
  await enterTenantScope(db, businessId);
  for (const shape of shapes) {
    const expected = await tableCount(db, shape.table, businessId);
    if (expected > limits.rowsPerTable) throw new ExportRefused("rows_per_table", { table: shape.table, rows: expected });
    const json: string[] = [];
    const csv: string[] = [shape.columns.map(csvCell).join(",")];
    for (let offset = 0; offset < expected; offset += limits.pageSize) {
      const page = await tablePage(db, shape, businessId, offset, limits.pageSize);
      for (const row of page) {
        const line = row.cells.map(csvCell).join(",");
        json.push(row.json); csv.push(line);
        rawBytes += row.json.length + line.length;
      }
      if (rawBytes > limits.rawBytes) throw new ExportRefused("raw_bytes", { table: shape.table, bytes: rawBytes });
      if (page.length < limits.pageSize) break;
    }
    if (json.length !== expected) throw new ExportRefused("count_mismatch", { table: shape.table, rows: json.length });
    const jsonContent = `[\n${json.join(",\n")}\n]\n`;
    const csvContent = `\uFEFF${csv.join("\r\n")}`;
    files.push({ name: `json/${shape.table}.json`, content: jsonContent });
    files.push({ name: `csv/${shape.table}.csv`, content: csvContent });
    tables.push({ table: shape.table, rows: expected, redactedColumns: shape.redacted, sha256: { json: sha256(jsonContent), csv: sha256(csvContent) } });
  }
  return { business, members, files, tables };
}
