"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, FormDialog, SearchField, Segmented } from "@/components/ui/controls";
import { Alert, Badge, EmptyState, Skeleton, type Tone } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { errorMessageFor } from "@/lib/client/errors";
import { formatDateTime, formatQuantity, formatXof } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translate";
import { useDebounced } from "./use-paged-list";

/* Qadr Capture (mission 11, phase 3) : envoi d'un fichier, revue ligne par ligne, puis import confirmé. */

const FIELDS = ["name", "salePrice", "cost", "quantity", "unit", "sku", "category"] as const;
type ImportField = (typeof FIELDS)[number];
type Cell = string | { n: string };
type RowStatus = "ready" | "needs_review" | "invalid" | "skipped" | "applied";
type Decision = "create" | "match" | "skip";
type Mapping = { column: number; header: string; field: ImportField | null; confidence: "certain" | "probable" | "ambiguous" | null };
type Candidate = { variantId: string; name: string; score: number; reason: "sku" | "name" | "alias" | "similar" };
type Values = { name: string; salePriceXof: string | null; costXof: string | null; quantity: string | null; unit: string | null; sku: string | null; category: string | null };
type ImportRow = {
  id: string; rowNumber: number; cells: Cell[]; edits: Partial<Record<ImportField, string>>; values: Values; issues: string[]; candidates: Candidate[];
  decision: Decision | null; decisionSource: "auto" | "user" | null; matchVariantId: string | null; status: RowStatus;
  stockNote: string | null; matchName: string | null; appliedName: string | null;
};
type Summary = { created: number; matched: number; skipped: number; stockLines: number; stockIgnored: number };
type Batch = {
  id: string; fileName: string; fileType: "csv" | "xlsx"; status: "review" | "applying" | "applied" | "discarded"; sheetName: string | null; headerRowNumber: number | null;
  columnCount: number; rowCount: number; mapping: Mapping[]; mappingConfirmed: boolean; createdAt: string; appliedAt: string | null; summary: Summary | null; header: Cell[] | null;
};
type Detail = { batch: Batch; counts: Record<RowStatus, number>; rows: ImportRow[] };
type BatchItem = { id: string; fileName: string; fileType: string; status: Batch["status"]; rowCount: number; createdAt: string; pending: number };

const cellText = (cell: Cell | undefined) => (cell === undefined ? "" : typeof cell === "string" ? cell : cell.n);
const letter = (index: number) => String.fromCharCode(65 + index);
const today = () => new Date().toISOString().slice(0, 10);
const statusTone: Record<RowStatus, Tone> = { ready: "success", needs_review: "warning", invalid: "danger", skipped: "neutral", applied: "brand" };
const batchTone: Record<Batch["status"], Tone> = { review: "warning", applying: "info", applied: "success", discarded: "neutral" };

class ImportRequestError extends Error {
  constructor(readonly status: number | null, message?: string, readonly code?: string) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init }); } catch { throw new ImportRequestError(null); }
  const payload = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new ImportRequestError(response.status, payload.error, payload.code);
  return payload;
}
const sendJson = <T,>(url: string, method: "POST" | "PATCH", body: unknown) =>
  request<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function useDescribe() {
  const { t, locale } = useI18n();
  return useCallback((caught: unknown) => {
    if (!(caught instanceof ImportRequestError)) return t("errors.generic");
    // Erreurs propres à l'import : traduites dans les trois langues à partir du code stable du serveur.
    if (caught.code?.startsWith("import_")) {
      const key = `imports.codes.${caught.code}` as MessageKey;
      const text = t(key);
      if (text !== key) return locale === "fr" && caught.message ? caught.message : text;
    }
    return errorMessageFor({ status: caught.status, serverMessage: caught.message, locale, t });
  }, [locale, t]);
}

/* ------------------------------------------------------------------ Liste et envoi */

