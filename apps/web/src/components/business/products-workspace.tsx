"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, FormDialog, SearchField, Segmented } from "@/components/ui/controls";
import { IconButton, Monogram, StatCard } from "@/components/ui/data-display";
import { Alert, Badge, EmptyState, Skeleton, type Tone } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, PageHeader } from "@/components/ui/layout";
import { errorMessageFor } from "@/lib/client/errors";
import { parseQuantityInput, toApiQuantity } from "@/lib/client/quantity";
import { roundXof, stockStatus, type StockStatus } from "@/lib/client/stock";
import { formatQuantity, formatXof } from "@/lib/i18n/format";
import { useBusinessRole } from "./business-shell";
import { RequestError, useDebounced, usePagedList } from "./use-paged-list";

type ProductRow = { id: string; name: string; description: string | null; categoryId: string | null; categoryName: string | null; baseUnit: string; variantId: string; variantLabel: string; sku: string | null; salePriceXof: string; onHand: string; averageCostXof: string; costKnown: boolean; lowStockThreshold: string };
type Category = { id: string; name: string };
type Availability = "all" | StockStatus;
type Draft = { name: string; categoryId: string; baseUnit: string; variantLabel: string; sku: string; salePriceXof: string; lowStockThreshold: string };
type DraftErrors = Partial<Record<keyof Draft, string>>;

const PAGE_SIZE = 24;
const statusTone: Record<StockStatus, Tone> = { ok: "success", low: "warning", out: "danger" };
type Summary = { total: number; ok: number; low: number; out: number };
/** Variante affichée seulement si elle apporte une information (ni « Standard », ni l'unité répétée). */
const variantName = (item: ProductRow) => (item.variantLabel === "Standard" || item.variantLabel.toLocaleLowerCase() === item.baseUnit.toLocaleLowerCase() ? "" : item.variantLabel);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init }); } catch { throw new RequestError(null); }
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new RequestError(response.status, body.error);
  return body;
}

