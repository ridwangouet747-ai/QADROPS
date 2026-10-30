"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, SearchField, Segmented } from "@/components/ui/controls";
import { Alert, Badge, EmptyState, ProgressBar, Skeleton, type Tone } from "@/components/ui/feedback";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { QuantityInput } from "@/components/ui/quantity-input";
import { parseQuantityInput, toApiQuantity } from "@/lib/client/quantity";
import { formatDateTime, formatQuantity, formatTime } from "@/lib/i18n/format";
import type { Translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

type InventoryLine = {
  variantId: string; productName: string; variantLabel: string; baseUnit: string; currentQty: string;
  countedQty: string | null; theoreticalQty: string | null; countedAt: string | null; adjustmentReason: string | null;
};
type SessionStatus = "counting" | "submitted" | "validated" | "canceled";
type InventorySession = { id: string; status: SessionStatus; createdAt: string; submittedAt: string | null; validatedAt: string | null; categoryName: string | null; scopeCount: number; countedCount: number };
type Workspace = { sessions: InventorySession[]; categories: { id: string; name: string }[] };
type SessionDetail = InventorySession & { lines: InventoryLine[] };
type Filter = "todo" | "counted" | "variance" | "all";

const statusTone: Record<SessionStatus, Tone> = { counting: "info", submitted: "warning", validated: "success", canceled: "neutral" };
const PAGE_SIZE = 30;

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
const reference = (line: InventoryLine) => line.theoreticalQty ?? line.currentQty;
const savedDelta = (line: InventoryLine) => {
  if (line.countedQty === null) return null;
  const counted = parseQuantityInput(line.countedQty);
  const baseline = parseQuantityInput(reference(line));
  return counted === null || baseline === null ? null : counted - baseline;
};
const microsLabel = (micros: bigint, locale: Locale) => {
  const absolute = micros < 0n ? -micros : micros;
  return formatQuantity(`${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")}`, locale);
};

const without = (record: Record<string, string>, key: string) => {
  const next = { ...record };
  delete next[key];
  return next;
};

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  try { return await response.json() as T & { error?: string }; } catch { return {} as T & { error?: string }; }
}

function useOnline() {
  return useSyncExternalStore(
    (notify) => { window.addEventListener("online", notify); window.addEventListener("offline", notify); return () => { window.removeEventListener("online", notify); window.removeEventListener("offline", notify); }; },
    () => navigator.onLine,
    () => true,
  );
}

const sessionFromUrl = () => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("session") ?? "");

