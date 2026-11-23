"use client";

import { Children, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { operationKeyFor, type OperationAttempt } from "@/lib/client/operation-key";
import { errorMessageFor } from "@/lib/client/errors";
import { formatDateTime, formatXof } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useBusinessTimeZone } from "@/components/business/business-time-zone";
import { useBusinessRole, type BusinessArea } from "./business-shell";
import { RecoveryCodeCard } from "@/components/auth/recovery-code-card";
import { BusinessLogo } from "./business-identity";
import { downscaleLogo } from "@/components/auth/account-screens";

type Row = Record<string, unknown>;
type Payload = Row & { error?: string };
type ProductRow = { id: string; name: string; description: string | null; categoryId: string | null; categoryName: string | null; baseUnit: string; variantId: string; variantLabel: string; sku: string | null; salePriceXof: string; onHand: string; averageCostXof: string; costKnown: boolean; lowStockThreshold: string };
type CustomerRow = { id: string; name: string; phone: string | null; saleCount: string; balanceXof: string };
type SupplierRow = { id: string; name: string; phone: string | null; purchaseCount: string; purchaseTotalXof: string };
type Settings = { name: string; logo: string | null; phone: string | null; address: string | null; email: string | null; primaryColor: string; paperWidthMm: number; showLogo: boolean; receiptFooter: string | null; role?: string };
type SupplierOption = { id: string; name: string };
type Section = Exclude<BusinessArea, "dashboard" | "pos" | "products" | "stock" | "inventory" | "reports">;

const paths: Record<string, string> = { sales: "/api/business/sales", customers: "/api/business/customers", suppliers: "/api/business/suppliers", purchases: "/api/business/purchases", expenses: "/api/business/expenses", settings: "/api/business/settings" };
/**
 * Listes chargées par pages `{ items, nextCursor }` (phase 6). Les journaux (ventes, achats, dépenses) sont triés du plus
 * récent au plus ancien ; clients et fournisseurs par nom. Sans `limit`, l'API garde sa réponse historique (caisse, achats).
 */
const pagedSections = new Set(["customers", "suppliers", "sales", "purchases", "expenses"]);
const PAGE_SIZE = 50;
const headingKeys = ["sales", "customers", "suppliers", "purchases", "expenses", "settings", "modules"] as const;
type HeadingKey = (typeof headingKeys)[number];
const isHeadingKey = (value: string): value is HeadingKey => (headingKeys as readonly string[]).includes(value);