export function ImportsWorkspace() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const describe = useDescribe();
  const [batches, setBatches] = useState<BatchItem[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    request<{ batches: BatchItem[] }>("/api/business/imports").then((body) => setBatches(body.batches)).catch((caught) => { setBatches([]); setError(describe(caught)); });
  }, [describe]);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) { setError(t("imports.upload.noFile")); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const body = await request<{ import: { id: string; existing: boolean } }>("/api/business/imports", { method: "POST", body: form });
      router.push(`/business/imports/${body.import.id}${body.import.existing ? "?existing=1" : ""}`);
    } catch (caught) { setError(describe(caught)); setBusy(false); }
  };

  return (
    <div>
      <PageHeader kicker={t("imports.kicker")} title={t("imports.title")}>{t("imports.intro")}</PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        <Card className="grid gap-4" aria-labelledby="imports-upload-title">
          <CardTitle id="imports-upload-title" title={t("imports.upload.title")} />
          <form onSubmit={(event) => void upload(event)} className="grid gap-4">
            <Field label={t("imports.upload.label")} hint={t("imports.upload.hint")}>
              {(props) => (
                <input {...props} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }}
                  className="block w-full cursor-pointer rounded-[14px] border border-dashed border-line-strong bg-paper p-3 text-sm text-fg file:me-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:font-semibold file:text-brand" />
              )}
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" size="lg" block loading={busy} disabled={busy} icon={<Icon name="layers" />}>{busy ? t("imports.upload.reading") : t("imports.upload.button")}</Button>
          </form>
        </Card>
        <Card className="grid gap-3" aria-labelledby="imports-list-title">
          <CardTitle id="imports-list-title" title={t("imports.list.title")} />
          {batches === null ? <div className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            : batches.length === 0 ? <EmptyState icon="layers" title={t("imports.list.empty")}>{t("imports.list.emptyHint")}</EmptyState>
              : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {batches.map((batch) => (
                    <li key={batch.id}>
                      <Link href={`/business/imports/${batch.id}`} className="flex items-center gap-3 rounded-[16px] border border-line p-3 text-ink no-underline hover:bg-surface-muted">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-brand-soft text-xs font-bold text-brand uppercase">{batch.fileType}</span>
                        <span className="min-w-0 flex-1">
                          <strong dir="auto" className="block truncate text-sm">{batch.fileName}</strong>
                          <small className="block text-xs text-fg-subtle">{formatDateTime(batch.createdAt, locale)} · {t("imports.list.rows", { count: batch.rowCount })}</small>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={batchTone[batch.status]}>{t(`imports.status.${batch.status}`)}</Badge>
                          {batch.status === "review" && batch.pending > 0 && <small className="text-xs text-warn">{t("imports.list.pending", { count: batch.pending })}</small>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Revue */

export function ImportReviewWorkspace({ importId, existing }: { importId: string; existing: boolean }) {
  const { t } = useI18n();
  const describe = useDescribe();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(existing ? t("imports.upload.existing") : "");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setDetail(await request<Detail>(`/api/business/imports/${importId}`)); setLoadError(""); } catch (caught) { setLoadError(describe(caught)); }
  }, [importId, describe]);
  useEffect(() => { void load(); }, [load]);

  /** Toute modification passe par le serveur, puis l'import entier est relu (les doublons d'autres lignes peuvent changer). */
  const mutate = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    setError("");
    try { await action(); await load(); if (success) setNotice(success); return true; } catch (caught) { setError(describe(caught)); await load(); return false; }
  }, [describe, load]);

  if (!detail) {
    return loadError ? <Alert tone="danger">{loadError}</Alert> : <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  }
  const { batch } = detail;
  const editable = batch.status === "review";

  return (
    <div>
      <PageHeader kicker={t("imports.kicker")} title={batch.fileName}
        leading={<Link href="/business/imports" aria-label={t("imports.review.back")} className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-fg-muted no-underline hover:text-ink"><Icon name="back" className="rtl:-scale-x-100" /></Link>}
        actions={<Badge tone={batchTone[batch.status]}>{t(`imports.status.${batch.status}`)}</Badge>}>
        {editable ? t("imports.review.saved") : t("imports.review.closed")}
      </PageHeader>
      <div className="grid gap-3">
        {notice && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
        {error && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error}</Alert>}
        {batch.sheetName && <p className="m-0 text-sm text-fg-muted">{t("imports.review.sheet", { name: batch.sheetName })}</p>}
        <ColumnsCard detail={detail} editable={editable} mutate={mutate} />
        <RowsCard detail={detail} editable={editable && batch.mappingConfirmed} mutate={mutate} />
        <ApplyCard detail={detail} editable={editable} mutate={mutate} onApplied={(text) => setNotice(text)} />
      </div>
    </div>
  );
}

type Mutate = (action: () => Promise<unknown>, success?: string) => Promise<boolean>;

function ColumnsCard({ detail, editable, mutate }: { detail: Detail; editable: boolean; mutate: Mutate }) {
  const { t } = useI18n();
  const { batch, rows } = detail;
  const hasApplied = rows.some((row) => row.status === "applied");
  const [open, setOpen] = useState(!batch.mappingConfirmed);
  const [headerRow, setHeaderRow] = useState<number | null>(batch.headerRowNumber);
  const [fields, setFields] = useState<(ImportField | null)[]>(() => Array.from({ length: batch.columnCount }, (_, column) => batch.mapping.find((entry) => entry.column === column)?.field ?? null));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOpen(!batch.mappingConfirmed); }, [batch.mappingConfirmed]);

  const headerOptions = useMemo(() => [...new Set([batch.headerRowNumber, ...rows.slice(0, 5).map((row) => row.rowNumber)].filter((value): value is number => value !== null))].sort((a, b) => a - b).slice(0, 5), [batch.headerRowNumber, rows]);
  const headerCells = headerRow === null ? null : headerRow === batch.headerRowNumber ? batch.header : rows.find((row) => row.rowNumber === headerRow)?.cells ?? null;
  const samples = rows.filter((row) => row.rowNumber !== headerRow).slice(0, 3);
  const duplicateField = fields.find((field, index) => field && fields.indexOf(field) !== index);
  const missingName = !fields.includes("name");

  const confirm = async () => {
    setBusy(true);
    const ok = await mutate(() => sendJson(`/api/business/imports/${batch.id}`, "PATCH", { headerRowNumber: headerRow, mapping: fields.map((field, column) => ({ column, field })) }), t("imports.columns.confirmed"));
    setBusy(false);
    if (ok) setOpen(false);
  };

  return (
    <Card className="grid gap-4" aria-labelledby="import-columns-title">
      <CardTitle id="import-columns-title" title={t("imports.columns.title")}
        aside={batch.mappingConfirmed ? <Badge tone="success"><Icon name="check" className="size-3.5" />{t("imports.columns.done")}</Badge> : <Badge tone="warning">{t("imports.columns.toConfirm")}</Badge>} />
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          {fields.map((field, column) => field && <Badge key={column} tone="neutral">{letter(column)} · {t(`imports.fields.${field}`)}</Badge>)}
          {editable && !hasApplied && <Button variant="ghost" onClick={() => setOpen(true)} icon={<Icon name="edit" className="size-4" />}>{t("imports.columns.edit")}</Button>}
        </div>
      ) : (
        <>
          <p className="m-0 text-sm text-fg-muted">{t("imports.columns.intro")}</p>
          <Field label={t("imports.columns.headerRow")} className="max-w-md">
            {(props) => (
              <Select {...props} disabled={!editable} value={headerRow ?? ""} onChange={(event) => setHeaderRow(event.target.value ? Number(event.target.value) : null)}>
                <option value="">{t("imports.columns.noHeader")}</option>
                {headerOptions.map((number) => <option key={number} value={number}>{t("imports.columns.rowN", { number })}</option>)}
              </Select>
            )}
          </Field>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {fields.map((field, column) => {
              const title = cellText(headerCells?.[column]);
              const inferred = batch.mapping.find((entry) => entry.column === column);
              return (
                <li key={column} className="grid gap-2 rounded-[16px] border border-line bg-paper p-3">
                  <div className="flex items-start justify-between gap-2">
                    <strong dir="auto" className="min-w-0 truncate text-sm text-ink">{title || t("imports.columns.columnN", { letter: letter(column) })}</strong>
                    {!batch.mappingConfirmed && inferred?.field && inferred.field === field && inferred.confidence && (
                      <Badge tone={inferred.confidence === "certain" ? "success" : "warning"}>{t(`imports.columns.confidence.${inferred.confidence}`)}</Badge>
                    )}
                  </div>
                  <p className="m-0 min-h-5 truncate text-xs text-fg-subtle" dir="auto">
                    <span className="font-semibold">{t("imports.columns.examples")} :</span> {samples.map((row) => cellText(row.cells[column])).filter(Boolean).join(" · ") || t("imports.rows.none")}
                  </p>
                  <Select aria-label={`${title || t("imports.columns.columnN", { letter: letter(column) })}`} disabled={!editable} value={field ?? ""}
                    onChange={(event) => setFields((current) => current.map((value, index) => index === column ? (event.target.value as ImportField) || null : value))}>
                    <option value="">{t("imports.columns.ignore")}</option>
                    {FIELDS.map((option) => <option key={option} value={option}>{t(`imports.fields.${option}`)}</option>)}
                  </Select>
                </li>
              );
            })}
          </ul>
          {(duplicateField || missingName) && <Alert tone="warning">{t(duplicateField ? "imports.columns.duplicate" : "imports.columns.nameRequired")}</Alert>}
          {editable && <Button size="lg" onClick={() => void confirm()} loading={busy} disabled={busy || Boolean(duplicateField) || missingName} icon={<Icon name="check" />} className="justify-self-start">{t("imports.columns.confirm")}</Button>}
        </>
      )}
    </Card>
  );
}