export function ProductsWorkspace() {
  const { t, locale } = useI18n();
  const role = useBusinessRole();
  const canManage = ["owner", "admin", "stock_manager"].includes(role);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [availability, setAvailability] = useState<Availability>("all");
  const debouncedQuery = useDebounced(query.trim());
  // Recherche, catégorie et état sont filtrés par le serveur ; le navigateur ne reçoit qu'une page.
  const list = usePagedList<ProductRow, Summary>("/api/business/products", {
    limit: String(PAGE_SIZE), q: debouncedQuery, categoryId, status: availability === "all" ? "" : availability });
  const categories = (list.body?.categories as Category[] | undefined) ?? [];
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ProductRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [archiving, setArchiving] = useState<ProductRow | null>(null);

  const describe = useCallback((caught: unknown) => caught instanceof RequestError
    ? errorMessageFor({ status: caught.status, serverMessage: caught.message, locale, t })
    : t("errors.generic"), [locale, t]);

  const reload = list.reload;
  const loadError = list.error ? (list.error.status !== null ? describe(list.error) : t("products.loadFailed")) : "";

  const filtered = useMemo(() => list.items.map((item) => ({ item, status: stockStatus(item.onHand, item.lowStockThreshold) })), [list.items]);
  const summary = list.summary;
  const counts = { all: summary?.total ?? 0, ok: summary?.ok ?? 0, low: summary?.low ?? 0, out: summary?.out ?? 0 };
  const loaded = summary !== null;
  const filtersActive = Boolean(query || categoryId || availability !== "all");

  const openForm = (target: ProductRow | "new") => {
    setDraftErrors({});
    setDraft(target === "new"
      ? { name: "", categoryId: categoryId, baseUnit: t("products.form.defaultUnit"), variantLabel: "", sku: "", salePriceXof: "", lowStockThreshold: "0" }
      : { name: target.name, categoryId: target.categoryId ?? "", baseUnit: target.baseUnit, variantLabel: target.variantLabel === "Standard" ? "" : target.variantLabel,
          sku: target.sku ?? "", salePriceXof: target.salePriceXof, lowStockThreshold: formatQuantity(target.lowStockThreshold, locale) });
    setEditing(target);
  };

  const validate = (value: Draft) => {
    const errors: DraftErrors = {};
    if (!value.name.trim()) errors.name = t("products.form.nameRequired");
    if (!value.baseUnit.trim()) errors.baseUnit = t("products.form.unitRequired");
    if (!/^(0|[1-9]\d*)$/.test(value.salePriceXof.trim())) errors.salePriceXof = t("products.form.priceInvalid");
    if (editing !== "new" && parseQuantityInput(value.lowStockThreshold) === null) errors.lowStockThreshold = t("products.form.thresholdInvalid");
    return errors;
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !editing) return;
    const errors = validate(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true); setError(""); setNotice("");
    const name = draft.name.trim();
    try {
      if (editing === "new") {
        await request("/api/business/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          name, categoryId: draft.categoryId || undefined, baseUnit: draft.baseUnit.trim(), variantLabel: draft.variantLabel.trim() || "Standard",
          salePriceXof: draft.salePriceXof.trim(), sku: draft.sku.trim() }) });
        setNotice(t("products.notices.created", { product: name }));
      } else {
        await request(`/api/business/products/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
          productId: editing.id, variantId: editing.variantId, name, description: editing.description, categoryId: draft.categoryId || null,
          variantLabel: draft.variantLabel.trim() || "Standard", sku: draft.sku.trim() || null, salePriceXof: draft.salePriceXof.trim(),
          lowStockThreshold: toApiQuantity(draft.lowStockThreshold) }) });
        setNotice(t("products.notices.updated", { product: name }));
      }
      setEditing(null);
      await reload();
    } catch (caught) { setError(describe(caught)); }
    finally { setBusy(false); }
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/business/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      setNotice(t("products.category.created", { name }));
      setCategoryOpen(false); setCategoryName("");
      await reload();
    } catch (caught) { setError(describe(caught)); }
    finally { setBusy(false); }
  };

  const archive = async () => {
    if (!archiving) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`/api/business/products/${encodeURIComponent(archiving.id)}`, { method: "DELETE" });
      setNotice(t("products.archive.done", { product: archiving.name }));
      await reload();
    } catch (caught) { setError(describe(caught)); }
    finally { setBusy(false); setArchiving(null); }
  };

  const money = (value: string | null) => formatXof(value, locale);
  const set = (patch: Partial<Draft>) => setDraft((current) => current && { ...current, ...patch });

  return (
    <div>
      <PageHeader title={t("products.title")} actions={canManage ? <>
        <Button variant="secondary" onClick={() => { setCategoryName(""); setCategoryOpen(true); }} icon={<Icon name="plus" className="size-4" />}>{t("products.category.add")}</Button>
        <Button onClick={() => openForm("new")} icon={<Icon name="plus" />}>{t("products.add")}</Button>
      </> : undefined}>{t("products.intro")}</PageHeader>

      <div className="mb-4 grid gap-2 empty:hidden" aria-live="polite">
        {(error || loadError) && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error || loadError}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label={t("products.title")}>
        <StatCard label={t("products.stats.references")} icon="box" value={loaded ? String(counts.all) : "—"} hint={t("products.stats.referencesHint")} />
        <StatCard label={t("products.stats.categories")} icon="grid" iconTone="info" value={loaded ? String(categories.length) : "—"} hint={t("products.stats.categoriesHint")} />
        <StatCard label={t("products.stats.low")} icon="warning" iconTone="warn" value={loaded ? String(counts.low) : "—"} hint={t("products.stats.lowHint")} />
        <StatCard label={t("products.stats.out")} icon="error" iconTone="danger" value={loaded ? String(counts.out) : "—"} hint={t("products.stats.outHint")} />
      </section>

      <Card className="mt-4 grid grid-cols-1 gap-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
          <SearchField value={query} onChange={setQuery} label={t("products.filters.search")} placeholder={t("products.filters.searchPlaceholder")} />
          <Select aria-label={t("products.filters.category")} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">{t("products.filters.allCategories")}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<Availability> label={t("products.filters.availability")} value={availability} onChange={setAvailability}
            options={(["all", "ok", "low", "out"] as const).map((value) => ({ value, label: value === "all" ? t("products.filters.all") : t(`products.status.${value}`), count: counts[value] }))} />
          <div className="flex items-center gap-3">
            <span className="text-sm text-fg-subtle">{t("products.filters.results", { count: availability === "all" ? counts.all : counts[availability] })}</span>
            {filtersActive && <Button variant="ghost" onClick={() => { setQuery(""); setCategoryId(""); setAvailability("all"); }}>{t("products.filters.reset")}</Button>}
          </div>
        </div>
      </Card>

      <Card className="mt-4 p-2 sm:p-3" aria-label={t("products.title")}>
        {list.loading && list.items.length === 0 ? (
          <div className="grid gap-2 p-1">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-20 rounded-lg" />)}</div>
        ) : counts.all === 0 && !filtersActive ? (
          <div className="p-2"><EmptyState icon="box" title={t("products.list.empty")} action={canManage ? <Button onClick={() => openForm("new")} icon={<Icon name="plus" />}>{t("products.add")}</Button> : undefined}>{t("products.list.emptyHint")}</EmptyState></div>
        ) : filtered.length === 0 ? (
          <div className="p-2"><EmptyState icon="search" title={t("products.list.noMatch")} /></div>
        ) : (
          <>
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_96px] gap-3 rounded-[14px] bg-paper px-4 py-2.5 text-xs font-semibold text-fg-muted md:grid">
              <span>{t("products.list.product")}</span><span>{t("products.list.category")}</span><span>{t("products.list.stock")}</span><span>{t("products.list.price")}</span><span className="text-end">{t("products.list.actions")}</span>
            </div>
            <ul className="m-0 grid list-none gap-2 p-0 md:mt-1 md:gap-0">
              {filtered.map(({ item, status }) => {
                const cost = item.costKnown ? roundXof(item.averageCostXof) : null;
                return (
                  <li key={item.variantId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[18px] border border-line p-3 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_96px] md:rounded-none md:border-0 md:border-b md:px-4 md:py-3 md:last:border-b-0 md:hover:bg-paper">
                    <div className="flex min-w-0 items-center gap-3">
                      <Monogram text={item.name} className="size-11 rounded-[14px]" />
                      <div className="min-w-0">
                        <strong dir="auto" className="block truncate text-[0.95rem] text-ink">{item.name}</strong>
                        <small className="block truncate text-xs text-fg-subtle">
                          {variantName(item) && <span dir="auto">{variantName(item)} · </span>}
                          {item.sku ? <span dir="ltr" className="font-mono">{item.sku}</span> : item.baseUnit}
                        </small>
                      </div>
                    </div>
                    <div className="row-start-2 md:row-start-auto">
                      {item.categoryName ? <Badge tone="brand"><span dir="auto">{item.categoryName}</span></Badge> : <span className="text-xs text-fg-subtle">{t("products.list.noCategory")}</span>}
                    </div>
                    <div className="col-start-2 row-start-2 flex flex-col items-end gap-1 md:col-start-auto md:row-start-auto md:items-start">
                      <span className="text-sm font-semibold text-ink"><span className="numeric">{formatQuantity(item.onHand, locale)}</span> <span className="font-normal text-fg-subtle">{item.baseUnit}</span></span>
                      <Badge tone={statusTone[status]}>{t(`products.status.${status}`)}</Badge>
                    </div>
                    <div className="col-start-2 row-start-1 text-end md:col-start-auto md:row-start-auto md:text-start">
                      <strong className="numeric block text-[0.95rem] text-ink">{money(item.salePriceXof)}</strong>
                      <small className="hidden text-xs text-fg-subtle sm:block">{cost ? t("products.list.avgCost", { amount: money(cost) }) : t("products.list.costUnknown")}</small>
                    </div>
                    {canManage && (
                      <div className="col-span-2 flex justify-end gap-2 border-t border-line pt-2 md:col-span-1 md:border-0 md:pt-0">
                        <IconButton icon="edit" label={t("products.list.edit", { product: item.name })} onClick={() => openForm(item)} />
                        <IconButton icon="trash" label={t("products.list.archive", { product: item.name })} onClick={() => setArchiving(item)} className="hover:border-danger-line hover:text-danger" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {list.nextCursor && (
              <div className="p-2"><Button variant="secondary" block loading={list.loadingMore} onClick={() => void list.loadMore()}>{t("common.loadMore")}</Button></div>
            )}
          </>
        )}
      </Card>

      <FormDialog open={editing !== null} onClose={() => !busy && setEditing(null)} labelledBy="product-form-title" title={t(editing === "new" ? "products.form.addTitle" : "products.form.editTitle")}>
        {draft && (
          <form noValidate onSubmit={(event) => void saveProduct(event)} className="grid gap-4">
            <Field label={t("products.form.name")} error={draftErrors.name}>
              {(props) => <Input {...props} dir="auto" maxLength={160} autoComplete="off" autoFocus={editing === "new"} placeholder={t("products.form.namePlaceholder")} value={draft.name} onChange={(event) => set({ name: event.target.value })} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("products.form.category")}>
                {(props) => (
                  <Select {...props} value={draft.categoryId} onChange={(event) => set({ categoryId: event.target.value })}>
                    <option value="">{t("products.form.noCategory")}</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label={t("products.form.unit")} hint={editing === "new" ? t("products.form.unitHint") : undefined} error={draftErrors.baseUnit}>
                {(props) => <Input {...props} dir="auto" maxLength={40} value={draft.baseUnit} disabled={editing !== "new"} onChange={(event) => set({ baseUnit: event.target.value })} />}
              </Field>
            </div>
            <Field label={t("products.form.price")} error={draftErrors.salePriceXof}>
              {(props) => <Input {...props} inputMode="numeric" pattern="[0-9]*" placeholder="0" className="numeric" value={draft.salePriceXof} onChange={(event) => set({ salePriceXof: event.target.value.replace(/\s/g, "") })} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("products.form.variant")} hint={t("products.form.variantHint")}>
                {(props) => <Input {...props} dir="auto" maxLength={100} value={draft.variantLabel} onChange={(event) => set({ variantLabel: event.target.value })} />}
              </Field>
              <Field label={t("products.form.sku")} hint={t("products.form.skuHint")}>
                {(props) => <Input {...props} dir="ltr" maxLength={100} autoComplete="off" value={draft.sku} onChange={(event) => set({ sku: event.target.value })} />}
              </Field>
            </div>
            {editing !== "new" && (
              <Field label={t("products.form.threshold")} hint={t("products.form.thresholdHint")} error={draftErrors.lowStockThreshold}>
                {(props) => <Input {...props} inputMode="decimal" className="numeric" value={draft.lowStockThreshold} onChange={(event) => set({ lowStockThreshold: event.target.value })} />}
              </Field>
            )}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{busy ? t("products.form.saving") : t(editing === "new" ? "products.form.submitAdd" : "products.form.submitEdit")}</Button>
            </div>
          </form>
        )}
      </FormDialog>

      <FormDialog open={categoryOpen} onClose={() => !busy && setCategoryOpen(false)} labelledBy="category-form-title" title={t("products.category.title")}>
        <form onSubmit={(event) => void saveCategory(event)} className="grid gap-4">
          <Field label={t("products.category.name")}>
            {(props) => <Input {...props} dir="auto" required maxLength={80} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />}
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setCategoryOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy} disabled={!categoryName.trim()}>{t("products.category.submit")}</Button>
          </div>
        </form>
      </FormDialog>

      <ConfirmDialog open={archiving !== null} busy={busy} tone="danger" onClose={() => !busy && setArchiving(null)} onConfirm={() => void archive()}
        title={t("products.archive.title")} confirmLabel={t("products.archive.confirm")}>
        {t("products.archive.body", { product: archiving?.name ?? "" })}
      </ConfirmDialog>
    </div>
  );
}
