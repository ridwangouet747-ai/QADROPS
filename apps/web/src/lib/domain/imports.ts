import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { hasBusinessPermission } from "@/lib/auth/permissions";
import { auditEvent, importBatch, importRow, member, product, productAlias, productCategory, productVariant, storedFile } from "@/lib/db/schema";
import { DOWNLOAD_URL_TTL_SECONDS, getFileStorage } from "@/lib/storage/config";
import type { StoredFileType } from "@/lib/storage/file-type";
import type { FileStorage } from "@/lib/storage/types";
import {
  duplicateRows, evaluateRow, widerRows, IMPORT_FIELDS, inferMapping, normalizeText, prepareCatalog, rowStatus,
  type Candidate, type CatalogEntry, type ColumnMapping, type ImportField, type PreparedCatalog, type RowDecision, type RowDecisionState,
  type RowEdits, type RowIssue, type RowStatus, type RowValues,
} from "@/lib/imports/adapt";
import { detectDocumentKind, getDocumentTextExtractor } from "@/lib/imports/document-text";
import { IMPORT_LIMITS, readSpreadsheet, SpreadsheetError, type Cell } from "@/lib/imports/spreadsheet";
import { CommercialError, insertProduct, type CommercialDatabase } from "./commercial";
import { abidjanToday, assertReferenceDate, writeStockOpening } from "./opening";
import { assertBusinessOperational, idempotencyKeySchema, runIdempotent, type CommercialTransaction } from "./operation-guard";
import { confirmStoredFile, deleteStoredFileNow, openStoredFile, scheduleStoredFileDeletion, uploadBusinessFile } from "./stored-files";

/*
 * Qadr Capture (mission 11, phase 3) : import d'un catalogue depuis un CSV ou un classeur XLSX.
 * Le fichier est lu une fois ; chaque ligne garde ses cellules d'origine (provenance) jusqu'à
 * l'application ou l'abandon. Rien n'est écrit dans le catalogue avant la confirmation explicite du commerçant,
 * et l'application passe par les mêmes règles que la saisie manuelle (insertProduct, writeStockOpening).
 * Mission 12 (lot L2) : quand le stockage privé est configuré, le fichier d'origine y est conservé
 * (`import_batch.source_file_id`) ; sinon il ne l'est pas, et l'écran le dit.
 */

type Context = { businessId: string; actorUserId: string };
/** `storage` absent : stockage de l'application (`getFileStorage()`) ; `null` : aucun stockage. */
type StorageOption = { storage?: FileStorage | null };
const storageOf = (options: StorageOption) => ("storage" in options ? options.storage ?? null : getFileStorage());
type Reader = CommercialDatabase | CommercialTransaction;

/** Au plus 200 lignes par transaction : c'est aussi la limite d'un stock d'ouverture. */
const APPLY_CHUNK = 200;
const OPEN_IMPORTS_LIMIT = 20;

async function requirePermission(db: Reader, context: Context, ...needs: [Parameters<typeof hasBusinessPermission>[1], string][]) {
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, context.businessId), eq(member.userId, context.actorUserId))).limit(1);
  if (!membership || needs.some(([resource, action]) => !hasBusinessPermission(membership.role, resource, action))) {
    throw new CommercialError("Vous n’avez pas l’autorisation d’effectuer cette opération.", 403);
  }
}

type StoredRow = {
  id: string; rowNumber: number; cells: Cell[]; edits: RowEdits; values: RowValues; issues: RowIssue[]; candidates: Candidate[];
  decision: RowDecision | null; decisionSource: "auto" | "user" | null; matchVariantId: string | null; status: RowStatus;
};

const rowColumns = {
  id: importRow.id, rowNumber: importRow.rowNumber, cells: importRow.cells, edits: importRow.edits, values: importRow.values, issues: importRow.issues,
  candidates: importRow.candidates, decision: importRow.decision, decisionSource: importRow.decisionSource, matchVariantId: importRow.matchVariantId, status: importRow.status,
};

const asStored = (row: Record<keyof typeof rowColumns, unknown>) => row as unknown as StoredRow;

/** Catalogue du seul commerce concerné (produits actifs + alias confirmés), pour le rapprochement. */
async function loadCatalog(db: Reader, businessId: string): Promise<PreparedCatalog> {
  const [variants, aliases] = await Promise.all([
    db.select({ variantId: productVariant.id, name: product.name, sku: productVariant.sku }).from(productVariant)
      .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
      .where(and(eq(productVariant.businessId, businessId), isNull(productVariant.archivedAt), isNull(product.archivedAt))),
    db.select({ variantId: productAlias.variantId, alias: productAlias.alias }).from(productAlias).where(eq(productAlias.businessId, businessId)),
  ]);
  const entries: CatalogEntry[] = variants.map((variant) => ({ ...variant, aliases: aliases.filter((alias) => alias.variantId === variant.variantId).map((alias) => alias.alias) }));
  return prepareCatalog(entries);
}