type Filter = "todo" | "all" | "ready" | "skipped";
const PAGE = 40;

function RowsCard({ detail, editable, mutate }: { detail: Detail; editable: boolean; mutate: Mutate }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("todo");
  const [shown, setShown] = useState(PAGE);
  const pending = detail.counts.needs_review + detail.counts.invalid;
  useEffect(() => { if (pending === 0 && filter === "todo") setFilter("all"); }, [pending, filter]);
  const visible = detail.rows.filter((row) => filter === "all" || (filter === "todo" ? row.status === "needs_review" || row.status === "invalid"
    : filter === "ready" ? row.status === "ready" || row.status === "applied" : row.status === "skipped"));
  return (
    <Card className="grid gap-4" aria-labelledby="import-rows-title">
      <CardTitle id="import-rows-title" title={t("imports.rows.title")} />
      <Segmented<Filter> label={t("imports.rows.filterLabel")} value={filter} onChange={(value) => { setFilter(value); setShown(PAGE); }} options={[
        { value: "todo", label: t("imports.rows.filters.todo"), count: pending },
        { value: "all", label: t("imports.rows.filters.all"), count: detail.rows.length },
        { value: "ready", label: t("imports.rows.filters.ready"), count: detail.counts.ready + detail.counts.applied },
        { value: "skipped", label: t("imports.rows.filters.skipped"), count: detail.counts.skipped },
      ]} />
      {visible.length === 0 ? <EmptyState icon="success" title={t("imports.rows.empty")} /> : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {visible.slice(0, shown).map((row) => <RowItem key={row.id} row={row} batch={detail.batch} editable={editable && row.status !== "applied"} mutate={mutate} />)}
        </ul>
      )}
      {visible.length > shown && <Button variant="secondary" block onClick={() => setShown((value) => value + PAGE)}>{t("imports.rows.more")}</Button>}
    </Card>
  );
}

