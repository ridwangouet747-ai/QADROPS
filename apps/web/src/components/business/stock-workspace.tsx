"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SearchField, Segmented } from "@/components/ui/controls";
import { Monogram, StatCard } from "@/components/ui/data-display";
import { Alert, Badge, EmptyState, ProgressBar, Skeleton, type Tone } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, PageHeader } from "@/components/ui/layout";
import { errorMessageFor } from "@/lib/client/errors";
import { movementDirection, roundXof, signedMicros, stockStatus, type MovementDirection, type StockStatus } from "@/lib/client/stock";
import { formatDateTime, formatQuantity, formatXof } from "@/lib/i18n/format";
import { useDebounced, usePagedList, type RequestError } from "./use-paged-list";

type StockItem = { id: string; name: string; categoryId: string | null; categoryName: string | null; baseUnit: string; variantId: string; variantLabel: string; sku: string | null; onHand: string; averageCostXof: string; costKnown: boolean; lowStockThreshold: string };
type Movement = { id: string; variantId: string; product: string; variant: string | null; sku: string | null; unit: string; delta: string; reason: string; unitCostXof: string | null; occurredAt: string };
type View = "levels" | "movements";
const reasons = ["sale", "purchase", "inventory_adjustment", "manual_adjustment", "return", "opening_stock"] as const;
type Reason = (typeof reasons)[number];
const isReason = (value: string): value is Reason => (reasons as readonly string[]).includes(value);
const statusTone: Record<StockStatus, Tone> = { ok: "success", low: "warning", out: "danger" };
const reasonTone: Record<Reason, Tone> = { sale: "info", purchase: "success", inventory_adjustment: "brand", manual_adjustment: "warning", return: "neutral", opening_stock: "night" };
const showVariant = (label: string | null, unit?: string) => Boolean(label && label !== "Standard" && label.toLocaleLowerCase() !== unit?.toLocaleLowerCase());

/** Remplissage visuel de la jauge : stock rapporté à deux fois le seuil d'alerte (purement indicatif). */
function gaugeFor(onHand: string, threshold: string) {
  const quantity = signedMicros(onHand) ?? 0n;
  const limit = signedMicros(threshold) ?? 0n;
  if (limit <= 0n) return null;
  const ratio = quantity <= 0n ? 0n : (quantity * 100n) / (limit * 2n);
  return Number(ratio > 100n ? 100n : ratio);
}