/** Variantes qui ont déjà du stock ou un historique : un stock de départ n'y est plus possible (règle de opening.ts). */
async function variantsWithStock(db: Reader, businessId: string, variantIds: string[]) {
  if (!variantIds.length) return new Set<string>();
  const rows = await db.select({ id: productVariant.id }).from(productVariant).where(and(eq(productVariant.businessId, businessId), inArray(productVariant.id, variantIds), sql`(
    ${productVariant.onHand} <> 0
    or exists (select 1 from stock_movement m where m.business_id = ${productVariant.businessId} and m.variant_id = ${productVariant.id})
    or exists (select 1 from stock_opening_line l where l.business_id = ${productVariant.businessId} and l.variant_id = ${productVariant.id}))`));
  return new Set(rows.map((row) => row.id));
}

const HEADER_STATE: RowDecisionState = { decision: "skip", decisionSource: "auto", matchVariantId: null };

/** Évalue une ligne : la ligne de titres est ignorée d'office, les autres passent par Adapt. */
function evaluate(row: { rowNumber: number; cells: Cell[]; edits: RowEdits }, headerRowNumber: number | null, mapping: ColumnMapping[], catalog: PreparedCatalog, current: RowDecisionState | null) {
  if (row.rowNumber === headerRowNumber) {
    return { values: { name: "", salePriceXof: null, costXof: null, quantity: null, unit: null, sku: null, category: null }, issues: [] as RowIssue[], candidates: [] as Candidate[], ...HEADER_STATE };
  }
  // Une ancienne ligne de titres redevient une ligne normale si le commerçant change la ligne de titres.
  const kept = current?.decisionSource === "auto" && current.decision === "skip" ? null : current;
  return evaluateRow(row.cells, mapping, row.edits, catalog, kept);
}

/** Doublons, lignes trop larges et avertissement « stock existant » sur le lot entier, puis statut final de chaque ligne. */
function finalize<T extends Omit<StoredRow, "id" | "status">>(rows: T[], withStock: Set<string>, headerRowNumber: number | null) {
  const duplicates = duplicateRows(rows);
  const wider = widerRows(rows, headerRowNumber);
  return rows.map((row) => {
    const issues: RowIssue[] = row.issues.filter((issue) => issue !== "duplicate_in_file" && issue !== "stock_existing" && issue !== "extra_cells");
    if (duplicates.has(row.rowNumber)) issues.push("duplicate_in_file");
    // Une décision du commerçant ou une correction de la ligne vaut vérification.
    if (wider.has(row.rowNumber) && row.decisionSource !== "user" && Object.keys(row.edits).length === 0) issues.push("extra_cells");
    if (row.decision === "match" && row.matchVariantId && row.values.quantity && withStock.has(row.matchVariantId)) issues.push("stock_existing");
    return { ...row, issues, status: rowStatus(issues, row.decision) };
  });
}

function spreadsheetFailure(error: unknown): never {
  if (error instanceof SpreadsheetError) throw new CommercialError(error.message, error.code === "too_large" ? 413 : 400, `import_${error.code}`);
  throw error;
}

const safeFileName = (value: string) => value.replace(/^.*[\\/]/, "").replace(/\p{Cc}/gu, "").trim().slice(0, 200) || "fichier";

/* ------------------------------------------------------------------ Création */

/**
 * Conserve l'original s'il y a un stockage. Un refus (type, taille) ou une panne du stockage n'empêche pas
 * l'import : l'original n'est alors simplement pas conservé (le fichier a déjà été lu et validé).
 */
async function keepOriginal(db: CommercialDatabase, storage: FileStorage | null, input: Context & { fileName: string; bytes: Buffer }) {
  if (!storage) return null;
  try {
    const result = await uploadBusinessFile(db, storage, { ...input, purpose: "import_source", displayName: input.fileName });
    return result.fileId;
  } catch (error) {
    if (error instanceof CommercialError && (error.code === "file_type_refused" || error.code === "file_too_large")) {
      console.warn(JSON.stringify({ event: "import.original_not_kept", code: error.code }));
      return null;
    }
    throw error;
  }
}