function RowItem({ row, batch, editable, mutate }: { row: ImportRow; batch: Batch; editable: boolean; mutate: Mutate }) {
  const { t, locale } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/business/imports/${batch.id}/rows/${row.id}`;
  const act = async (body: Record<string, unknown>) => { setBusy(true); await mutate(() => sendJson(url, "PATCH", body)); setBusy(false); };
  const source = row.cells.map(cellText).filter(Boolean).join(" · ");
  const quantity = row.values.quantity ? `${formatQuantity(row.values.quantity, locale)}${row.values.unit ? ` ${row.values.unit}` : ""}` : t("imports.rows.none");

  return (
    <li className={cn("grid gap-3 rounded-[18px] border p-3 sm:p-4", row.status === "invalid" ? "border-danger/40" : row.status === "needs_review" ? "border-warn/50" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-ink">{t("imports.rows.line", { number: row.rowNumber })}</strong>
        <Badge tone={statusTone[row.status]}>{t(`imports.rows.status.${row.status}`)}</Badge>
        {row.decisionSource === "auto" && row.decision && row.status !== "applied" && <small className="text-xs text-fg-subtle">{t("imports.rows.auto")}</small>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-[14px] bg-surface-muted p-3">
          <p className="m-0 mb-1 text-xs font-semibold text-fg-muted">{t("imports.rows.source")}</p>
          <p dir="auto" className="m-0 text-sm break-words text-fg">{source || t("imports.rows.none")}</p>
        </div>
        <dl className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[14px] border border-line p-3 text-sm">
          <dt className="col-span-2 mb-1 text-xs font-semibold text-fg-muted">{t("imports.rows.understood")}</dt>
          <dt className="text-fg-muted">{t("imports.fields.name")}</dt><dd dir="auto" className="m-0 truncate font-semibold text-ink">{row.values.name || t("imports.rows.none")}</dd>
          <dt className="text-fg-muted">{t("imports.fields.salePrice")}</dt><dd className="numeric m-0">{row.values.salePriceXof ? formatXof(row.values.salePriceXof, locale) : t("imports.rows.none")}</dd>
          <dt className="text-fg-muted">{t("imports.fields.quantity")}</dt><dd dir="auto" className="numeric m-0">{quantity}</dd>
          {row.values.costXof && <><dt className="text-fg-muted">{t("imports.fields.cost")}</dt><dd className="numeric m-0">{formatXof(row.values.costXof, locale)}</dd></>}
          {row.values.sku && <><dt className="text-fg-muted">{t("imports.fields.sku")}</dt><dd dir="ltr" className="m-0 truncate font-mono text-start">{row.values.sku}</dd></>}
          {row.values.category && <><dt className="text-fg-muted">{t("imports.fields.category")}</dt><dd dir="auto" className="m-0 truncate">{row.values.category}</dd></>}
        </dl>
      </div>
      {row.status !== "applied" && row.issues.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {row.issues.map((issue) => (
            <li key={issue} className={cn("flex items-start gap-2 text-sm", issue === "stock_existing" || issue === "match_needed" || issue === "extra_cells" ? "text-warn" : "text-danger")}>
              <Icon name="warning" className="mt-0.5 size-4 shrink-0" />{t(`imports.issues.${issue}` as MessageKey)}
            </li>
          ))}
        </ul>
      )}
      {row.status === "applied" ? (
        <p className="m-0 flex items-center gap-2 text-sm text-ok"><Icon name="success" className="size-4" />
          {row.appliedName ? t(row.decision === "create" ? "imports.rows.createdAs" : "imports.rows.matchedTo", { name: row.appliedName }) : t("imports.rows.status.applied")}
          {row.stockNote === "applied" && ` · ${t("imports.rows.stockApplied")}`}{row.stockNote === "existing_stock" && ` · ${t("imports.rows.stockExisting")}`}
        </p>
      ) : (
        <>
          {row.decision === "match" && row.matchName && <p className="m-0 text-sm font-semibold text-brand" dir="auto">{t("imports.rows.matchedTo", { name: row.matchName })}</p>}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label={t("imports.rows.decisionLabel")} className="flex flex-wrap gap-1.5">
                {(["create", "match", "skip"] as const).map((decision) => (
                  <Button key={decision} variant={row.decision === decision ? "primary" : "secondary"} aria-pressed={row.decision === decision} disabled={busy}
                    onClick={() => decision === "match" ? setChoosing((value) => !value) : void act({ decision })}>
                    {t(`imports.rows.decision.${decision}`)}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)} icon={<Icon name="edit" className="size-4" />}>{t("imports.rows.edit")}</Button>
              {row.decisionSource === "user" && <Button variant="ghost" disabled={busy} onClick={() => void act({ decision: "auto" })}>{t("imports.rows.restore")}</Button>}
            </div>
          )}
          {editable && (choosing || (row.decision === null && row.candidates.length > 0)) && (
            <CandidatePicker row={row} busy={busy} onPick={(variantId) => { setChoosing(false); void act({ decision: "match", matchVariantId: variantId }); }} />
          )}
        </>
      )}
      <RowEditor row={row} batch={batch} open={editing} onClose={() => setEditing(false)} onSave={async (edits) => { setBusy(true); const ok = await mutate(() => sendJson(url, "PATCH", { edits })); setBusy(false); if (ok) setEditing(false); }} busy={busy} />
    </li>
  );
}

function CandidatePicker({ row, busy, onPick }: { row: ImportRow; busy: boolean; onPick: (variantId: string) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [results, setResults] = useState<{ variantId: string; name: string; sku: string | null }[] | null>(null);
  useEffect(() => {
    if (!q) { setResults(null); return; }
    const controller = new AbortController();
    fetch(`/api/business/products?limit=8&q=${encodeURIComponent(q)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.json()).then((body: { items?: { variantId: string; name: string; sku: string | null }[] }) => setResults(body.items ?? []))
      .catch(() => { if (!controller.signal.aborted) setResults([]); });
    return () => controller.abort();
  }, [q]);
  const option = (variantId: string, name: string, detail: string) => (
    <li key={variantId} className="flex items-center gap-2 rounded-[12px] border border-line bg-surface p-2">
      <span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm text-ink">{name}</strong><small className="block truncate text-xs text-fg-subtle">{detail}</small></span>
      <Button variant={row.matchVariantId === variantId ? "primary" : "secondary"} disabled={busy} onClick={() => onPick(variantId)}>
        {row.matchVariantId === variantId ? t("imports.rows.chosen") : t("imports.rows.choose")}
      </Button>
    </li>
  );
  return (
    <div className="grid gap-2 rounded-[14px] bg-surface-muted p-3">
      {row.candidates.length > 0 && <>
        <p className="m-0 text-xs font-semibold text-fg-muted">{t("imports.rows.candidates")}</p>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {row.candidates.map((candidate) => option(candidate.variantId, candidate.name, t(`imports.rows.reasons.${candidate.reason}`, { score: Math.round(candidate.score * 100) })))}
        </ul>
      </>}
      <SearchField value={query} onChange={setQuery} label={t("imports.rows.searchOther")} placeholder={t("imports.rows.searchPlaceholder")} />
      {results !== null && (results.length === 0 ? <p className="m-0 text-sm text-fg-muted">{t("imports.rows.noResult")}</p> : (
        <ul className="m-0 grid list-none gap-1.5 p-0">{results.map((item) => option(item.variantId, item.name, item.sku ?? ""))}</ul>
      ))}
    </div>
  );
}