const moduleKeys = ["dashboard", "pos", "products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "expenses", "reports", "opening", "settings", "imports", "install"] as const;
type ModuleKey = (typeof moduleKeys)[number];
const modulePermissions: Record<string, readonly ModuleKey[]> = {
  owner: moduleKeys, admin: moduleKeys,
  stock_manager: ["dashboard", "products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "reports", "opening", "imports", "install"],
  accountant: ["dashboard", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "expenses", "reports", "install"],
  cashier: ["pos", "products", "sales", "customers", "stock", "install"],
  member: ["products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "install"],
};

const expenseCategories = ["transport", "rent", "utilities", "supplies", "other"] as const;
/** Jour civil UTC (Abidjan) : une dette de départ ne peut pas être datée dans le futur (même règle que le serveur). */
const todayUtc = () => new Date().toISOString().slice(0, 10);
const emptyCustomerDraft = () => ({ name: "", phone: "", hasDebt: false, debtXof: "", debtDate: todayUtc(), debtNote: "" });
const isExpenseCategory = (value: string): value is (typeof expenseCategories)[number] => (expenseCategories as readonly string[]).includes(value);

/** Réponse HTTP en erreur : le statut permet d'afficher un message traduit plutôt que la phrase française du serveur. */
class HttpError extends Error {
  constructor(public status: number, message?: string) { super(message); }
}

async function readJson(response: Response) {
  return await response.json().catch(() => ({})) as Payload & { items?: Row[]; nextCursor?: string | null };
}

function PageHeading({ section, action }: { section: Section; action?: ReactNode }) {
  const { t } = useI18n();
  const key: HeadingKey = isHeadingKey(section) ? section : "modules";
  return <div className="business-heading"><div><p className="business-kicker">{t(`suite.headings.${key}.kicker`)}</p><h1>{t(`suite.headings.${key}.title`)}</h1><p>{t(`suite.headings.${key}.description`)}</p></div>{action}</div>;
}

function Panel({ title, detail, action, children, className = "" }: { title: string; detail?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel suite-panel ${className}`}><header className="suite-panel-head"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>{children}</section>;
}

function DataTable({ columns, children, empty }: { columns: string[]; children: ReactNode; empty: string }) {
  const hasRows = Children.count(children) > 0;
  return <div className="suite-table-scroll"><table className="suite-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody>{!hasRows && <tfoot><tr><td colSpan={columns.length}>{empty}</td></tr></tfoot>}</table></div>;
}

/** Téléphone, référence : toujours lus de gauche à droite, même au milieu d'une page arabe. */
const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

export function BusinessSuiteWorkspace({ section }: { section: Section }) {
  const role = useBusinessRole();
  const { t, locale } = useI18n();
  const timeZone = useBusinessTimeZone();
  const canManageCustomers = ["owner", "admin", "cashier"].includes(role);
  // Une dette de départ modifie la situation du client : droit « customer:update » (propriétaire, administrateur).
  const canRecordCustomerDebt = ["owner", "admin"].includes(role);
  const canManageSuppliers = ["owner", "admin", "stock_manager"].includes(role);
  const canManageExpenses = ["owner", "admin", "accountant"].includes(role);
  const canManageSettings = ["owner", "admin"].includes(role);
  const endpoint = paths[section];
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef<OperationAttempt>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [customerDraft, setCustomerDraft] = useState(emptyCustomerDraft);
  const [customerError, setCustomerError] = useState("");
  const [supplierDraft, setSupplierDraft] = useState({ name: "", phone: "" });
  const [expenseDraft, setExpenseDraft] = useState({ category: "transport", description: "", amountXof: "", paymentMethod: "cash" });
  const [purchaseDraft, setPurchaseDraft] = useState({ supplierId: "", variantId: "", quantity: "1", unitCostXof: "", reference: `ACH-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-01`, paidXof: "0", paymentMethod: "cash" });
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [productOptions, setProductOptions] = useState<ProductRow[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedMore, setLoadedMore] = useState(false);
  /** Incrémenté à chaque rechargement : une page « suite » arrivée après un rechargement est ignorée (ni doublon ni mélange). */
  const generation = useRef(0);
  const paged = pagedSections.has(section);

  const money = (value: unknown) => formatXof(value === null || value === undefined ? null : String(value), locale);
  const when = (value: unknown) => {
    if (!value) return "—";
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? "—" : formatDateTime(date, locale, timeZone);
  };
  const messageFor = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof HttpError) return errorMessageFor({ status: caught.status, serverMessage: caught.message || undefined, locale, t });
    if (caught instanceof TypeError) return errorMessageFor({ status: null, locale, t });
    return fallback;
  }, [locale, t]);

  const fetchPage = useCallback(async (cursor: string | null) => {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`${endpoint}?${query}`, { cache: "no-store" });
    const result = await readJson(response);
    if (!response.ok) throw new HttpError(response.status, result.error);
    return { items: result.items ?? [], nextCursor: result.nextCursor ?? null };
  }, [endpoint]);

  const reload = useCallback(async () => {
    if (!endpoint) return;
    const current = ++generation.current;
    setError("");
    try {
      if (paged) {
        // Premier affichage ou après une écriture : on repart de la première page, la nouvelle ligne y apparaît à sa place.
        const page = await fetchPage(null);
        if (current !== generation.current) return;
        setData({ [section]: page.items });
        setNextCursor(page.nextCursor);
        setLoadedMore(false);
        return;
      }
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = await readJson(response);
      if (!response.ok) throw new HttpError(response.status, result.error);
      if (current !== generation.current) return;
      setData(result);
      if (section === "settings" && result.settings) setSettingsDraft(result.settings as unknown as Settings);
    } catch (caught) {
      // Les lignes déjà affichées restent en place : seul le message d'erreur s'ajoute.
      if (current === generation.current) setError(messageFor(caught, t("suite.loadFailed")));
    }
  }, [endpoint, section, paged, fetchPage, messageFor, t]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true); setError("");
    try {
      const page = await fetchPage(nextCursor);
      if (current !== generation.current) return;
      setData((existing) => ({ ...existing, [section]: [...((existing?.[section] as Row[] | undefined) ?? []), ...page.items] }));
      setNextCursor(page.nextCursor);
      setLoadedMore(true);
    } catch (caught) { if (current === generation.current) setError(messageFor(caught, t("suite.loadFailed"))); }
    finally { setLoadingMore(false); }
  }

  const listFooter = paged && nextCursor
    ? <div className="pt-3"><button type="button" className="business-secondary w-full" onClick={() => void loadMore()} disabled={loadingMore} aria-busy={loadingMore}>{loadingMore ? t("common.loading") : t("common.loadMore")}</button></div>
    : paged && loadedMore ? <p className="m-0 pt-3 text-center text-xs text-fg-subtle" role="status">{t("suite.endOfList")}</p> : null;
  const emptyText = (empty: string) => data ? empty : error ? "—" : t("common.loading");

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (section !== "purchases") return;
    let active = true;
    // Le formulaire de réception a besoin du catalogue et des fournisseurs complets : réponses historiques, sans `limit`.
    void Promise.all([fetch("/api/business/products", { cache: "no-store" }), fetch("/api/business/suppliers", { cache: "no-store" })]).then(async ([productsResponse, suppliersResponse]) => {
      const [result, supplierResult] = await Promise.all([readJson(productsResponse), readJson(suppliersResponse)]);
      if (active && Array.isArray(result.products)) {
        setProductOptions(result.products as ProductRow[]);
        setPurchaseDraft((current) => ({ ...current, variantId: current.variantId || String((result.products as ProductRow[])[0]?.variantId ?? "") }));
      }
      if (active && Array.isArray(supplierResult.suppliers)) {
        setSupplierOptions(supplierResult.suppliers as SupplierOption[]);
        setPurchaseDraft((current) => ({ ...current, supplierId: current.supplierId || String((supplierResult.suppliers as SupplierOption[])[0]?.id ?? "") }));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [section]);

  async function submit(event: FormEvent<HTMLFormElement>, url: string, method: string, body: Record<string, unknown>, success: string, idempotent = false) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = idempotent ? { ...body, idempotencyKey: operationKeyFor(attemptRef, { url, body }) } : body;
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await readJson(response);
      if (!response.ok) throw new HttpError(response.status, result.error);
      if (idempotent) attemptRef.current = null;
      setNotice(success); await reload();
      // L’en-tête relit le nom et le logo du commerce (BusinessShell écoute cet évènement).
      if (url === "/api/business/settings") window.dispatchEvent(new Event("qadr:business-updated"));
      if (section === "customers") setCustomerDraft(emptyCustomerDraft());
      if (section === "suppliers") setSupplierDraft({ name: "", phone: "" });
      if (section === "expenses") setExpenseDraft({ category: "transport", description: "", amountXof: "", paymentMethod: "cash" });
      if (section === "purchases") setPurchaseDraft((current) => ({ ...current, reference: `ACH-${Date.now().toString().slice(-8)}`, quantity: "1", unitCostXof: "", paidXof: "0" }));
    } catch (caught) {
      // Sans réponse, l'écriture n'est ni réussie ni échouée de façon certaine : la clé d'idempotence est conservée pour réessayer.
      setError(caught instanceof TypeError ? t("pwa.network.requestFailed") : messageFor(caught, t("common.genericError")));
    }
    finally { setBusy(false); }
  }

  /** Client sans dette : création simple. Avec dette de départ : fiche et solde d'ouverture en une seule écriture idempotente. */
  function submitCustomer(event: FormEvent<HTMLFormElement>) {
    setCustomerError("");
    const base = { name: customerDraft.name, phone: customerDraft.phone };
    if (!canRecordCustomerDebt || !customerDraft.hasDebt) { void submit(event, "/api/business/customers", "POST", base, t("suite.customers.added")); return; }
    const amount = customerDraft.debtXof.trim();
    if (!/^[1-9]\d{0,17}$/.test(amount)) { event.preventDefault(); setCustomerError(t("suite.customers.debtAmountInvalid")); return; }
    if (!customerDraft.debtDate || customerDraft.debtDate > todayUtc()) { event.preventDefault(); setCustomerError(t("suite.customers.debtDateInvalid")); return; }
    void submit(event, "/api/business/customers", "POST", { ...base, openingBalance: { amountXof: amount, asOfDate: customerDraft.debtDate, note: customerDraft.debtNote.trim() || undefined } },
      t("suite.customers.addedWithDebt", { amount: money(amount) }), true);
  }

  const alerts = <>{error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}</>;

  if (section === "modules") {
    const allowed = modulePermissions[role] ?? modulePermissions.member;
    return <><PageHeading section={section} /><div className="suite-module-grid">{moduleKeys.filter((key) => allowed.includes(key)).map((key, index) => <Link className="suite-module-link" href={`/business/${key}`} key={key}><span className="suite-module-index">{String(index + 1).padStart(2, "0")}</span><strong>{t(`suite.modules.${key}.label`)}</strong><span>{t(`suite.modules.${key}.detail`)}</span><b aria-hidden="true" className="inline-block rtl:-scale-x-100">↗</b></Link>)}</div></>;
  }

  if (section === "sales") {
    const rows = (data?.sales as Row[] | undefined) ?? [];
    const columns = (["reference", "customer", "date", "total", "confirmed", "due", "receipt"] as const).map((key) => t(`suite.sales.columns.${key}`));
    return <><PageHeading section={section} action={<Link className="business-primary suite-primary-link" href="/business/pos">{t("suite.sales.newSale")}</Link>} />{alerts}
      <Panel title={t("suite.sales.journal")} detail={data ? t(nextCursor ? "suite.sales.shownMore" : "suite.sales.shown", { count: rows.length }) : undefined}><DataTable columns={columns} empty={emptyText(t("suite.sales.empty"))}>{rows.map((row) => <tr key={String(row.id)}><td className="py-1"><Link prefetch={false} className="inline-flex min-h-11 items-center" href={`/business/sales/${row.id}`}><Ltr>{String(row.reference)}</Ltr></Link></td><td>{row.customerName ? String(row.customerName) : t("suite.sales.walkIn")}</td><td>{when(row.occurredAt)}</td><td>{money(row.totalXof)}</td><td>{money(row.paidXof)}</td><td>{money(row.dueXof)}</td><td className="py-1"><Link prefetch={false} className="suite-text-link inline-flex min-h-11 items-center" href={`/business/sales/${row.id}/receipt?from=sales`}>{t("suite.sales.print")}</Link></td></tr>)}</DataTable>{listFooter}</Panel>
    </>;
  }

  if (section === "customers") {
    const rows = (data?.customers as CustomerRow[] | undefined) ?? [];
    const columns = (["customer", "phone", "sales", "balance"] as const).map((key) => t(`suite.customers.columns.${key}`));
    return <><PageHeading section={section} action={<Link className="business-secondary suite-primary-link" href="/business/pos">{t("suite.customers.walkInSale")}</Link>} />{alerts}
        <div className="suite-two-column">{canManageCustomers && <Panel title={t("suite.customers.newTitle")} detail={t("suite.customers.newDetail")}><form className="suite-form" onSubmit={submitCustomer}><label>{t("suite.customers.name")}<input required maxLength={160} value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /></label><label>{t("suite.customers.phoneOptional")}<input type="tel" dir="ltr" maxLength={60} value={customerDraft.phone} onChange={(event) => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /></label>
          {canRecordCustomerDebt && <>
            <label className="suite-checkbox gap-2"><input type="checkbox" checked={customerDraft.hasDebt} aria-describedby="customer-debt-hint" onChange={(event) => { setCustomerError(""); setCustomerDraft({ ...customerDraft, hasDebt: event.target.checked }); }} />{t("suite.customers.hasDebt")}</label>
            <p id="customer-debt-hint" className="suite-form-help">{t("suite.customers.hasDebtHint")}</p>
            {customerDraft.hasDebt && <>
              <label>{t("suite.customers.debtAmount")}<input required dir="ltr" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="0" className="numeric" value={customerDraft.debtXof} aria-invalid={customerError ? true : undefined} onChange={(event) => { setCustomerError(""); setCustomerDraft({ ...customerDraft, debtXof: event.target.value.replace(/\s/g, "") }); }} /></label>
              <label>{t("suite.customers.debtDate")}<input type="date" required max={todayUtc()} value={customerDraft.debtDate} onChange={(event) => setCustomerDraft({ ...customerDraft, debtDate: event.target.value })} /></label>
              <label>{t("suite.customers.debtNote")}<textarea dir="auto" rows={2} maxLength={500} placeholder={t("suite.customers.debtNotePlaceholder")} className="min-h-20 w-full px-3 py-2" value={customerDraft.debtNote} onChange={(event) => setCustomerDraft({ ...customerDraft, debtNote: event.target.value })} /></label>
            </>}
          </>}
          {customerError && <p className="business-alert m-0" role="alert">{customerError}</p>}
          <button className="business-primary" disabled={busy}>{busy ? t("common.saving") : t(canRecordCustomerDebt && customerDraft.hasDebt ? "suite.customers.addWithDebt" : "suite.customers.add")}</button></form></Panel>}
        <Panel title={t("suite.customers.listTitle")} detail={t("suite.customers.listDetail")} action={canRecordCustomerDebt ? <Link className="suite-text-link inline-flex min-h-11 items-center" href="/business/opening?tab=customers">{t("suite.customers.repayLink")}</Link> : undefined}><DataTable columns={columns} empty={emptyText(t("suite.customers.empty"))}>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.phone ? <Ltr>{row.phone}</Ltr> : "—"}</td><td>{row.saleCount}</td><td className={BigInt(row.balanceXof) > 0n ? "suite-due" : ""}>{money(row.balanceXof)}</td></tr>)}</DataTable>{listFooter}</Panel></div>
      <p className="business-footnote">{t("suite.customers.footnote")}</p>
    </>;
  }

  if (section === "suppliers") {
    const rows = (data?.suppliers as SupplierRow[] | undefined) ?? [];
    const columns = (["supplier", "phone", "purchases", "total"] as const).map((key) => t(`suite.suppliers.columns.${key}`));
    return <><PageHeading section={section} />{alerts}<div className="suite-two-column">{canManageSuppliers && <Panel title={t("suite.suppliers.addTitle")}><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/suppliers", "POST", supplierDraft, t("suite.suppliers.added"))}><label>{t("suite.suppliers.name")}<input required maxLength={160} value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })} /></label><label>{t("suite.suppliers.phone")}<input type="tel" dir="ltr" maxLength={60} value={supplierDraft.phone} onChange={(event) => setSupplierDraft({ ...supplierDraft, phone: event.target.value })} /></label><button className="business-primary" disabled={busy}>{busy ? t("common.saving") : t("suite.suppliers.save")}</button></form></Panel>}<Panel title={t("suite.suppliers.listTitle")}><DataTable columns={columns} empty={emptyText(t("suite.suppliers.empty"))}>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.phone ? <Ltr>{row.phone}</Ltr> : "—"}</td><td>{row.purchaseCount}</td><td>{money(row.purchaseTotalXof)}</td></tr>)}</DataTable>{listFooter}</Panel></div></>;
  }

  if (section === "purchases") {
    const rows = (data?.purchases as Row[] | undefined) ?? []; const suppliers = supplierOptions;
    const columns = (["reference", "supplier", "date", "total", "paid"] as const).map((key) => t(`suite.purchases.columns.${key}`));
    return <><PageHeading section={section} />{alerts}<div className="suite-two-column">{canManageSuppliers && <Panel title={t("suite.purchases.receiveTitle")} detail={t("suite.purchases.receiveDetail")}><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/purchases", "POST", { ...purchaseDraft, lines: [{ variantId: purchaseDraft.variantId, quantity: purchaseDraft.quantity, unitCostXof: purchaseDraft.unitCostXof }] }, t("suite.purchases.received"), true)}>
      <label>{t("suite.purchases.supplier")}<select required value={purchaseDraft.supplierId} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, supplierId: event.target.value })}><option value="">{t("suite.purchases.choose")}</option>{suppliers.map((row) => <option value={String(row.id)} key={String(row.id)}>{String(row.name)}</option>)}</select></label><label>{t("suite.purchases.reference")}<input required dir="ltr" value={purchaseDraft.reference} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, reference: event.target.value })} /></label>
      <label>{t("suite.purchases.item")}<select required value={purchaseDraft.variantId} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, variantId: event.target.value })}><option value="">{t("suite.purchases.choose")}</option>{productOptions.map((row) => <option value={row.variantId} key={row.variantId}>{row.name} · {row.variantLabel} ({row.sku ?? t("suite.purchases.noSku")})</option>)}</select></label><div className="suite-form-row"><label>{t("suite.purchases.quantity")}<input required dir="ltr" inputMode="decimal" pattern="[0-9]+(\\.[0-9]{1,6})?" value={purchaseDraft.quantity} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, quantity: event.target.value })} /></label><label>{t("suite.purchases.unitCost")}<input required dir="ltr" inputMode="numeric" pattern="[0-9]+" value={purchaseDraft.unitCostXof} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, unitCostXof: event.target.value })} /></label></div><div className="suite-form-row"><label>{t("suite.purchases.paid")}<input dir="ltr" inputMode="numeric" pattern="[0-9]*" value={purchaseDraft.paidXof} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, paidXof: event.target.value })} /></label><label>{t("suite.purchases.paymentMethod")}<select value={purchaseDraft.paymentMethod} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, paymentMethod: event.target.value })}><option value="cash">{t("suite.payment.cash")}</option><option value="wave">{t("suite.payment.waveManual")}</option><option value="orange_money">{t("suite.payment.orangeMoneyManual")}</option><option value="mtn_momo">{t("suite.payment.mtnMomoManual")}</option><option value="moov_money">{t("suite.payment.moovMoneyManual")}</option><option value="other">{t("suite.payment.other")}</option></select></label></div><button className="business-primary" disabled={busy || !suppliers.length || !productOptions.length}>{busy ? t("suite.purchases.submitting") : t("suite.purchases.submit")}</button>
      </form>{!suppliers.length && <p className="suite-form-help">{t("suite.purchases.needSupplier")}</p>}</Panel>}
      <Panel title={t("suite.purchases.listTitle")} detail={t("suite.purchases.listDetail")}><DataTable columns={columns} empty={emptyText(t("suite.purchases.empty"))}>{rows.map((row) => <tr key={String(row.id)}><td><strong><Ltr>{String(row.reference)}</Ltr></strong></td><td>{String(row.supplierName)}</td><td>{when(row.occurredAt)}</td><td>{money(row.totalXof)}</td><td>{money(row.paidXof)}</td></tr>)}</DataTable>{listFooter}</Panel></div></>;
  }

  if (section === "expenses") {
    const rows = (data?.expenses as Row[] | undefined) ?? [];
    const columns = (["date", "category", "description", "amount"] as const).map((key) => t(`suite.expenses.columns.${key}`));
    // Catégorie libre côté serveur : les catégories proposées sont traduites, une valeur ancienne ou inconnue s'affiche telle quelle.
    const categoryLabel = (value: unknown) => { const raw = String(value ?? ""); return isExpenseCategory(raw) ? t(`suite.expenses.categories.${raw}`) : raw; };
    return <><PageHeading section={section} />{alerts}<div className="suite-two-column">{canManageExpenses && <Panel title={t("suite.expenses.newTitle")} detail={t("suite.expenses.newDetail")}><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/expenses", "POST", expenseDraft, t("suite.expenses.saved"), true)}><label>{t("suite.expenses.category")}<select value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })}>{expenseCategories.map((value) => <option value={value} key={value}>{t(`suite.expenses.categories.${value}`)}</option>)}</select></label><label>{t("suite.expenses.description")}<input required maxLength={240} value={expenseDraft.description} onChange={(event) => setExpenseDraft({ ...expenseDraft, description: event.target.value })} /></label><label>{t("suite.expenses.amount")}<input required dir="ltr" inputMode="numeric" pattern="[0-9]+" value={expenseDraft.amountXof} onChange={(event) => setExpenseDraft({ ...expenseDraft, amountXof: event.target.value })} /></label><label>{t("suite.expenses.paidBy")}<select value={expenseDraft.paymentMethod} onChange={(event) => setExpenseDraft({ ...expenseDraft, paymentMethod: event.target.value })}><option value="cash">{t("suite.payment.cashDrawer")}</option><option value="wave">{t("suite.payment.wave")}</option><option value="orange_money">{t("suite.payment.orangeMoney")}</option><option value="mtn_momo">{t("suite.payment.mtnMomo")}</option><option value="moov_money">{t("suite.payment.moovMoney")}</option><option value="other">{t("suite.payment.other")}</option></select></label><button className="business-primary" disabled={busy}>{busy ? t("common.saving") : t("suite.expenses.save")}</button></form></Panel>}<Panel title={t("suite.expenses.listTitle")}><DataTable columns={columns} empty={emptyText(t("suite.expenses.empty"))}>{rows.map((row) => <tr key={String(row.id)}><td>{when(row.occurredAt)}</td><td>{categoryLabel(row.category)}</td><td>{String(row.description)}</td><td>{money(row.amountXof)}</td></tr>)}</DataTable>{listFooter}</Panel></div></>;
  }

  if (section === "settings") {
    const settings = settingsDraft ?? data?.settings as Settings | undefined;
    return <><PageHeading section={section} />{alerts}{settings && <form className="suite-settings" onSubmit={(event) => void submit(event, "/api/business/settings", "PATCH", { ...settings, email: settings.email || "", receiptFooter: settings.receiptFooter || null }, t("suite.settings.saved"))}>
      <Panel title={t("suite.settings.profileTitle")} detail={t("suite.settings.profileDetail")}><div className="suite-form-grid"><div className="suite-span-two flex min-w-0 items-center gap-4"><BusinessLogo name={settings.name} logo={settings.logo} className="size-16" /><div className="grid min-w-0 gap-2"><strong className="text-sm text-ink">{t("suite.settings.logo")}</strong>{canManageSettings && <div className="flex flex-wrap gap-2"><label className="business-secondary inline-flex min-h-11 cursor-pointer items-center">{settings.logo ? t("suite.settings.logoReplace") : t("suite.settings.logoChoose")}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void downscaleLogo(file).then((logo) => { setError(""); setSettingsDraft({ ...settings, logo }); }, (problem: unknown) => setError(problem instanceof Error && problem.message === "size" ? t("suite.settings.logoTooLarge") : t("suite.settings.logoInvalid"))); }} /></label>{settings.logo && <button type="button" className="business-secondary min-h-11" onClick={() => setSettingsDraft({ ...settings, logo: null })}>{t("suite.settings.logoRemove")}</button>}</div>}<small className="text-fg-subtle">{t("suite.settings.logoHint")}</small></div></div><label>{t("suite.settings.name")}<input required value={settings.name} onChange={(event) => setSettingsDraft({ ...settings, name: event.target.value })} /></label><label>{t("suite.settings.phone")}<input type="tel" dir="ltr" value={settings.phone ?? ""} onChange={(event) => setSettingsDraft({ ...settings, phone: event.target.value || null })} /></label><label className="suite-span-two">{t("suite.settings.address")}<input value={settings.address ?? ""} onChange={(event) => setSettingsDraft({ ...settings, address: event.target.value || null })} /></label><label>{t("suite.settings.email")}<input type="email" dir="ltr" value={settings.email ?? ""} onChange={(event) => setSettingsDraft({ ...settings, email: event.target.value || null })} /></label><label>{t("suite.settings.currency")}<select value="XOF" disabled><option value="XOF">{t("suite.settings.currencyOption")}</option></select></label><label>{t("suite.settings.timeZone")}<select value={timeZone} disabled><option value={timeZone}>{timeZone}</option></select></label><label>{t("suite.settings.primaryColor")}<input type="color" value={settings.primaryColor} onChange={(event) => setSettingsDraft({ ...settings, primaryColor: event.target.value })} /></label></div></Panel>
      <Panel title={t("suite.settings.receiptTitle")} detail={t("suite.settings.receiptDetail")}><div className="suite-form-grid"><label>{t("suite.settings.paperWidth")}<select value={settings.paperWidthMm} onChange={(event) => setSettingsDraft({ ...settings, paperWidthMm: Number(event.target.value) })}><option value={58}>{t("suite.settings.widthOption", { width: 58 })}</option><option value={80}>{t("suite.settings.widthOption", { width: 80 })}</option></select></label><label className="suite-checkbox"><input type="checkbox" checked={settings.showLogo} onChange={(event) => setSettingsDraft({ ...settings, showLogo: event.target.checked })} />{t("suite.settings.showLogo")}</label><label className="suite-span-two">{t("suite.settings.footer")}<textarea maxLength={300} value={settings.receiptFooter ?? ""} onChange={(event) => setSettingsDraft({ ...settings, receiptFooter: event.target.value || null })} /></label></div><div className="suite-receipt-preview"><small>{t("suite.settings.previewTitle")}</small><strong>{settings.name}</strong><span>{settings.phone ? <Ltr>{settings.phone}</Ltr> : t("suite.settings.phoneMissing")}</span><span>{t("suite.settings.previewSale", { amount: formatXof("12500", locale) })}</span><em>{settings.receiptFooter || t("suite.settings.previewFooter")}</em><span>{t("suite.settings.previewWidth", { width: settings.paperWidthMm })}</span></div></Panel>
      <div className="suite-save-row"><span><Ltr>XOF · {timeZone}</Ltr></span>{canManageSettings ? <button className="business-primary" disabled={busy}>{busy ? t("common.saving") : t("suite.settings.save")}</button> : <span>{t("suite.settings.readOnly")}</span>}</div>
    </form>}{!settings && !error && <p className="suite-loading">{t("suite.settings.loading")}</p>}<RecoveryCodeCard /></>;
  }

  return <><PageHeading section={section} /><p className="suite-empty">{t("suite.unavailable")}</p></>;
}