export async function createCatalogImport(db: CommercialDatabase, input: Context & { fileName: string; bytes: Buffer }, options: StorageOption = {}) {
  await requirePermission(db, input, ["product", "create"]);
  if (input.bytes.byteLength > IMPORT_LIMITS.fileBytes) spreadsheetFailure(new SpreadsheetError("too_large", "Le fichier dépasse 2 Mo."));
  const fileSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const findSameFile = async () => (await db.select({ id: importBatch.id }).from(importBatch).where(and(eq(importBatch.businessId, input.businessId),
    eq(importBatch.kind, "catalog"), eq(importBatch.fileSha256, fileSha256), ne(importBatch.status, "discarded"))).limit(1))[0];
  // Le même fichier envoyé deux fois rouvre l'import existant : aucune ligne n'est lue ni créée une seconde fois.
  const same = await findSameFile();
  if (same) return { id: same.id, existing: true };

  if (detectDocumentKind(input.bytes) && !getDocumentTextExtractor().enabled) {
    throw new CommercialError("Les PDF et les photos ne sont pas encore lus. Envoyez un fichier CSV ou Excel (.xlsx).", 400, "import_document_reader_disabled");
  }
  const sheet = await readSpreadsheet(input.bytes).catch(spreadsheetFailure);
  const { headerIndex, mapping } = inferMapping(sheet.rows, sheet.columnCount);
  const headerRowNumber = headerIndex === null ? null : sheet.rows[headerIndex]!.number;
  const dataRows = sheet.rows.filter((row) => row.number !== headerRowNumber);
  if (!dataRows.length) spreadsheetFailure(new SpreadsheetError("empty", "Le fichier ne contient aucune ligne de données."));
  if (dataRows.length > IMPORT_LIMITS.rows) spreadsheetFailure(new SpreadsheetError("too_many_rows", `Le fichier dépasse ${IMPORT_LIMITS.rows} lignes.`));

  const catalog = await loadCatalog(db, input.businessId);
  const evaluated = sheet.rows.map((row) => ({ rowNumber: row.number, cells: row.cells, edits: {} as RowEdits, ...evaluate({ rowNumber: row.number, cells: row.cells, edits: {} }, headerRowNumber, mapping, catalog, null) }));
  const withStock = await variantsWithStock(db, input.businessId, evaluated.flatMap((row) => (row.matchVariantId ? [row.matchVariantId] : [])));
  const rows = finalize(evaluated, withStock, headerRowNumber);
  const id = randomUUID();
  // Dépôt de l'original AVANT la transaction (appel réseau) ; il n'est confirmé (`stored`) que si l'import est créé.
  const uploadedFileId = await keepOriginal(db, storageOf(options), input);
  let originalStored = false;
  try {
    await db.transaction(async (tx) => {
      await assertBusinessOperational(tx, input.businessId);
      const [open] = await tx.select({ count: sql<string>`count(*)::text` }).from(importBatch).where(and(eq(importBatch.businessId, input.businessId), eq(importBatch.status, "review")));
      if (Number(open?.count ?? 0) >= OPEN_IMPORTS_LIMIT) throw new CommercialError(`Terminez ou abandonnez un des ${OPEN_IMPORTS_LIMIT} imports en cours avant d’en commencer un autre.`, 409, "import_too_many_open");
      originalStored = uploadedFileId !== null && await confirmStoredFile(tx, input.businessId, uploadedFileId);
      await tx.insert(importBatch).values({ id, businessId: input.businessId, kind: "catalog", fileName: safeFileName(input.fileName), fileType: sheet.fileType, fileSha256,
        fileSize: input.bytes.byteLength, sheetName: sheet.sheetName, headerRowNumber, columnCount: sheet.columnCount, rowCount: dataRows.length,
        mapping, createdByUserId: input.actorUserId, sourceFileId: originalStored ? uploadedFileId : null });
      for (let start = 0; start < rows.length; start += APPLY_CHUNK) {
        await tx.insert(importRow).values(rows.slice(start, start + APPLY_CHUNK).map((row) => ({ id: randomUUID(), businessId: input.businessId, batchId: id,
          rowNumber: row.rowNumber, cells: row.cells, edits: row.edits, values: row.values, issues: row.issues, candidates: row.candidates,
          decision: row.decision, decisionSource: row.decisionSource, matchVariantId: row.matchVariantId, status: row.status })));
      }
      await tx.insert(auditEvent).values({ id: randomUUID(), businessId: input.businessId, actorUserId: input.actorUserId, eventType: "import.created",
        entityType: "import_batch", entityId: id, metadata: { kind: "catalog", fileType: sheet.fileType, rowCount: dataRows.length, originalStored } });
    });
  } catch (error) {
    // Deux envois simultanés du même fichier : l'index unique en garde un seul. L'original déposé pour
    // l'import perdant reste `pending` et sera supprimé comme orphelin.
    const concurrent = await findSameFile();
    if (concurrent) return { id: concurrent.id, existing: true, originalStored: false };
    throw error;
  }
  return { id, existing: false, originalStored };
}

/* ------------------------------------------------------------------ Lecture */

function countByStatus(rows: { status: string }[]) {
  const counts: Record<RowStatus, number> = { ready: 0, needs_review: 0, invalid: 0, skipped: 0, applied: 0 };
  for (const row of rows) counts[row.status as RowStatus] += 1;
  return counts;
}