function RowEditor({ row, batch, open, onClose, onSave, busy }: { row: ImportRow; batch: Batch; open: boolean; onClose: () => void; onSave: (edits: Partial<Record<ImportField, string | null>>) => Promise<void>; busy: boolean }) {
  const { t } = useI18n();
  return (
    <FormDialog open={open} onClose={onClose} title={t("imports.editor.title", { number: row.rowNumber })} labelledBy={`import-row-editor-${row.id}`}>
      {/* Le formulaire n'est monté qu'à l'ouverture : il repart toujours de l'état actuel de la ligne. */}
      <RowEditorForm row={row} batch={batch} onClose={onClose} onSave={onSave} busy={busy} />
    </FormDialog>
  );
}

function RowEditorForm({ row, batch, onClose, onSave, busy }: { row: ImportRow; batch: Batch; onClose: () => void; onSave: (edits: Partial<Record<ImportField, string | null>>) => Promise<void>; busy: boolean }) {
  const { t } = useI18n();
  const original = (field: ImportField) => {
    const column = batch.mapping.find((entry) => entry.field === field)?.column;
    return column === undefined ? "" : cellText(row.cells[column]);
  };
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map((field) => [field, row.edits[field] ?? original(field)])) as Record<ImportField, string>);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Une valeur égale à la cellule d'origine efface la correction : la provenance reste lisible.
    const edits = Object.fromEntries(FIELDS.filter((field) => form[field] !== (row.edits[field] ?? original(field)))
      .map((field) => [field, form[field].trim() === original(field) ? null : form[field]]));
    void onSave(edits);
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      {FIELDS.map((field) => (
        <Field key={field} label={t(`imports.fields.${field}`)} hint={original(field) ? t("imports.editor.original", { value: original(field) }) : undefined}>
          {(props) => <Input {...props} dir="auto" maxLength={300} inputMode={field === "salePrice" || field === "cost" ? "numeric" : field === "quantity" ? "decimal" : undefined}
            value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} />}
        </Field>
      ))}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose}>{t("imports.editor.cancel")}</Button>
        <Button type="submit" loading={busy} disabled={busy}>{t("imports.editor.save")}</Button>
      </div>
    </form>
  );
}