export function InventoryWorkspace() {
  const { t, locale } = useI18n();
  const online = useOnline();
  const [workspace, setWorkspace] = useState<Workspace>({ sessions: [], categories: [] });
  const [selectedSession, setSelectedSession] = useState("");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  // Saisies non encore enregistrées, par variante. Elles survivent aux rechargements du détail.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [savingLine, setSavingLine] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"submit" | "validate" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshWorkspace = useCallback(async () => {
    const response = await fetch("/api/business/inventories", { cache: "no-store" });
    const body = await readJson<Workspace>(response);
    if (!response.ok) throw new Error(body.error ?? t("inventory.sessions.loadFailed"));
    setWorkspace({ sessions: body.sessions ?? [], categories: body.categories ?? [] });
  }, [t]);

  const refreshDetail = useCallback(async (sessionId: string) => {
    if (!sessionId) { setDetail(null); return; }
    const response = await fetch(`/api/business/inventories/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    const body = await readJson<{ session?: SessionDetail }>(response);
    if (!response.ok || !body.session) throw new Error(body.error ?? t("inventory.detail.loadFailed"));
    setDetail(body.session);
  }, [t]);

  // L'identifiant de session vit dans l'URL : le bouton retour d'Android ramène à la liste,
  // et un comptage interrompu se rouvre depuis son lien.
  const openSession = useCallback((sessionId: string) => {
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set("session", sessionId); else url.searchParams.delete("session");
    window.history.pushState(null, "", url);
    setSelectedSession(sessionId);
  }, []);

  useEffect(() => {
    const sync = () => setSelectedSession(sessionFromUrl());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    let alive = true;
    refreshWorkspace().catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : t("common.genericError")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshWorkspace, t]);

  useEffect(() => {
    let alive = true;
    setFilter(null); setQuery(""); setVisible(PAGE_SIZE); setDrafts({}); setReasonDrafts({}); setLineErrors({});
    if (!selectedSession) { setDetail(null); return; }
    setDetailLoading(true);
    refreshDetail(selectedSession).catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : t("common.genericError")); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [refreshDetail, selectedSession, t]);

  const lines = useMemo(() => detail?.lines ?? [], [detail]);
  const counts = useMemo(() => {
    const counted = lines.filter((line) => line.countedQty !== null);
    return { todo: lines.length - counted.length, counted: counted.length, variance: counted.filter((line) => savedDelta(line) !== 0n).length, all: lines.length };
  }, [lines]);
  const activeFilter: Filter = filter ?? (detail?.status === "counting" && counts.todo > 0 ? "todo" : "all");
  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return lines.filter((line) => {
      if (activeFilter === "todo" && line.countedQty !== null) return false;
      if (activeFilter === "counted" && line.countedQty === null) return false;
      if (activeFilter === "variance" && (line.countedQty === null || savedDelta(line) === 0n)) return false;
      return !needle || normalize(`${line.productName} ${line.variantLabel}`).includes(needle);
    });
  }, [lines, activeFilter, query]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/business/inventories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selectedCategory ? { categoryId: selectedCategory } : {}) });
      const body = await readJson<{ session?: { id: string } }>(response);
      if (!response.ok || !body.session) throw new Error(body.error ?? t("inventory.start.failed"));
      await refreshWorkspace();
      openSession(body.session.id);
      setNotice(t("inventory.start.started"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("inventory.start.failed")); }
    finally { setBusy(false); }
  };

  const saveLine = async (line: InventoryLine) => {
    const entered = drafts[line.variantId] ?? (line.countedQty !== null ? formatQuantity(line.countedQty, locale) : "");
    const reason = (reasonDrafts[line.variantId] ?? line.adjustmentReason ?? "").trim();
    const actual = parseQuantityInput(entered);
    const setLineError = (message: string) => setLineErrors((current) => ({ ...current, [line.variantId]: message }));
    if (actual === null) { setLineError(t("inventory.line.invalidQuantity", { product: line.productName })); return; }
    if (actual !== parseQuantityInput(reference(line)) && !reason) { setLineError(t("inventory.line.reasonRequired", { product: line.productName })); return; }
    setSavingLine(line.variantId); setNotice(""); setError("");
    setLineErrors((current) => without(current, line.variantId));
    try {
      const response = await fetch(`/api/business/inventories/${encodeURIComponent(selectedSession)}/counts`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId: line.variantId, countedQty: toApiQuantity(entered), adjustmentReason: reason }),
      });
      const body = await readJson<object>(response);
      if (!response.ok) throw new Error(body.error ?? t("common.genericError"));
      setDrafts((current) => without(current, line.variantId));
      setReasonDrafts((current) => without(current, line.variantId));
      await Promise.all([refreshDetail(selectedSession), refreshWorkspace()]);
      setNotice(t("inventory.line.saved", { product: line.productName }));
    } catch (caught) {
      setLineError(caught instanceof Error ? caught.message : t("common.genericError"));
    } finally { setSavingLine(""); }
  };

  const transition = async (kind: "submit" | "validate") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/business/inventories/${encodeURIComponent(selectedSession)}/${kind}`, { method: "POST" });
      const body = await readJson<object>(response);
      if (!response.ok) throw new Error(body.error ?? t("common.genericError"));
      await Promise.all([refreshWorkspace(), refreshDetail(selectedSession)]);
      setNotice(t(kind === "submit" ? "inventory.actions.submitted" : "inventory.actions.validated"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("common.genericError")); }
    finally { setBusy(false); setConfirm(null); }
  };

  const downloadCsv = () => {
    if (!detail) return;
    const quote = (value: string) => `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
    const rows = [[t("inventory.csv.product"), t("inventory.csv.variant"), t("inventory.csv.reference"), t("inventory.csv.counted"), t("inventory.csv.difference"), t("inventory.csv.reason")], ...detail.lines.map((line) => {
      const delta = savedDelta(line);
      return [line.productName, line.variantLabel, line.theoreticalQty ?? t("inventory.csv.notCounted"), line.countedQty ?? t("inventory.csv.notCounted"),
        delta === null ? "" : `${delta < 0n ? "-" : ""}${microsLabel(delta, "en")}`, line.adjustmentReason ?? ""];
    })];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${t("inventory.csv.fileName")}-${detail.id.slice(0, 8)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const selected = workspace.sessions.find((session) => session.id === selectedSession);
  const sessionsNewestFirst = useMemo(() => [...workspace.sessions].reverse(), [workspace.sessions]);
  const counting = detail?.status === "counting";

  return (
    <div className="pb-4">
      <PageHeader kicker={t("inventory.kicker")} title={t("inventory.title")}>{t("inventory.intro")}</PageHeader>

      <div className="mb-3 grid gap-2 empty:hidden" aria-live="polite">
        {!online && <Alert tone="warning">{t("common.offline")}</Alert>}
        {error && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:items-start">
        {/* Colonne liste : seule visible sur téléphone tant qu'aucun comptage n'est ouvert. */}
        <div className={cn("grid gap-4", selectedSession && "max-lg:hidden")}>
          <Card aria-labelledby="inventory-start-title">
            <CardTitle id="inventory-start-title" title={t("inventory.start.title")} />
            <form onSubmit={start} className="grid gap-3">
              <p className="m-0 text-sm text-fg-muted">{t("inventory.start.description")}</p>
              <Field label={t("inventory.start.scopeLabel")}>
                {(props) => (
                  <Select {...props} value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                    <option value="">{t("inventory.start.scopeAll")}</option>
                    {workspace.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </Select>
                )}
              </Field>
              <Button type="submit" variant="cta" block loading={busy && !selectedSession} disabled={loading || busy || !online} icon={<Icon name="plus" />}>
                {busy && !selectedSession ? t("inventory.start.submitting") : t("inventory.start.submit")}
              </Button>
            </form>
          </Card>

          <Card aria-labelledby="inventory-list-title">
            <CardTitle id="inventory-list-title" title={t("inventory.sessions.title")} aside={<Badge>{workspace.sessions.length}</Badge>} />
            {loading ? (
              <div className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : sessionsNewestFirst.length === 0 ? (
              <EmptyState title={t("inventory.sessions.empty")}>{t("inventory.sessions.emptyHint")}</EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {sessionsNewestFirst.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button" onClick={() => openSession(session.id)} aria-current={selectedSession === session.id ? "true" : undefined}
                      className={cn(
                        "grid w-full cursor-pointer gap-2 rounded-md border p-3 text-start transition-colors",
                        selectedSession === session.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <strong className="block truncate text-ink">{session.categoryName ?? t("inventory.sessions.allProducts")}</strong>
                          <small className="text-fg-muted">{formatDateTime(session.createdAt, locale)}</small>
                        </span>
                        <Badge tone={statusTone[session.status]}>{t(`inventory.status.${session.status}`)}</Badge>
                      </span>
                      <ProgressBar value={session.countedCount} max={session.scopeCount} label={t("inventory.sessions.counted", { counted: session.countedCount, total: session.scopeCount })} />
                      <span className="numeric text-start text-xs text-fg-muted rtl:text-end">{t("inventory.sessions.counted", { counted: session.countedCount, total: session.scopeCount })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Colonne détail */}
        <div className={cn("min-w-0", !selectedSession && "max-lg:hidden")}>
          {!selectedSession ? (
            <EmptyState title={t("inventory.sessions.title")}>{t("inventory.sessions.emptyHint")}</EmptyState>
          ) : detailLoading && !detail ? (
            <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
          ) : !detail ? (
            <Button variant="ghost" onClick={() => openSession("")} icon={<Icon name="back" />}>{t("inventory.detail.backToList")}</Button>
          ) : (
            <section aria-labelledby="inventory-detail-title" className="grid gap-3">
              <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-card">
                <Button variant="ghost" onClick={() => openSession("")} icon={<Icon name="back" />} className="-ms-2 justify-self-start lg:hidden">{t("inventory.detail.backToList")}</Button>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id="inventory-detail-title" className="m-0 text-xl font-bold text-ink">{selected?.categoryName ?? detail.categoryName ?? t("inventory.sessions.allProducts")}</h2>
                    <p className="m-0 text-sm text-fg-muted">{formatDateTime(detail.createdAt, locale)}</p>
                  </div>
                  <Badge tone={statusTone[detail.status]}>{t(`inventory.status.${detail.status}`)}</Badge>
                </div>
                <div className="grid gap-1.5">
                  <ProgressBar value={counts.counted} max={counts.all} label={t("inventory.detail.progress", { counted: counts.counted, total: counts.all })} />
                  <p className="m-0 text-sm font-semibold text-fg">{t("inventory.detail.progress", { counted: counts.counted, total: counts.all })}</p>
                </div>
                <SearchField value={query} onChange={(value) => { setQuery(value); setVisible(PAGE_SIZE); }} label={t("common.search")} placeholder={t("inventory.detail.searchPlaceholder")} />
                <Segmented<Filter>
                  label={t("inventory.detail.filterLabel")} value={activeFilter} onChange={(value) => { setFilter(value); setVisible(PAGE_SIZE); }}
                  options={(["todo", "counted", "variance", "all"] as const).map((value) => ({ value, label: t(`inventory.detail.filters.${value}`), count: counts[value] }))}
                />
                <div className="flex flex-wrap gap-2 max-sm:hidden">
                  <Button variant="secondary" onClick={downloadCsv} disabled={!lines.length} icon={<Icon name="download" />}>{t("inventory.detail.exportCsv")}</Button>
                  <Button variant="secondary" onClick={() => window.print()} icon={<Icon name="print" />}>{t("inventory.detail.print")}</Button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <EmptyState icon={activeFilter === "todo" && !query ? "success" : "search"} title={activeFilter === "todo" && !query ? t("inventory.detail.allCounted") : t("inventory.detail.noMatch")} />
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {filtered.slice(0, visible).map((line) => (
                    <InventoryLineCard
                      key={line.variantId} line={line} counting={counting} t={t} locale={locale}
                      draft={drafts[line.variantId]} reasonDraft={reasonDrafts[line.variantId]} error={lineErrors[line.variantId]}
                      saving={savingLine === line.variantId} disabled={busy || !online || (savingLine !== "" && savingLine !== line.variantId)}
                      onDraft={(value) => setDrafts((current) => ({ ...current, [line.variantId]: value }))}
                      onReason={(value) => setReasonDrafts((current) => ({ ...current, [line.variantId]: value }))}
                      onSave={() => void saveLine(line)}
                    />
                  ))}
                </ul>
              )}
              {filtered.length > visible && (
                <Button variant="secondary" block onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                  {t("common.showMore", { count: Math.min(PAGE_SIZE, filtered.length - visible) })}
                </Button>
              )}

              {/* Barre d'action collée au-dessus de la navigation mobile, pour garder l'étape suivante à portée de pouce. */}
              {detail.status !== "canceled" && (
                <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 grid gap-2 rounded-lg border border-line bg-surface/95 p-3 shadow-raised min-[801px]:bottom-3">
                  {detail.status === "counting" && <>
                    <p className="m-0 text-xs text-fg-muted">{t("inventory.actions.countingHint")}</p>
                    <Button variant="cta" size="lg" block disabled={busy || counts.todo > 0 || !online || Object.keys(drafts).length > 0} onClick={() => setConfirm("submit")}>
                      {counts.todo > 0 ? t("inventory.actions.remaining", { count: counts.todo }) : t("inventory.actions.submit")}
                    </Button>
                  </>}
                  {detail.status === "submitted" && <>
                    <p className="m-0 text-xs text-fg-muted">{t("inventory.actions.reviewHint")}</p>
                    <Button variant="primary" size="lg" block disabled={busy || !online} onClick={() => setConfirm("validate")} icon={<Icon name="check" />}>{t("inventory.actions.validate")}</Button>
                  </>}
                  {detail.status === "validated" && <p className="m-0 flex items-center gap-2 text-sm font-medium text-ok"><Icon name="success" />{t("inventory.actions.validatedHint")}</p>}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <p className="mt-5 border-s-2 border-line-strong ps-3 text-sm text-fg-muted">{t("inventory.footnote")}</p>

      <ConfirmDialog
        open={confirm !== null} onClose={() => !busy && setConfirm(null)} busy={busy}
        title={t(confirm === "validate" ? "inventory.actions.validateConfirmTitle" : "inventory.actions.submitConfirmTitle")}
        confirmLabel={t(confirm === "validate" ? "inventory.actions.validate" : "inventory.actions.submit")}
        tone={confirm === "validate" ? "primary" : "cta"}
        onConfirm={() => confirm && void transition(confirm)}
      >
        {t(confirm === "validate" ? "inventory.actions.validateConfirmBody" : "inventory.actions.submitConfirmBody")}
      </ConfirmDialog>
    </div>
  );
}

function InventoryLineCard({ line, counting, t, locale, draft, reasonDraft, error, saving, disabled, onDraft, onReason, onSave }: {
  line: InventoryLine; counting: boolean; t: Translate; locale: Locale; draft?: string; reasonDraft?: string; error?: string;
  saving: boolean; disabled: boolean; onDraft: (value: string) => void; onReason: (value: string) => void; onSave: () => void;
}) {
  const savedValue = line.countedQty !== null ? formatQuantity(line.countedQty, locale) : "";
  const value = draft ?? savedValue;
  const dirty = draft !== undefined && parseQuantityInput(draft) !== (line.countedQty !== null ? parseQuantityInput(line.countedQty) : null);
  const entered = parseQuantityInput(value);
  const baseline = parseQuantityInput(reference(line));
  const liveDelta = entered !== null && baseline !== null ? entered - baseline : null;
  const delta = counting ? liveDelta : savedDelta(line);
  const reasonValue = reasonDraft ?? line.adjustmentReason ?? "";
  const showVariant = line.variantLabel !== "Standard" && line.variantLabel.toLocaleLowerCase() !== line.baseUnit.toLocaleLowerCase();
  const unitLabel = `${showVariant ? `${line.variantLabel} · ` : ""}${line.baseUnit}`;
  const inputId = `count-${line.variantId}`;

  const state = error ? { tone: "danger" as const, label: t("inventory.line.stateError") }
    : dirty ? { tone: "warning" as const, label: t("inventory.line.stateDirty") }
    : line.countedAt ? { tone: "success" as const, label: t("inventory.line.stateSaved", { time: formatTime(line.countedAt, locale) }) }
    : { tone: "neutral" as const, label: t("inventory.line.stateUncounted") };

  const varianceText = delta === null ? null : delta === 0n ? t("inventory.line.conform")
    : t(delta > 0n ? "inventory.line.gain" : "inventory.line.loss", { qty: `${microsLabel(delta, locale)} ${line.baseUnit}` });

  return (
    <li className={cn("grid gap-3 rounded-lg border bg-surface p-3.5 shadow-card", error ? "border-danger-line" : dirty ? "border-warn-line" : "border-line")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block text-[1.02rem] leading-snug text-ink">{line.productName}</strong>
          <span className="text-sm text-fg-muted">{unitLabel}</span>
        </div>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-2 rounded-md bg-paper p-2.5">
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">{t(line.theoreticalQty ? "inventory.line.referenceAtCount" : "inventory.line.reference")}</dt>
          <dd className="m-0 font-semibold text-ink"><span className="numeric">{formatQuantity(reference(line), locale)}</span> <small className="font-normal text-fg-muted">{line.baseUnit}</small></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">{t("inventory.line.counted")}</dt>
          <dd className={cn("m-0 font-semibold", delta === null ? "text-fg-subtle" : delta === 0n ? "text-ok" : delta > 0n ? "text-info" : "text-danger")}>
            {varianceText ?? "—"}
          </dd>
        </div>
      </dl>

      {counting ? (
        <div className="grid gap-2">
          <label htmlFor={inputId} className="text-sm font-semibold text-ink">{t("inventory.line.countLabel")}</label>
          <QuantityInput
            id={inputId} value={value} onChange={onDraft} unit={line.baseUnit} disabled={disabled || saving}
            invalid={Boolean(error)} describedBy={error ? `${inputId}-error` : undefined}
            ariaLabel={t("inventory.line.countAria", { product: line.productName })}
          />
          {liveDelta !== null && liveDelta !== 0n && (
            <Field label={t("inventory.line.reasonLabel")}>
              {(props) => <Textarea {...props} rows={2} value={reasonValue} onChange={(event) => onReason(event.target.value)} placeholder={t("inventory.line.reasonPlaceholder")} maxLength={500} disabled={disabled || saving} />}
            </Field>
          )}
          {error && <p id={`${inputId}-error`} className="m-0 text-sm font-medium text-danger">{error}</p>}
          <Button variant={dirty || line.countedQty === null ? "primary" : "secondary"} onClick={onSave} loading={saving} disabled={disabled || (!dirty && reasonDraft === undefined && line.countedQty !== null)} icon={<Icon name="check" />}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      ) : line.adjustmentReason ? (
        <p className="m-0 text-sm text-fg-muted">{t("inventory.line.reasonLabel")} — {line.adjustmentReason}</p>
      ) : null}
    </li>
  );
}