export async function listImportBatches(db: CommercialDatabase, context: Context) {
  await requirePermission(db, context, ["product", "create"]);
  const batches = await db.select({ id: importBatch.id, fileName: importBatch.fileName, fileType: importBatch.fileType, status: importBatch.status,
    rowCount: importBatch.rowCount, createdAt: importBatch.createdAt, appliedAt: importBatch.appliedAt,
    pending: sql<string>`(select count(*) from import_row r where r.business_id = ${importBatch.businessId} and r.batch_id = ${importBatch.id} and r.status in ('needs_review','invalid'))::text` })
    .from(importBatch).where(eq(importBatch.businessId, context.businessId)).orderBy(desc(importBatch.createdAt)).limit(20);
  return { batches: batches.map((batch) => ({ ...batch, pending: Number(batch.pending), createdAt: batch.createdAt.toISOString(), appliedAt: batch.appliedAt?.toISOString() ?? null })) };
}

export async function getImportBatch(db: CommercialDatabase, context: Context, batchId: string) {
  await requirePermission(db, context, ["product", "create"]);
  const [batch] = await db.select().from(importBatch).where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batchId))).limit(1);
  if (!batch) throw new CommercialError("Import introuvable.", 404);
  const rows = (await db.select({ ...rowColumns, appliedVariantId: importRow.appliedVariantId, stockNote: importRow.stockNote }).from(importRow)
    .where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batchId))).orderBy(asc(importRow.rowNumber)))
    .map((row) => ({ ...asStored(row), appliedVariantId: row.appliedVariantId, stockNote: row.stockNote }));
  // Nom du produit choisi à la main (il peut ne pas figurer parmi les candidats proposés).
  const chosen = [...new Set(rows.flatMap((row) => [row.matchVariantId, row.appliedVariantId]).filter((value): value is string => Boolean(value)))];
  const names = chosen.length ? await db.select({ id: productVariant.id, name: product.name }).from(productVariant)
    .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
    .where(and(eq(productVariant.businessId, context.businessId), inArray(productVariant.id, chosen))) : [];
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  const header = batch.headerRowNumber === null ? null : rows.find((row) => row.rowNumber === batch.headerRowNumber)?.cells ?? null;
  const [source] = batch.sourceFileId ? await db.select({ status: storedFile.status, retentionUntil: storedFile.retentionUntil }).from(storedFile)
    .where(and(eq(storedFile.businessId, context.businessId), eq(storedFile.id, batch.sourceFileId))).limit(1) : [];
  // Fichier d'origine : `stored` (téléchargeable jusqu'à l'échéance), `deleted` (supprimé ou échu) ou `none` (jamais conservé).
  const originalAvailable = source?.status === "stored" && source.retentionUntil > new Date();
  const original = { status: !source ? "none" as const : originalAvailable ? "stored" as const : "deleted" as const,
    retentionUntil: originalAvailable ? source!.retentionUntil.toISOString() : null };
  return {
    batch: { id: batch.id, fileName: batch.fileName, fileType: batch.fileType, status: batch.status, sheetName: batch.sheetName, headerRowNumber: batch.headerRowNumber,
      columnCount: batch.columnCount, rowCount: batch.rowCount, mapping: batch.mapping as ColumnMapping[], mappingConfirmed: batch.mappingConfirmedAt !== null,
      createdAt: batch.createdAt.toISOString(), appliedAt: batch.appliedAt?.toISOString() ?? null, summary: batch.summary, header, original },
    counts: countByStatus(rows.filter((row) => row.rowNumber !== batch.headerRowNumber)),
    rows: rows.filter((row) => row.rowNumber !== batch.headerRowNumber).map((row) => ({ ...row,
      matchName: row.matchVariantId ? nameOf.get(row.matchVariantId) ?? null : null, appliedName: row.appliedVariantId ? nameOf.get(row.appliedVariantId) ?? null : null })),
  };
}

/* ------------------------------------------------------------------ Revue */

async function lockReviewBatch(tx: CommercialTransaction, context: Context, batchId: string) {
  const [batch] = await tx.select().from(importBatch).where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batchId))).for("update").limit(1);
  if (!batch) throw new CommercialError("Import introuvable.", 404);
  if (batch.status !== "review") throw new CommercialError("Cet import est terminé : il ne peut plus être modifié.", 409, "import_closed");
  return batch;
}

async function saveRows(tx: CommercialTransaction, businessId: string, before: StoredRow[], after: (Omit<StoredRow, "id"> & { id: string })[]) {
  const previous = new Map(before.map((row) => [row.id, row]));
  for (const row of after) {
    const old = previous.get(row.id);
    const changed = !old || JSON.stringify([old.edits, old.values, old.issues, old.candidates, old.decision, old.decisionSource, old.matchVariantId, old.status])
      !== JSON.stringify([row.edits, row.values, row.issues, row.candidates, row.decision, row.decisionSource, row.matchVariantId, row.status]);
    if (!changed) continue;
    await tx.update(importRow).set({ edits: row.edits, values: row.values, issues: row.issues, candidates: row.candidates, decision: row.decision,
      decisionSource: row.decisionSource, matchVariantId: row.matchVariantId, status: row.status })
      .where(and(eq(importRow.businessId, businessId), eq(importRow.id, row.id)));
  }
}

