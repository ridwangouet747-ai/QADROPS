"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, FormDialog, SearchField, Segmented } from "@/components/ui/controls";
import { Monogram } from "@/components/ui/data-display";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, CardTitle, PageHeader } from "@/components/ui/layout";
import { QuantityInput } from "@/components/ui/quantity-input";
import { errorMessageFor } from "@/lib/client/errors";
import { parseQuantityInput, toApiQuantity } from "@/lib/client/quantity";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatXof } from "@/lib/i18n/format";
import type { Translate } from "@/lib/i18n/translate";
import { RequestError, useDebounced, usePagedList } from "./use-paged-list";

type Tab = "stock" | "customers" | "suppliers";
type Candidate = { variantId: string; name: string; variantLabel: string; sku: string | null; baseUnit: string };
type DraftLine = Candidate & { quantity: string; unitCost: string };
type Party = { partyId: string; name: string; phone: string | null; balanceId: string | null; amountXof: string | null; paidXof: string | null; remainingXof: string | null; asOfDate: string | null; note: string | null };
const methods = ["cash", "wave", "orange_money", "mtn_momo", "other"] as const;
type Method = (typeof methods)[number];

const today = () => new Date().toISOString().slice(0, 10);
const newKey = () => `opening-${crypto.randomUUID()}`;
const wholeXof = (value: string) => /^[1-9]\d{0,17}$/.test(value.trim());
const formatDay = (value: string, locale: Locale) => new Date(`${value}T12:00:00Z`).toLocaleDateString(intlLocale[locale], { dateStyle: "medium", timeZone: "UTC" });

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); } catch { throw new RequestError(null); }
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new RequestError(response.status, payload.error);
  return payload;
}

export function OpeningWorkspace() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("stock");
  const describe = useCallback((caught: unknown) => caught instanceof RequestError
    ? errorMessageFor({ status: caught.status, serverMessage: caught.message, locale, t }) : t("errors.generic"), [locale, t]);
  return (
    <div>
      <PageHeader title={t("opening.title")}>{t("opening.intro")}</PageHeader>
      <div className="mb-4">
        <Segmented<Tab> label={t("opening.tabs.label")} value={tab} onChange={setTab}
          options={(["stock", "customers", "suppliers"] as const).map((value) => ({ value, label: t(`opening.tabs.${value}`) }))} />
      </div>
      {tab === "stock" ? <StockOpening describe={describe} /> : <BalancesPanel key={tab} partyType={tab === "customers" ? "customer" : "supplier"} describe={describe} />}
    </div>
  );
}