function ApplyCard({ detail, editable, mutate, onApplied }: { detail: Detail; editable: boolean; mutate: Mutate; onApplied: (text: string) => void }) {
  const { t } = useI18n();
  const { batch, rows, counts } = detail;
  const [referenceDate, setReferenceDate] = useState(today());
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  // Même état des lignes = même clé : un double appui ou une réponse perdue ne crée rien deux fois.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const ready = rows.filter((row) => row.status === "ready");
  const plan = {
    create: ready.filter((row) => row.decision === "create").length,
    match: ready.filter((row) => row.decision === "match").length,
    stock: ready.filter((row) => row.values.quantity && !row.issues.includes("stock_existing")).length,
    skipped: counts.skipped,
  };
  const pending = counts.needs_review + counts.invalid;
  const invalid = rows.filter((row) => row.status === "invalid");

  const apply = async () => {
    const fingerprint = JSON.stringify([referenceDate, ready.map((row) => [row.id, row.decision, row.matchVariantId])]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: `import-${crypto.randomUUID()}` };
    setBusy(true);
    let summary: Summary | null = null;
    const ok = await mutate(async () => {
      const body = await sendJson<{ result: { status: string; summary: Summary | null } }>(`/api/business/imports/${batch.id}/apply`, "POST", { idempotencyKey: attempt.current!.key, referenceDate });
      summary = body.result.summary;
    });
    setBusy(false); setConfirming(false);
    const result = summary as Summary | null;
    if (ok && result) onApplied(`${t("imports.apply.done")} ${t("imports.apply.result", { created: result.created, matched: result.matched, stock: result.stockLines })}`);
  };
  const skipInvalid = async () => {
    setBusy(true);
    await mutate(async () => { for (const row of invalid) await sendJson(`/api/business/imports/${batch.id}/rows/${row.id}`, "PATCH", { decision: "skip" }); });
    setBusy(false);
  };
  const discard = async () => {
    setBusy(true);
    await mutate(() => sendJson(`/api/business/imports/${batch.id}/discard`, "POST", {}), t("imports.discard.done"));
    setBusy(false); setDiscarding(false);
  };

  if (batch.status === "applied" && batch.summary) {
    return (
      <Card className="grid gap-3" aria-labelledby="import-apply-title">
        <CardTitle id="import-apply-title" title={t("imports.apply.title")} aside={<Badge tone="success">{t("imports.status.applied")}</Badge>} />
        <p className="m-0 text-sm text-fg">{t("imports.apply.result", { created: batch.summary.created, matched: batch.summary.matched, stock: batch.summary.stockLines })}</p>
        {batch.summary.stockIgnored > 0 && <Alert tone="warning">{t("imports.apply.stockIgnored", { count: batch.summary.stockIgnored })}</Alert>}
        <Link href="/business/products" className={cn(buttonClasses({ variant: "secondary" }), "justify-self-start no-underline")}>{t("imports.apply.goProducts")}</Link>
      </Card>
    );
  }
  if (!editable) return null;
  const canApply = batch.mappingConfirmed && pending === 0 && ready.length > 0;
  return (
    <Card className="grid gap-4" aria-labelledby="import-apply-title">
      <CardTitle id="import-apply-title" title={t("imports.apply.title")} />
      <p className="m-0 text-sm text-fg-muted">{t("imports.apply.intro")}</p>
      <ul className="m-0 grid list-none gap-1.5 p-0 text-sm text-fg">
        {(["create", "match", "stock", "skipped"] as const).map((key) => (
          <li key={key} className="flex items-center gap-2"><Icon name={key === "skipped" ? "ban" : key === "stock" ? "box" : key === "match" ? "layers" : "plus"} className="size-4 text-fg-subtle" />{t(`imports.apply.${key}`, { count: plan[key] })}</li>
        ))}
      </ul>
      {!batch.mappingConfirmed && <Alert tone="warning">{t("imports.apply.mappingFirst")}</Alert>}
      {batch.mappingConfirmed && pending > 0 && (
        <Alert tone="warning">
          {t("imports.apply.blocked", { count: pending })}
          {invalid.length > 0 && <Button variant="secondary" className="ms-2 mt-2" disabled={busy} onClick={() => void skipInvalid()}>{t("imports.rows.skipInvalid", { count: invalid.length })}</Button>}
        </Alert>
      )}
      {plan.stock > 0 && (
        <Field label={t("imports.apply.referenceDate")} className="max-w-xs">
          {(props) => <Input {...props} type="date" max={today()} value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} />}
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" variant="cta" disabled={!canApply || busy} onClick={() => setConfirming(true)} icon={<Icon name="check" />}>{t("imports.apply.button")}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setDiscarding(true)} icon={<Icon name="trash" className="size-4" />}>{t("imports.discard.button")}</Button>
      </div>
      <ConfirmDialog open={confirming} busy={busy} tone="cta" onClose={() => !busy && setConfirming(false)} onConfirm={() => void apply()} title={t("imports.apply.confirmTitle")} confirmLabel={t("imports.apply.confirm")}>
        {t("imports.apply.confirmBody")}
      </ConfirmDialog>
      <ConfirmDialog open={discarding} busy={busy} tone="danger" onClose={() => !busy && setDiscarding(false)} onConfirm={() => void discard()} title={t("imports.discard.title")} confirmLabel={t("imports.discard.confirm")}>
        {t("imports.discard.body")}
      </ConfirmDialog>
    </Card>
  );
}