const mappingInput = z.object({
  batchId: z.string().min(1).max(100), headerRowNumber: z.number().int().positive().nullable(),
  mapping: z.array(z.object({ column: z.number().int().min(0).max(IMPORT_LIMITS.columns - 1), field: z.enum(IMPORT_FIELDS).nullable() })).max(IMPORT_LIMITS.columns),
});

/** Le commerçant confirme (ou corrige) la colonne de chaque information ; toutes les lignes sont réévaluées. */
export async function updateImportMapping(db: CommercialDatabase, context: Context, raw: unknown) {
  const input = mappingInput.parse(raw);
  await requirePermission(db, context, ["product", "create"]);
  const fields = input.mapping.flatMap((entry) => (entry.field ? [entry.field] : []));
  if (new Set(fields).size !== fields.length) throw new CommercialError("Une information ne peut venir que d’une seule colonne.", 400, "import_mapping_duplicate");
  if (!fields.includes("name")) throw new CommercialError("Indiquez la colonne qui contient le nom des articles.", 400, "import_mapping_name");
  const catalog = await loadCatalog(db, context.businessId);
  return db.transaction(async (tx) => {
    await assertBusinessOperational(tx, context.businessId);
    const batch = await lockReviewBatch(tx, context, input.batchId);
    if (input.mapping.some((entry) => entry.column >= batch.columnCount)) throw new CommercialError("Colonne inconnue dans ce fichier.", 400);
    const before = (await tx.select(rowColumns).from(importRow).where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batch.id))).orderBy(asc(importRow.rowNumber))).map(asStored);
    if (before.some((row) => row.status === "applied")) throw new CommercialError("Une partie de cet import est déjà appliquée : les colonnes ne peuvent plus changer.", 409, "import_partially_applied");
    if (input.headerRowNumber !== null && !before.slice(0, 5).some((row) => row.rowNumber === input.headerRowNumber)) {
      throw new CommercialError("La ligne de titres doit être l’une des cinq premières lignes.", 400);
    }
    const inferred = batch.mapping as ColumnMapping[];
    const mapping: ColumnMapping[] = Array.from({ length: batch.columnCount }, (_, column) => {
      const field = input.mapping.find((entry) => entry.column === column)?.field ?? null;
      const previous = inferred.find((entry) => entry.column === column);
      return { column, header: previous?.header ?? "", field, confidence: previous?.field === field ? previous.confidence : null };
    });
    const evaluated = before.map((row) => ({ ...row, ...evaluate(row, input.headerRowNumber, mapping, catalog, row) }));
    const withStock = await variantsWithStock(tx, context.businessId, evaluated.flatMap((row) => (row.matchVariantId ? [row.matchVariantId] : [])));
    const after = finalize(evaluated, withStock, input.headerRowNumber);
    await saveRows(tx, context.businessId, before, after);
    const dataRows = after.filter((row) => row.rowNumber !== input.headerRowNumber).length;
    await tx.update(importBatch).set({ mapping, headerRowNumber: input.headerRowNumber, rowCount: dataRows, mappingConfirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batch.id)));
    return { counts: countByStatus(after.filter((row) => row.rowNumber !== input.headerRowNumber)) };
  });
}

const editValue = z.string().max(IMPORT_LIMITS.cellChars).nullable();
const rowInput = z.object({
  batchId: z.string().min(1).max(100), rowId: z.string().min(1).max(100),
  edits: z.object(Object.fromEntries(IMPORT_FIELDS.map((field) => [field, editValue.optional()])) as Record<ImportField, z.ZodOptional<typeof editValue>>).strict().optional(),
  decision: z.enum(["create", "match", "skip", "auto"]).optional(), matchVariantId: z.string().min(1).max(100).optional(),
});