export function StockWorkspace() {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>("levels");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | StockStatus>("all");
  const [categoryId, setCategoryId] = useState("");
  const [direction, setDirection] = useState<"all" | MovementDirection>("all");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useDebounced(query.trim());

  // Niveaux : même liste paginée et filtrée par le serveur que l'écran Produits.
  const levels = usePagedList<StockItem, { total: number; ok: number; low: number; out: number }>("/api/business/products", {
    limit: "30", q: view === "levels" ? q : "", categoryId, status: status === "all" ? "" : status });
  // Mouvements : historique complet par curseur, du plus récent au plus ancien.
  const movements = usePagedList<Movement, { total: number; in: number; out: number }>("/api/business/stock/movements", {
    limit: "30", q: view === "movements" ? q : "", reason, direction: direction === "all" ? "" : direction, from, to });

  const describe = (error: RequestError | null, fallback: string) => error ? (error.status !== null ? errorMessageFor({ status: error.status, serverMessage: error.message, locale, t }) : fallback) : "";
  const errorText = describe(levels.error, t("stock.loadFailed")) || describe(movements.error, t("stock.loadFailed"));
  const categories = (levels.body?.categories as { id: string; name: string }[] | undefined) ?? [];
  const levelCounts = { all: levels.summary?.total ?? 0, ok: levels.summary?.ok ?? 0, low: levels.summary?.low ?? 0, out: levels.summary?.out ?? 0 };
  const movementCounts = { all: movements.summary?.total ?? 0, in: movements.summary?.in ?? 0, out: movements.summary?.out ?? 0 };
  const money = (value: string | null) => formatXof(value, locale);
  const loaded = levels.summary !== null;

  return (
    <div>
      <PageHeader title={t("stock.title")} actions={<>
        <Link href="/business/opening" className={buttonClasses({ variant: "secondary", className: "no-underline" })}><Icon name="box" className="size-4" />{t("stock.openingLink")}</Link>
        <Link href="/business/purchases" className={buttonClasses({ variant: "secondary", className: "no-underline" })}><Icon name="download" className="size-4" />{t("stock.receivePurchase")}</Link>
        <Link href="/business/inventory" className={buttonClasses({ variant: "primary", className: "no-underline" })}><Icon name="clipboard" />{t("stock.startInventory")}</Link>
      </>}>{t("stock.intro")}</PageHeader>

      {errorText && <Alert tone="danger" className="mb-4">{errorText}</Alert>}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label={t("stock.title")}>
        <StatCard label={t("stock.stats.references")} icon="box" value={loaded ? String(levelCounts.all) : "—"} hint={t("stock.stats.referencesHint")} />
        <StatCard label={t("stock.stats.low")} icon="warning" iconTone="warn" value={loaded ? String(levelCounts.low) : "—"} hint={t("stock.stats.lowHint")} />
        <StatCard label={t("stock.stats.out")} icon="error" iconTone="danger" value={loaded ? String(levelCounts.out) : "—"} hint={t("stock.stats.outHint")} />
        <Card tone="brand" className="flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <h3 className="m-0 text-[0.86rem] font-semibold text-white/90">{t("stock.stats.recent")}</h3>
            <span className="grid size-8 place-items-center rounded-full bg-white/20"><Icon name="chart" className="size-4" /></span>
          </div>
          <p className="numeric m-0 mt-2 text-start text-[1.6rem] font-bold sm:text-[1.85rem] rtl:text-end">{movements.summary ? movementCounts.all : "—"}</p>
          <p className="m-0 mt-1 text-[0.8rem] text-white/80">{t("stock.stats.recentHint", { in: movementCounts.in, out: movementCounts.out })}</p>
        </Card>
      </section>

      <Card className="mt-4 grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<View> label={t("stock.tabs.label")} value={view} onChange={setView}
            options={[{ value: "levels", label: t("stock.tabs.levels"), count: levelCounts.all }, { value: "movements", label: t("stock.tabs.movements"), count: movementCounts.all }]} />
          {view === "movements" && <p className="m-0 max-w-xl text-xs text-fg-subtle">{t("stock.movements.scope", { count: movementCounts.all })}</p>}
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
          <SearchField value={query} onChange={setQuery} label={t("stock.levels.search")} placeholder={t("stock.levels.searchPlaceholder")} />
          {view === "levels" ? (
            <Select aria-label={t("stock.levels.category")} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">{t("stock.levels.allCategories")}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          ) : (
            <Select aria-label={t("stock.movements.reasonFilter")} value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">{t("stock.movements.allReasons")}</option>
              {reasons.map((value) => <option key={value} value={value}>{t(`stock.movements.reasons.${value}`)}</option>)}
            </Select>
          )}
        </div>
        {view === "levels" ? (
          <Segmented<"all" | StockStatus> label={t("stock.levels.status")} value={status} onChange={setStatus}
            options={(["all", "ok", "low", "out"] as const).map((value) => ({ value, label: value === "all" ? t("stock.levels.all") : t(`products.status.${value}`), count: levelCounts[value] }))} />
        ) : (
          <div className="grid gap-3 md:grid-cols-[auto_1fr] md:items-end">
            <Segmented<"all" | MovementDirection> label={t("stock.movements.direction")} value={direction} onChange={setDirection}
              options={(["all", "in", "out"] as const).map((value) => ({ value, label: t(`stock.movements.${value}`), count: movementCounts[value] }))} />
            <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0 md:max-w-sm md:justify-self-end">
              <legend className="sr-only">{t("stock.movements.period")}</legend>
              <Field label={t("stock.movements.from")}>{(props) => <Input {...props} type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />}</Field>
              <Field label={t("stock.movements.to")}>{(props) => <Input {...props} type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />}</Field>
            </fieldset>
          </div>
        )}
      </Card>

      {view === "levels" ? (
        <Card className="mt-4 p-2 sm:p-3">
          {levels.loading && levels.items.length === 0 ? (
            <div className="grid gap-2 p-1">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-24 rounded-lg" />)}</div>
          ) : levels.items.length === 0 ? (
            <div className="p-2">{levelCounts.all === 0 && !q && !categoryId && status === "all"
              ? <EmptyState icon="box" title={t("stock.levels.empty")} action={<Link href="/business/products" className={buttonClasses({ className: "no-underline" })}>{t("products.add")}</Link>}>{t("stock.levels.emptyHint")}</EmptyState>
              : <EmptyState icon="search" title={t("stock.levels.noMatch")} />}</div>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {levels.items.map((item) => {
                const rowStatus = stockStatus(item.onHand, item.lowStockThreshold);
                const gauge = gaugeFor(item.onHand, item.lowStockThreshold);
                const cost = item.costKnown ? roundXof(item.averageCostXof) : null;
                return (
                  <li key={item.variantId} className={cn("grid gap-3 rounded-[18px] border bg-surface p-3.5", rowStatus === "out" ? "border-danger-line" : rowStatus === "low" ? "border-warn-line" : "border-line")}>
                    <div className="flex items-start gap-3">
                      <Monogram text={item.name} className="size-10 rounded-[13px]" />
                      <div className="min-w-0 flex-1">
                        <strong dir="auto" className="block truncate text-[0.93rem] text-ink">{item.name}</strong>
                        <small className="block truncate text-xs text-fg-subtle">
                          {showVariant(item.variantLabel, item.baseUnit) && <span dir="auto">{item.variantLabel} · </span>}
                          {item.sku ? <span dir="ltr" className="font-mono">{item.sku}</span> : <span dir="auto">{item.categoryName ?? ""}</span>}
                        </small>
                      </div>
                      <Badge tone={statusTone[rowStatus]}>{t(`products.status.${rowStatus}`)}</Badge>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="m-0 text-xs text-fg-subtle">{t("stock.levels.onHand")}</p>
                        <p className="m-0 text-xl font-bold text-ink"><span className="numeric">{formatQuantity(item.onHand, locale)}</span> <span className="text-sm font-medium text-fg-subtle">{item.baseUnit}</span></p>
                      </div>
                      <p className="m-0 text-end text-xs text-fg-subtle">{(signedMicros(item.lowStockThreshold) ?? 0n) > 0n ? t("stock.levels.threshold", { qty: formatQuantity(item.lowStockThreshold, locale) }) : t("stock.levels.noThreshold")}</p>
                    </div>
                    {gauge !== null && <ProgressBar value={gauge} max={100} label={t("stock.levels.threshold", { qty: formatQuantity(item.lowStockThreshold, locale) })} />}
                    {cost && cost !== "0" && <p className="m-0 border-t border-line pt-2 text-xs text-fg-subtle">{t("stock.levels.avgCost", { amount: money(cost) })}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {levels.nextCursor && <div className="p-2"><Button variant="secondary" block loading={levels.loadingMore} onClick={() => void levels.loadMore()}>{t("common.loadMore")}</Button></div>}
        </Card>
      ) : (
        /* Historique dans un panneau bleu nuit, comme la liste de la référence. */
        <Card tone="night" className="mt-4 p-2 sm:p-3" aria-label={t("stock.movements.title")}>
          <h2 className="m-0 px-2 pt-2 pb-3 text-[1.05rem] font-bold">{t("stock.movements.title")}</h2>
          {movements.loading && movements.items.length === 0 ? (
            <div className="grid gap-1.5">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 rounded-[16px] bg-night-soft" />)}</div>
          ) : movements.items.length === 0 ? (
            <p className="m-0 rounded-lg bg-night-soft p-5 text-center text-sm text-night-fg">{movementCounts.all === 0 && !q && !reason && direction === "all" && !from && !to ? t("stock.movements.empty") : t("stock.movements.noMatch")}</p>
          ) : (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {movements.items.map((movement) => {
                const rowDirection = movementDirection(movement.delta);
                const known = isReason(movement.reason);
                const cost = roundXof(movement.unitCostXof);
                const magnitude = movement.delta.startsWith("-") ? movement.delta.slice(1) : movement.delta;
                return (
                  <li key={movement.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[16px] bg-night-soft/70 p-3">
                    <span className={cn("grid size-10 place-items-center rounded-full", rowDirection === "in" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger")}>
                      <Icon name={rowDirection === "in" ? "arrowDown" : "arrowUp"} className="size-5" />
                      <span className="sr-only">{t(`stock.movements.${rowDirection}`)}</span>
                    </span>
                    <div className="min-w-0">
                      <strong dir="auto" className="block truncate text-sm text-white">{movement.product}{showVariant(movement.variant, movement.unit) ? ` · ${movement.variant}` : ""}</strong>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-night-fg">
                        <Badge tone={known ? reasonTone[movement.reason as Reason] : "neutral"} className={movement.reason === "opening_stock" ? "border-brand-tint" : undefined}>{t(known ? `stock.movements.reasons.${movement.reason as Reason}` : "stock.movements.reasons.unknown")}</Badge>
                        <time dateTime={movement.occurredAt}>{formatDateTime(movement.occurredAt, locale)}</time>
                        {cost && cost !== "0" && <span>{t("stock.movements.unitCost", { amount: money(cost) })}</span>}
                      </div>
                    </div>
                    <strong className={cn("numeric text-end text-base", rowDirection === "in" ? "text-ok-line" : "text-danger-line")}>
                      {rowDirection === "in" ? "+" : "−"}{formatQuantity(magnitude, locale)}
                    </strong>
                  </li>
                );
              })}
            </ul>
          )}
          {movements.nextCursor && <div className="p-2"><button type="button" disabled={movements.loadingMore} onClick={() => void movements.loadMore()} className="min-h-11 w-full cursor-pointer rounded-full border border-night-line bg-transparent text-sm font-semibold text-white hover:bg-night-soft disabled:opacity-60">{t("common.loadMore")}</button></div>}
        </Card>
      )}
    </div>
  );
}