function StockOpening({ describe }: { describe: (caught: unknown) => string }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const candidates = usePagedList<Candidate, never>("/api/business/stock/opening", { limit: "20", q });
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [referenceDate, setReferenceDate] = useState(today());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Même saisie = même clé : un double envoi (réseau lent, double appui) ne crée rien deux fois.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const openedCount = Number(candidates.body?.openedCount ?? 0);
  const recent = (candidates.body?.recentOpenings as { id: string; referenceDate: string; lineCount: number }[] | undefined) ?? [];
  const inDraft = useMemo(() => new Set(draft.map((line) => line.variantId)), [draft]);
  const update = (variantId: string, patch: Partial<DraftLine>) => setDraft((current) => current.map((line) => line.variantId === variantId ? { ...line, ...patch } : line));

  const review = () => {
    const found: Record<string, string> = {};
    for (const line of draft) {
      if (!parseQuantityInput(line.quantity)) found[`${line.variantId}:qty`] = t("opening.stock.invalidQty", { product: line.name });
      if (line.unitCost.trim() && !/^(0|[1-9]\d{0,17})$/.test(line.unitCost.trim())) found[`${line.variantId}:cost`] = t("opening.stock.invalidCost", { product: line.name });
    }
    if (!referenceDate || referenceDate > today()) found.date = t("opening.stock.invalidDate");
    setErrors(found);
    if (!Object.keys(found).length) setConfirming(true);
  };

  const submit = async () => {
    const body = { referenceDate, note: note.trim() || undefined,
      lines: draft.map((line) => ({ variantId: line.variantId, quantity: toApiQuantity(line.quantity), ...(line.unitCost.trim() ? { unitCostXof: line.unitCost.trim() } : {}) })) };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newKey() };
    setBusy(true); setError(""); setNotice("");
    try {
      await postJson("/api/business/stock/opening", { ...body, idempotencyKey: attempt.current.key });
      setNotice(t("opening.stock.saved", { count: draft.length }));
      setDraft([]); setNote(""); attempt.current = null;
      await candidates.reload();
    } catch (caught) { setError(describe(caught)); }
    finally { setBusy(false); setConfirming(false); }
  };

  const listError = candidates.error ? describe(candidates.error) : "";
  return (
    <>
      <div className="mb-3 grid gap-2 empty:hidden" aria-live="polite">
        {(error || listError) && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error || listError}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <Card className="grid min-w-0 grid-cols-1 gap-3" aria-labelledby="opening-candidates-title">
          <CardTitle id="opening-candidates-title" title={t("opening.stock.title")} aside={<Badge tone="brand">{t("opening.stock.opened", { count: openedCount })}</Badge>} />
          <p className="m-0 -mt-2 text-sm text-fg-muted">{t("opening.stock.hint")}</p>
          <SearchField value={query} onChange={setQuery} label={t("opening.stock.searchLabel")} placeholder={t("opening.stock.searchPlaceholder")} />
          {candidates.loading && candidates.items.length === 0 ? (
            <div className="grid gap-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 rounded-lg" />)}</div>
          ) : candidates.items.length === 0 ? (
            q ? <EmptyState icon="search" title={t("opening.stock.noMatch")} /> : <EmptyState icon="success" title={t("opening.stock.noCandidates")}>{t("opening.stock.noCandidatesHint")}</EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {candidates.items.map((item) => {
                const added = inDraft.has(item.variantId);
                return (
                  <li key={item.variantId} className="flex items-center gap-3 rounded-[16px] border border-line p-2.5">
                    <Monogram text={item.name} className="size-10 rounded-[13px]" />
                    <div className="min-w-0 flex-1">
                      <strong dir="auto" className="block truncate text-sm text-ink">{item.name}</strong>
                      <small className="block truncate text-xs text-fg-subtle">{item.sku ? <span dir="ltr" className="font-mono">{item.sku}</span> : <span dir="auto">{item.baseUnit}</span>}</small>
                    </div>
                    <Button variant={added ? "secondary" : "primary"} disabled={added} onClick={() => setDraft((current) => [...current, { ...item, quantity: "", unitCost: "" }])}
                      aria-label={t("opening.stock.add", { product: item.name })} icon={<Icon name={added ? "check" : "plus"} className="size-4" />}>
                      {added ? t("opening.stock.added") : t("opening.stock.addShort")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {candidates.nextCursor && <Button variant="secondary" block loading={candidates.loadingMore} onClick={() => void candidates.loadMore()}>{t("common.loadMore")}</Button>}
          {recent.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="m-0 mb-2 text-xs font-semibold text-fg-muted">{t("opening.stock.recent")}</p>
              <ul className="m-0 grid list-none gap-1 p-0 text-sm text-fg">
                {recent.map((row) => <li key={row.id} className="flex items-center gap-2"><Icon name="success" className="size-4 text-ok" />{t("opening.stock.recentLine", { date: formatDay(row.referenceDate, locale), count: row.lineCount })}</li>)}
              </ul>
            </div>
          )}
        </Card>

        <Card className="grid min-w-0 grid-cols-1 gap-4 lg:sticky lg:top-[92px]" aria-labelledby="opening-draft-title">
          <CardTitle id="opening-draft-title" title={t("opening.stock.draftTitle")} aside={<Badge tone={draft.length ? "brand" : "neutral"}>{t("opening.stock.draftCount", { count: draft.length })}</Badge>} />
          {draft.length === 0 ? <EmptyState icon="box" title={t("opening.stock.draftEmpty")} /> : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {draft.map((line) => (
                <li key={line.variantId} className="grid gap-2.5 rounded-[16px] border border-line bg-paper p-3">
                  <div className="flex items-start justify-between gap-2">
                    <strong dir="auto" className="min-w-0 truncate text-sm text-ink">{line.name}</strong>
                    <button type="button" onClick={() => setDraft((current) => current.filter((row) => row.variantId !== line.variantId))} aria-label={t("opening.stock.remove", { product: line.name })}
                      className="-me-1 -mt-1 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-subtle hover:bg-danger-soft hover:text-danger"><Icon name="close" className="size-4" /></button>
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor={`opening-qty-${line.variantId}`} className="text-sm font-semibold text-ink">{t("opening.stock.quantity")}</label>
                    <QuantityInput id={`opening-qty-${line.variantId}`} value={line.quantity} unit={line.baseUnit} invalid={Boolean(errors[`${line.variantId}:qty`])}
                      onChange={(value) => update(line.variantId, { quantity: value })} ariaLabel={`${t("opening.stock.quantity")} — ${line.name}`} />
                    {errors[`${line.variantId}:qty`] && <p className="m-0 text-sm font-medium text-danger">{errors[`${line.variantId}:qty`]}</p>}
                  </div>
                  <Field label={t("opening.stock.cost")} hint={t("opening.stock.costHint")} error={errors[`${line.variantId}:cost`]}>
                    {(props) => <Input {...props} inputMode="numeric" pattern="[0-9]*" className="numeric" placeholder="—" value={line.unitCost} onChange={(event) => update(line.variantId, { unitCost: event.target.value.replace(/\s/g, "") })} />}
                  </Field>
                </li>
              ))}
            </ul>
          )}
          <Field label={t("opening.stock.date")} hint={t("opening.stock.dateHint")} error={errors.date}>
            {(props) => <Input {...props} type="date" max={today()} value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} />}
          </Field>
          <Field label={t("opening.stock.note")}>
            {(props) => <Textarea {...props} dir="auto" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}
          </Field>
          <Button size="lg" block disabled={!draft.length || busy} onClick={review} icon={<Icon name="check" />}>{t("opening.stock.review")}</Button>
        </Card>
      </div>
      <ConfirmDialog open={confirming} busy={busy} onClose={() => !busy && setConfirming(false)} onConfirm={() => void submit()}
        title={t("opening.stock.confirmTitle")} confirmLabel={t("opening.stock.confirm")}>
        {t("opening.stock.confirmBody", { count: draft.length, date: referenceDate ? formatDay(referenceDate, locale) : "" })}
      </ConfirmDialog>
    </>
  );
}

function BalancesPanel({ partyType, describe }: { partyType: "customer" | "supplier"; describe: (caught: unknown) => string }) {
  const { t, locale } = useI18n();
  const isCustomer = partyType === "customer";
  const [parties, setParties] = useState<Party[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Party | null>(null);
  const [paying, setPaying] = useState<Party | null>(null);
  const [form, setForm] = useState({ amount: "", date: today(), note: "", method: "cash" as Method });
  const [formError, setFormError] = useState("");
  const key = useRef("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/business/opening-balances?party=${partyType}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { parties?: Party[]; error?: string };
      if (!response.ok) throw new RequestError(response.status, body.error);
      setParties(body.parties ?? []);
    } catch (caught) { setParties([]); setError(describe(caught)); }
  }, [partyType, describe]);
  useEffect(() => { void load(); }, [load]);

  const visible = (parties ?? []).filter((party) => !query.trim() || party.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const totalRemaining = (parties ?? []).reduce((sum, party) => sum + BigInt(party.remainingXof ?? "0"), 0n);
  const money = (value: string | bigint | null) => formatXof(value, locale);
  const open = (party: Party, mode: "add" | "pay") => {
    key.current = newKey(); setFormError("");
    setForm({ amount: "", date: today(), note: "", method: "cash" });
    if (mode === "add") setAdding(party); else setPaying(party);
  };

  const saveBalance = async (event: FormEvent) => {
    event.preventDefault();
    if (!adding) return;
    if (!wholeXof(form.amount)) { setFormError(t("opening.balances.amountInvalid")); return; }
    if (!form.date || form.date > today()) { setFormError(t("opening.stock.invalidDate")); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await postJson("/api/business/opening-balances", { idempotencyKey: key.current, partyType, partyId: adding.partyId, amountXof: form.amount.trim(), asOfDate: form.date, note: form.note.trim() || undefined });
      setNotice(t("opening.balances.saved", { name: adding.name })); setAdding(null);
      await load();
    } catch (caught) { setFormError(describe(caught)); }
    finally { setBusy(false); }
  };

  const savePayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!paying?.balanceId) return;
    if (!wholeXof(form.amount)) { setFormError(t("opening.balances.amountInvalid")); return; }
    if (BigInt(form.amount.trim()) > BigInt(paying.remainingXof ?? "0")) { setFormError(t("opening.balances.payTooMuch", { amount: money(paying.remainingXof) })); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await postJson<{ payment: { remainingXof: string } }>(`/api/business/opening-balances/${encodeURIComponent(paying.balanceId)}/payments`, { idempotencyKey: key.current, amountXof: form.amount.trim(), method: form.method });
      setNotice(t("opening.balances.paid", { amount: money(result.payment.remainingXof) })); setPaying(null);
      await load();
    } catch (caught) { setFormError(describe(caught)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="mb-3 grid gap-2 empty:hidden" aria-live="polite">
        {error && <Alert tone="danger" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice("")} dismissLabel={t("common.close")}>{notice}</Alert>}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="grid min-w-0 grid-cols-1 gap-3">
          <CardTitle title={t(isCustomer ? "opening.balances.customersTitle" : "opening.balances.suppliersTitle")} />
          <p className="m-0 -mt-2 text-sm text-fg-muted">{t(isCustomer ? "opening.balances.customersHint" : "opening.balances.suppliersHint")}</p>
          <SearchField value={query} onChange={setQuery} label={t("opening.balances.search")} placeholder={t("opening.balances.search")} />
          {parties === null ? (
            <div className="grid gap-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 rounded-lg" />)}</div>
          ) : parties.length === 0 ? (
            <EmptyState icon="users" title={t(isCustomer ? "opening.balances.emptyCustomers" : "opening.balances.emptySuppliers")}
              action={<Link href={isCustomer ? "/business/customers" : "/business/suppliers"} className={buttonClasses({ className: "no-underline" })}>{t(isCustomer ? "opening.balances.createCustomer" : "opening.balances.createSupplier")}</Link>} />
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {visible.map((party) => {
                const remaining = BigInt(party.remainingXof ?? "0");
                return (
                  <li key={party.partyId} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[16px] border border-line p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <Monogram text={party.name} />
                    <div className="min-w-0">
                      <strong dir="auto" className="block truncate text-sm text-ink">{party.name}</strong>
                      <small className="block text-xs text-fg-subtle">
                        {party.balanceId && party.amountXof && party.asOfDate ? t("opening.balances.initial", { amount: money(party.amountXof), date: formatDay(party.asOfDate, locale) }) : t("opening.balances.none")}
                      </small>
                    </div>
                    <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:col-span-1">
                      {party.balanceId && <Badge tone={remaining > 0n ? (isCustomer ? "warning" : "danger") : "success"}>{remaining > 0n ? t("opening.balances.owed", { amount: money(remaining) }) : t("opening.balances.settled")}</Badge>}
                      {!party.balanceId && <Button variant="secondary" onClick={() => open(party, "add")} icon={<Icon name="plus" className="size-4" />}>{t("opening.balances.add")}</Button>}
                      {party.balanceId && remaining > 0n && <Button onClick={() => open(party, "pay")} icon={<Icon name="wallet" className="size-4" />}>{t("opening.balances.pay")}</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card tone={isCustomer ? "brand" : "night"} className="flex flex-col gap-1">
          <p className="m-0 text-sm text-white/85">{t(isCustomer ? "opening.balances.totalCustomers" : "opening.balances.totalSuppliers")}</p>
          <p className="numeric m-0 text-start text-[1.8rem] font-bold tracking-[-0.03em] rtl:text-end">{parties ? money(totalRemaining) : "—"}</p>
          <p className="m-0 text-xs text-white/75">{t(isCustomer ? "opening.balances.customersHint" : "opening.balances.suppliersHint")}</p>
        </Card>
      </div>

      <FormDialog open={adding !== null} onClose={() => !busy && setAdding(null)} labelledBy="balance-form-title"
        title={adding ? t(isCustomer ? "opening.balances.formCustomerTitle" : "opening.balances.formSupplierTitle", { name: adding.name }) : ""}>
        <form noValidate onSubmit={(event) => void saveBalance(event)} className="grid gap-4">
          <Field label={t(isCustomer ? "opening.balances.amountCustomer" : "opening.balances.amountSupplier")} error={formError || undefined}>
            {(props) => <Input {...props} autoFocus inputMode="numeric" pattern="[0-9]*" className="numeric" placeholder="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/\s/g, "") })} />}
          </Field>
          <Field label={t("opening.balances.date")}>
            {(props) => <Input {...props} type="date" max={today()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />}
          </Field>
          <Field label={t("opening.balances.note")}>
            {(props) => <Textarea {...props} dir="auto" rows={2} maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />}
          </Field>
          <DialogActions t={t} busy={busy} onCancel={() => setAdding(null)} label={t("opening.balances.save")} />
        </form>
      </FormDialog>

      <FormDialog open={paying !== null} onClose={() => !busy && setPaying(null)} labelledBy="payment-form-title" title={paying ? t("opening.balances.payTitle", { name: paying.name }) : ""}>
        {paying && (
          <form noValidate onSubmit={(event) => void savePayment(event)} className="grid gap-4">
            <p className="m-0 rounded-[14px] bg-paper p-3 text-sm text-fg">{t("opening.balances.owed", { amount: money(paying.remainingXof) })}</p>
            <Field label={t("opening.balances.payAmount")} hint={t(isCustomer ? "opening.balances.payHintCustomer" : "opening.balances.payHintSupplier")} error={formError || undefined}>
              {(props) => <Input {...props} autoFocus inputMode="numeric" pattern="[0-9]*" className="numeric" placeholder="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/\s/g, "") })} />}
            </Field>
            <div role="radiogroup" aria-label={t("opening.balances.method")} className="flex flex-wrap gap-1.5">
              {methods.map((method) => (
                <button key={method} type="button" role="radio" aria-checked={form.method === method} onClick={() => setForm({ ...form, method })}
                  className={cn("min-h-11 cursor-pointer rounded-full border px-3.5 text-sm font-semibold", form.method === method ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface text-fg-muted hover:border-brand-tint")}>
                  {t(`pos.methods.${method}`)}
                </button>
              ))}
            </div>
            <DialogActions t={t} busy={busy} onCancel={() => setPaying(null)} label={t("opening.balances.paySave")} />
          </form>
        )}
      </FormDialog>
    </>
  );
}

function DialogActions({ t, busy, onCancel, label }: { t: Translate; busy: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
      <Button type="submit" loading={busy}>{label}</Button>
    </div>
  );
}