/** Correction d'une ligne et/ou décision du commerçant. Les doublons du lot sont recalculés. */
export async function updateImportRow(db: CommercialDatabase, context: Context, raw: unknown) {
  const input = rowInput.parse(raw);
  if ((input.decision === "match") !== (input.matchVariantId !== undefined)) throw new CommercialError("Choisissez le produit existant à rattacher.", 400, "import_match_variant");
  await requirePermission(db, context, ["product", "create"]);
  const catalog = await loadCatalog(db, context.businessId);
  return db.transaction(async (tx) => {
    await assertBusinessOperational(tx, context.businessId);
    const batch = await lockReviewBatch(tx, context, input.batchId);
    const before = (await tx.select(rowColumns).from(importRow).where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batch.id))).orderBy(asc(importRow.rowNumber))).map(asStored);
    const target = before.find((row) => row.id === input.rowId);
    if (!target || target.rowNumber === batch.headerRowNumber) throw new CommercialError("Ligne introuvable dans cet import.", 404);
    if (target.status === "applied") throw new CommercialError("Cette ligne est déjà appliquée.", 409, "import_row_applied");
    if (input.matchVariantId) {
      const [variant] = await tx.select({ id: productVariant.id }).from(productVariant)
        .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
        .where(and(eq(productVariant.businessId, context.businessId), eq(productVariant.id, input.matchVariantId), isNull(productVariant.archivedAt), isNull(product.archivedAt))).limit(1);
      if (!variant) throw new CommercialError("Produit introuvable dans ce commerce.", 404);
    }
    const edits: RowEdits = { ...target.edits };
    for (const [field, value] of Object.entries(input.edits ?? {}) as [ImportField, string | null | undefined][]) {
      if (value === undefined) continue;
      if (value === null) delete edits[field]; else edits[field] = value.trim();
    }
    const current: RowDecisionState | null = input.decision === undefined ? target
      : input.decision === "auto" ? null
        : { decision: input.decision, decisionSource: "user", matchVariantId: input.decision === "match" ? input.matchVariantId! : null };
    const updated = { ...target, edits, ...evaluate({ ...target, edits }, batch.headerRowNumber, batch.mapping as ColumnMapping[], catalog, current) };
    const rows = before.map((row) => (row.id === target.id ? updated : row));
    const withStock = await variantsWithStock(tx, context.businessId, rows.flatMap((row) => (row.matchVariantId ? [row.matchVariantId] : [])));
    const after = finalize(rows, withStock, batch.headerRowNumber);
    await saveRows(tx, context.businessId, before, after);
    await tx.update(importBatch).set({ updatedAt: new Date() }).where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batch.id)));
    return { row: after.find((row) => row.id === target.id)!, counts: countByStatus(after.filter((row) => row.rowNumber !== batch.headerRowNumber)) };
  });
}

/* ------------------------------------------------------------------ Application */

const applyInput = z.object({ batchId: z.string().min(1).max(100), idempotencyKey: idempotencyKeySchema.max(100), referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

type ApplyResult = { created: number; matched: number; stockLines: number; stockIgnored: number };

async function applyChunk(tx: CommercialTransaction, context: Context, batchId: string, rowIds: string[], referenceDate: string): Promise<ApplyResult> {
  const batch = await lockReviewBatch(tx, context, batchId);
  const rows = (await tx.select(rowColumns).from(importRow).where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batch.id), inArray(importRow.id, rowIds)))
    .orderBy(asc(importRow.rowNumber)).for("update")).map(asStored).filter((row) => row.status === "ready");
  const result: ApplyResult = { created: 0, matched: 0, stockLines: 0, stockIgnored: 0 };
  const categories = new Map<string, string | null>();
  const outcome = new Map<string, { variantId: string; stock: boolean }>();
  const fail = (row: StoredRow, message: string, status = 409, code?: string): never => { throw new CommercialError(`Ligne ${row.rowNumber} : ${message}`, status, code); };

  for (const row of rows) {
    if (row.decision === "create") {
      if (row.values.sku) {
        const [taken] = await tx.select({ id: productVariant.id }).from(productVariant).where(and(eq(productVariant.businessId, context.businessId), eq(productVariant.sku, row.values.sku))).limit(1);
        if (taken) fail(row, "cette référence existe déjà dans le catalogue. Rattachez la ligne au produit existant ou changez la référence.", 409, "import_sku_taken");
      }
      let categoryId: string | null = null;
      if (row.values.category) {
        const key = row.values.category.toLocaleLowerCase("fr");
        if (!categories.has(key)) {
          const [found] = await tx.select({ id: productCategory.id, archivedAt: productCategory.archivedAt }).from(productCategory)
            .where(and(eq(productCategory.businessId, context.businessId), sql`lower(${productCategory.name}) = lower(${row.values.category})`)).limit(1);
          if (found) categories.set(key, found.archivedAt ? null : found.id);
          else {
            const id = randomUUID();
            await tx.insert(productCategory).values({ id, businessId: context.businessId, name: row.values.category });
            categories.set(key, id);
          }
        }
        // Une catégorie archivée n'est pas réactivée en silence : le produit est créé sans catégorie.
        categoryId = categories.get(key) ?? null;
      }
      const created = await insertProduct(tx, { ...context, name: row.values.name, categoryId, description: null, baseUnit: row.values.unit ?? "piece",
        variantLabel: "Standard", salePriceXof: row.values.salePriceXof!, sku: row.values.sku }, undefined, { source: "import", batchId: batch.id });
      outcome.set(row.id, { variantId: created.variantId, stock: Boolean(row.values.quantity) });
      result.created += 1;
    } else if (row.decision === "match" && row.matchVariantId) {
      const [variant] = await tx.select({ id: productVariant.id, name: product.name }).from(productVariant)
        .innerJoin(product, and(eq(product.businessId, productVariant.businessId), eq(product.id, productVariant.productId)))
        .where(and(eq(productVariant.businessId, context.businessId), eq(productVariant.id, row.matchVariantId), isNull(productVariant.archivedAt), isNull(product.archivedAt))).limit(1);
      if (!variant) fail(row, "le produit rattaché n’existe plus dans ce commerce.", 404);
      // Le mot du commerçant devient un alias de ce produit, pour ce commerce seulement. Le produit lui-même n'est pas modifié.
      const normalized = normalizeText(row.values.name).slice(0, 160);
      if (normalized && normalized !== normalizeText(variant!.name)) {
        await tx.insert(productAlias).values({ id: randomUUID(), businessId: context.businessId, variantId: variant!.id, alias: row.values.name.slice(0, 160),
          normalized, createdByUserId: context.actorUserId }).onConflictDoNothing();
      }
      outcome.set(row.id, { variantId: variant!.id, stock: Boolean(row.values.quantity) });
      result.matched += 1;
    }
  }

  const stockRows = rows.filter((row) => outcome.get(row.id)?.stock);
  const withStock = await variantsWithStock(tx, context.businessId, stockRows.map((row) => outcome.get(row.id)!.variantId));
  const lines = stockRows.filter((row) => !withStock.has(outcome.get(row.id)!.variantId))
    .map((row) => ({ variantId: outcome.get(row.id)!.variantId, quantity: row.values.quantity!, ...(row.values.costXof ? { unitCostXof: row.values.costXof } : {}) }));
  const openingId = lines.length ? randomUUID() : null;
  if (openingId) await writeStockOpening(tx, { ...context, referenceDate, note: `Import de catalogue (${batch.fileName})`.slice(0, 500), lines }, openingId);
  result.stockLines = lines.length;
  result.stockIgnored = stockRows.length - lines.length;

  const now = new Date();
  for (const row of rows) {
    const done = outcome.get(row.id);
    if (!done) continue;
    const stockNote = !done.stock ? null : withStock.has(done.variantId) ? "existing_stock" : "applied";
    await tx.update(importRow).set({ status: "applied", appliedAt: now, appliedVariantId: done.variantId, stockOpeningId: stockNote === "applied" ? openingId : null, stockNote })
      .where(and(eq(importRow.businessId, context.businessId), eq(importRow.id, row.id)));
  }
  await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "import.rows_applied",
    entityType: "import_batch", entityId: batch.id, metadata: { ...result } });
  return result;
}

/**
 * Applique un import relu : chaque paquet de 200 lignes est une opération idempotente (`import.apply`), et une ligne
 * déjà appliquée ne l'est jamais deux fois (verrou + statut), même avec une autre clé.
 */
export async function applyImportBatch(db: CommercialDatabase, context: Context, raw: unknown, now = new Date()) {
  const input = applyInput.parse(raw);
  await requirePermission(db, context, ["product", "create"]);
  const [batch] = await db.select().from(importBatch).where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, input.batchId))).limit(1);
  if (!batch) throw new CommercialError("Import introuvable.", 404);
  if (batch.status === "applied") return { status: "applied", summary: batch.summary };
  if (batch.status !== "review") throw new CommercialError("Cet import a été abandonné.", 409, "import_closed");
  if (!batch.mappingConfirmedAt) throw new CommercialError("Confirmez d’abord les colonnes du fichier.", 409, "import_mapping_unconfirmed");
  const rows = (await db.select(rowColumns).from(importRow).where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batch.id))).orderBy(asc(importRow.rowNumber))).map(asStored)
    .filter((row) => row.rowNumber !== batch.headerRowNumber);
  if (rows.some((row) => row.status === "needs_review" || row.status === "invalid")) {
    throw new CommercialError("Des lignes demandent encore une réponse : corrigez-les ou ignorez-les avant d’importer.", 409, "import_rows_pending");
  }
  const pending = rows.filter((row) => row.status === "ready");
  if (pending.some((row) => row.values.quantity)) await requirePermission(db, context, ["inventory", "adjust"]);
  if (pending.some((row) => row.decision === "match")) await requirePermission(db, context, ["product", "update"]);
  const referenceDate = input.referenceDate ?? abidjanToday(now);
  assertReferenceDate(referenceDate, now);

  // Découpage stable (lignes prêtes ou déjà appliquées, par numéro) : rejouer la même clé retombe sur les mêmes paquets.
  const ordered = rows.filter((row) => row.status === "ready" || row.status === "applied");
  for (let index = 0; index * APPLY_CHUNK < ordered.length; index += 1) {
    const chunk = ordered.slice(index * APPLY_CHUNK, (index + 1) * APPLY_CHUNK);
    if (chunk.every((row) => row.status === "applied")) continue;
    const rowIds = chunk.map((row) => row.id);
    await runIdempotent(db, { ...context, idempotencyKey: `${input.idempotencyKey}:${index}`, operation: "import.apply", request: { batchId: batch.id, rowIds, referenceDate } },
      (tx) => applyChunk(tx, context, batch.id, rowIds, referenceDate));
  }

  return db.transaction(async (tx) => {
    await assertBusinessOperational(tx, context.businessId);
    const locked = await lockReviewBatch(tx, context, batch.id).catch(async (error) => {
      const [current] = await tx.select({ status: importBatch.status }).from(importBatch).where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batch.id))).limit(1);
      if (current?.status === "applied") return null;
      throw error;
    });
    if (!locked) return { status: "applied", summary: (await tx.select({ summary: importBatch.summary }).from(importBatch).where(eq(importBatch.id, batch.id)).limit(1))[0]?.summary ?? null };
    const final = await tx.select({ status: importRow.status, decision: importRow.decision, stockNote: importRow.stockNote, rowNumber: importRow.rowNumber }).from(importRow)
      .where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batch.id)));
    const data = final.filter((row) => row.rowNumber !== locked.headerRowNumber);
    if (data.some((row) => row.status !== "applied" && row.status !== "skipped")) return { status: "review", summary: null };
    const summary = {
      created: data.filter((row) => row.status === "applied" && row.decision === "create").length,
      matched: data.filter((row) => row.status === "applied" && row.decision === "match").length,
      skipped: data.filter((row) => row.status === "skipped").length,
      stockLines: data.filter((row) => row.stockNote === "applied").length,
      stockIgnored: data.filter((row) => row.stockNote === "existing_stock").length,
    };
    await tx.update(importBatch).set({ status: "applied", appliedAt: new Date(), summary, updatedAt: new Date() })
      .where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batch.id)));
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "import.applied",
      entityType: "import_batch", entityId: batch.id, metadata: summary });
    return { status: "applied", summary };
  });
}

/**
 * Abandon : les cellules des lignes non appliquées sont effacées ; ce qui a déjà été appliqué reste tracé.
 * Le fichier d'origine conservé est supprimé aussitôt (au mieux), sinon au prochain passage planifié.
 */
export async function discardImportBatch(db: CommercialDatabase, context: Context, batchId: string, options: StorageOption = {}) {
  await requirePermission(db, context, ["product", "create"]);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await assertBusinessOperational(tx, context.businessId);
    const batch = await lockReviewBatch(tx, context, batchId);
    await tx.update(importRow).set({ cells: [], edits: {}, values: {}, candidates: [] })
      .where(and(eq(importRow.businessId, context.businessId), eq(importRow.batchId, batch.id), ne(importRow.status, "applied")));
    await tx.update(importBatch).set({ status: "discarded", updatedAt: now }).where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batch.id)));
    if (batch.sourceFileId) await scheduleStoredFileDeletion(tx, context.businessId, batch.sourceFileId, now);
    await tx.insert(auditEvent).values({ id: randomUUID(), businessId: context.businessId, actorUserId: context.actorUserId, eventType: "import.discarded",
      entityType: "import_batch", entityId: batch.id, metadata: {} });
    return { status: "discarded" as const, sourceFileId: batch.sourceFileId };
  });
  if (result.sourceFileId) await deleteStoredFileNow(db, storageOf(options), context.businessId, result.sourceFileId, "import_discarded", now);
  return { status: result.status };
}

/* ------------------------------------------------------------------ Fichier d'origine */

/**
 * Téléchargement du fichier d'origine d'un import. Même permission que la lecture de l'import ; le fichier
 * est cherché par l'import, dans le seul commerce de la session. Un import d'un autre commerce, un import sans
 * original, un original supprimé ou échu répondent tous la même chose : « Fichier introuvable » (404).
 * R2 : URL signée de quelques minutes. Stockage mémoire (tests, aperçu) : contenu servi par la route.
 */
export async function getImportOriginal(db: CommercialDatabase, context: Context, batchId: string, options: StorageOption & { now?: Date } = {}) {
  await requirePermission(db, context, ["product", "create"]);
  const now = options.now ?? new Date();
  const [file] = await db.select({ id: storedFile.id, objectKey: storedFile.objectKey, fileType: storedFile.fileType, sha256: storedFile.sha256,
    displayName: storedFile.displayName, sizeBytes: storedFile.sizeBytes }).from(importBatch)
    .innerJoin(storedFile, and(eq(storedFile.businessId, importBatch.businessId), eq(storedFile.id, importBatch.sourceFileId)))
    .where(and(eq(importBatch.businessId, context.businessId), eq(importBatch.id, batchId), eq(storedFile.status, "stored"), sql`${storedFile.retentionUntil} > ${now.toISOString()}::timestamptz`))
    .limit(1);
  if (!file) throw new CommercialError("Fichier introuvable.", 404);
  const storage = storageOf(options);
  if (!storage) throw new CommercialError("Le stockage des fichiers n’est pas disponible : le fichier d’origine ne peut pas être lu pour le moment.", 503, "storage_unavailable");
  const opened = await openStoredFile(storage, { ...file, fileType: file.fileType as StoredFileType }, DOWNLOAD_URL_TTL_SECONDS);
  if (!opened) throw new CommercialError("Fichier introuvable.", 404);
  return opened;
}
