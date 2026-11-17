"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SearchField } from "@/components/ui/controls";
import { Monogram } from "@/components/ui/data-display";
import { Alert, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Card, PageHeader } from "@/components/ui/layout";
import { QuantityInput } from "@/components/ui/quantity-input";
import { MICROS, parseQuantityInput, stepQuantity, toApiQuantity } from "@/lib/client/quantity";
import { formatQuantity, formatXof } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translate";
import { printThroughAgent, readPairing } from "@/lib/printing/agent-client";
import { track } from "@/lib/analytics/client";
import { countBucket } from "@/lib/analytics/events";
import { manualPaymentMethods, type ManualPaymentMethod } from "@/lib/payment-methods";
import { computeSettlement } from "@/lib/pos/settlement";

type Product = { id: string; name: string; categoryId: string | null; categoryName: string | null; baseUnit: string; variantId: string; variantLabel: string; sku: string | null; salePriceXof: string; onHand: string };
type Customer = { id: string; name: string; phone: string | null; balanceXof: string };
type CartLine = { product: Product; quantity: string };
type PayMethod = ManualPaymentMethod;
// touched : le caissier a saisi le montant ; sinon une ligne espèces suit le montant restant dû.
type PaymentPart = { method: PayMethod; amountXof: string; touched: boolean };
type SaleResult = { id: string; reference: string; totalXof: string; paidXof: string; dueXof: string; tenderedXof?: string; changeXof?: string };
const methods: readonly PayMethod[] = manualPaymentMethods;
const freshPayments = (): PaymentPart[] => [{ method: "cash", amountXof: "", touched: false }];

/** Aperçu du montant d'une ligne. Le total de référence reste celui calculé par le serveur. */
function lineTotal(price: string, quantity: string) {
  const micros = parseQuantityInput(quantity) ?? 0n;
  return (BigInt(price) * micros + MICROS / 2n) / MICROS;
}
/** Variante affichée seulement si elle apporte une information (ni « Standard », ni l'unité répétée). */
const variantName = (item: Product) => (item.variantLabel === "Standard" || item.variantLabel.toLocaleLowerCase() === item.baseUnit.toLocaleLowerCase() ? "" : item.variantLabel);
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

export function PosWorkspace() {
  const { t, locale } = useI18n();
  const money = (value: string | bigint) => formatXof(value, locale);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [payments, setPayments] = useState<PaymentPart[]>(freshPayments);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileView, setMobileView] = useState<"catalog" | "cart">("catalog");
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [success, setSuccess] = useState<SaleResult | null>(null);
  // Module d'impression facultatif : lu une fois ; 403 ou panne = pas d'impression, la caisse fonctionne pareil.
  const [printSetup, setPrintSetup] = useState<{ enabled: boolean; autoPrint: boolean } | null>(null);
  const [hasPairing, setHasPairing] = useState(false);
  const [printState, setPrintState] = useState<string>("");
  useEffect(() => {
    setHasPairing(Boolean(readPairing()));
    fetch("/api/business/printing", { cache: "no-store" }).then(async (response) => { if (response.ok) setPrintSetup(await response.json() as { enabled: boolean; autoPrint: boolean }); }).catch(() => undefined);
  }, []);
  // Clé d'intention par vente : si un échec mène à une réimpression, un double envoi retrouve la même tâche (I-8).
  const printKeys = useRef(new Map<string, string>());
  const printReceipt = async (saleId: string) => {
    setPrintState("printing");
    const idempotencyKey = printKeys.current.get(saleId) ?? crypto.randomUUID();
    printKeys.current.set(saleId, idempotencyKey);
    const result = await printThroughAgent({ kind: "receipt", saleId, language: locale, idempotencyKey });
    if (result.jobId) printKeys.current.delete(saleId);
    if (result.status === "failed") track("print_failed", { error: (["not_paired", "agent_unreachable", "timeout", "paper_out", "disconnected", "connection_refused", "communication_error"] as const).find((code) => code === result.error) ?? "other" });
    const errorKey = `printing.errors.${result.error ?? "generic"}` as MessageKey;
    const errorText = t(errorKey) === errorKey ? t("printing.errors.generic") : t(errorKey);
    setPrintState(result.status === "printed" ? t(result.error === "already_printed" ? "printing.results.already" : "printing.results.printed")
      : result.status === "uncertain" ? t("printing.results.uncertain") : t("printing.results.failed", { error: errorText }));
  };

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/business/products", { cache: "no-store" }), fetch("/api/business/customers", { cache: "no-store" })]).then(async ([productResponse, customerResponse]) => {
      const [productData, customerData] = await Promise.all([productResponse.json(), customerResponse.json()]) as [{ products?: Product[]; categories?: { id: string; name: string }[]; error?: string }, { customers?: Customer[]; error?: string }];
      if (!productResponse.ok) throw new Error(productData.error || t("pos.loadFailed"));
      if (!customerResponse.ok) throw new Error(customerData.error || t("pos.loadFailed"));
      if (active) { setProducts(productData.products ?? []); setCategories(productData.categories ?? []); setCustomers(customerData.customers ?? []); }
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : t("pos.loadFailed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const filteredProducts = useMemo(() => {
    const needle = normalize(search.trim());
    return products.filter((item) => (!categoryId || item.categoryId === categoryId)
      && (!needle || normalize(`${item.name} ${item.sku ?? ""} ${item.variantLabel}`).includes(needle))
      && (parseQuantityInput(item.onHand) ?? 0n) > 0n);
  }, [products, categoryId, search]);
  const total = cart.reduce((sum, line) => sum + lineTotal(line.product.salePriceXof, line.quantity), 0n);
  // Affichage seulement : le serveur recalcule et contrôle tout (part affectée, monnaie, reste dû).
  const settlement = computeSettlement(total, payments);
  const declaredPartExists = payments.some((part) => part.method !== "cash" && part.amountXof !== "");
  const customerRequired = settlement.dueXof > 0n;
  const itemCount = cart.length;
  const quantityInCart = (variantId: string) => cart.find((line) => line.product.variantId === variantId)?.quantity;

  function addProduct(product: Product) {
    setError(""); setSuccess(null);
    setCart((current) => {
      const found = current.find((line) => line.product.variantId === product.variantId);
      if (found) return current.map((line) => line.product.variantId === product.variantId ? { ...line, quantity: stepQuantity(line.quantity, 1, locale) } : line);
      return [...current, { product, quantity: "1" }];
    });
  }
  const setQuantity = (variantId: string, value: string) => setCart((current) => current.map((line) => line.product.variantId === variantId ? { ...line, quantity: value } : line));
  const removeLine = (variantId: string) => setCart((current) => current.filter((line) => line.product.variantId !== variantId));
  const changePayment = (index: number, patch: Partial<PaymentPart>) => setPayments((current) => current.map((part, i) => i === index ? { ...part, ...patch } : part));

  async function finishSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true);
    try {
      if (!cart.length) throw new Error(t("pos.emptyCartError"));
      const invalid = cart.find((line) => !parseQuantityInput(line.quantity));
      if (invalid) throw new Error(t("pos.invalidQty", { product: invalid.product.name }));
      if (settlement.overpaid) throw new Error(t("pos.overpaid"));
      if (customerRequired && !customerId) throw new Error(t("pos.customerNeeded"));
      const salePayload = { customerId: customerId || undefined,
        lines: cart.map((line) => ({ variantId: line.product.variantId, quantity: toApiQuantity(line.quantity) })),
        payments: settlement.payload,
      };
      // Une même vente répétée (double clic, réseau lent) réutilise la même clé d'idempotence.
      const fingerprint = JSON.stringify(salePayload);
      if (attemptRef.current?.fingerprint !== fingerprint) attemptRef.current = { fingerprint, key: crypto.randomUUID() };
      const idempotencyKey = attemptRef.current.key;
      const response = await fetch("/api/business/sales", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ ...salePayload, idempotencyKey }),
      });
      const body = await response.json() as { sale?: SaleResult; error?: string };
      if (!response.ok || !body.sale) throw new Error(body.error || t("pos.saleFailed"));
      setSuccess(body.sale); setPrintState(""); attemptRef.current = null;
      const methods = new Set(salePayload.payments.map((part) => part.method));
      track("sale_recorded", { line_count: countBucket(salePayload.lines.length), has_customer: Boolean(salePayload.customerId),
        payment_mix: body.sale.dueXof !== "0" && !salePayload.payments.length ? "credit" : methods.size > 1 ? "mixed" : methods.has("cash") ? "cash" : "mobile" });
      // Impression automatique : seulement après la validation du serveur, en arrière-plan ; une panne ne touche pas la vente.
      if (printSetup?.enabled && printSetup.autoPrint && readPairing()) void printReceipt(body.sale.id); setCart([]); setCustomerId(""); setPayments(freshPayments()); setMobileView("catalog");
      const refreshed = await fetch("/api/business/products", { cache: "no-store" }).then((result) => result.json()) as { products?: Product[] };
      if (refreshed.products) setProducts(refreshed.products);
    } catch (caught) { track("sale_failed", { reason: caught instanceof TypeError ? "network" : "other" }); 
      // Pas de réponse : la vente a pu passer. La clé d'idempotence est gardée, un nouvel essai ne la doublera pas.
      setError(caught instanceof TypeError ? t("pwa.network.saleUnknown") : caught instanceof Error ? caught.message : t("pos.saleFailed")); }
    finally { setPending(false); }
  }

  const categoryChip = (active: boolean) => cn("inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors",
    active ? "border-transparent bg-night text-white" : "border-line bg-surface text-fg-muted hover:border-brand-tint hover:text-ink");

  return (
    <div>
      <PageHeader title={t("pos.title")} actions={
        <Link href="/business/sales" className={buttonClasses({ variant: "secondary", className: "no-underline" })}><Icon name="receipt" />{t("pos.history")}</Link>
      }>{t("pos.intro")}</PageHeader>

      {error && <Alert tone="danger" className="mb-4" onDismiss={() => setError("")} dismissLabel={t("common.close")}>{error}</Alert>}
      {success && (
        <Card tone="brand" className="mb-4 flex flex-wrap items-center justify-between gap-4" role="status">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white/20"><Icon name="success" className="size-6" /></span>
            <div className="min-w-0">
              <p className="m-0 text-sm text-white/80">{t("pos.successTitle")}</p>
              <p className="numeric m-0 text-start text-xl font-bold rtl:text-end"># {success.reference}</p>
              <p className="m-0 text-sm text-white/85">{t("pos.successBody", { total: money(success.totalXof), paid: money(success.paidXof), due: money(success.dueXof) })}</p>
              {success.changeXof && success.changeXof !== "0" && <p className="m-0 text-sm font-semibold text-white">{t("pos.successChange", { cash: money(success.tenderedXof ?? "0"), change: money(success.changeXof) })}</p>}
              <p className="m-0 mt-1 text-xs text-white/70">{t("pos.stockUpdated")}</p>
              {printState && <p className="m-0 mt-1 text-xs font-semibold text-white" role="status">{printState === "printing" ? t("pos.printing") : printState}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {printSetup?.enabled && hasPairing && <button type="button" onClick={() => void printReceipt(success.id)} disabled={printState === "printing"} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-white/40 bg-transparent px-4 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"><Icon name="printer" className="size-4" />{t("pos.printThermal")}</button>}
            <Link href={`/business/sales/${success.id}/receipt`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/40 px-4 text-sm font-semibold text-white no-underline hover:bg-white/10"><Icon name="print" className="size-4" />{t("pos.receipt")}</Link>
            <button type="button" onClick={() => setSuccess(null)} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-0 bg-white px-5 text-sm font-semibold text-brand-strong">{t("pos.newSale")}</button>
          </div>
        </Card>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,410px)]">
        {/* Catalogue */}
        <Card className={cn("min-w-0", mobileView === "cart" && "max-lg:hidden")} aria-labelledby="pos-catalog-title">
          <h2 id="pos-catalog-title" className="sr-only">{t("pos.searchLabel")}</h2>
          <SearchField value={search} onChange={setSearch} label={t("pos.searchLabel")} placeholder={t("pos.searchPlaceholder")} />
          <div role="group" aria-label={t("pos.categories")} className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            <button type="button" aria-pressed={!categoryId} className={categoryChip(!categoryId)} onClick={() => setCategoryId("")}>{t("pos.all")}</button>
            {categories.map((category) => <button type="button" key={category.id} aria-pressed={categoryId === category.id} className={categoryChip(categoryId === category.id)} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
          </div>
          <p className="m-0 mt-3 mb-2 text-sm text-fg-subtle">{t("pos.catalogCount", { count: filteredProducts.length })}</p>
          {loading ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="h-36 rounded-lg" />)}</div>
          ) : filteredProducts.length === 0 ? (
            <EmptyState icon="search" title={t("pos.noProducts")} />
          ) : (
            <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:gap-3 xl:grid-cols-3">
              {filteredProducts.map((item) => {
                const inCart = quantityInCart(item.variantId);
                return (
                  <li key={item.variantId} className="min-w-0">
                    <button type="button" onClick={() => addProduct(item)} aria-label={t("pos.add", { product: item.name })}
                      className={cn("relative flex h-full w-full cursor-pointer flex-col gap-2 rounded-lg border bg-surface p-3 text-start transition-[border-color,box-shadow] sm:p-3.5",
                        inCart ? "border-brand shadow-brand" : "border-line hover:border-brand-tint hover:shadow-card")}>
                      <span className="flex items-start justify-between gap-2">
                        <Monogram text={item.name} className="size-11 rounded-[14px]" />
                        {inCart && <span className="numeric rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-white">× {formatQuantity(toApiQuantity(inCart), locale)}</span>}
                      </span>
                      <strong className="line-clamp-2 text-[0.92rem] leading-snug text-ink">{item.name}</strong>
                      <small className="truncate text-xs text-fg-subtle">{variantName(item) ? `${variantName(item)} · ` : ""}{t("pos.inStock", { qty: `${formatQuantity(item.onHand, locale)} ${item.baseUnit}` })}</small>
                      <span className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <strong className="numeric text-start text-[0.98rem] text-ink rtl:text-end">{money(item.salePriceXof)}</strong>
                        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="plus" className="size-4" /></span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Panier et encaissement */}
        <form onSubmit={(event) => void finishSale(event)} className={cn("min-w-0 lg:sticky lg:top-[92px]", mobileView === "catalog" && "max-lg:hidden")} aria-labelledby="pos-cart-title">
          <Card className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setMobileView("catalog")} aria-label={t("pos.backToCatalog")} className="grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink lg:hidden"><Icon name="back" /></button>
                <div>
                  <h2 id="pos-cart-title" className="m-0 text-[1.1rem] font-bold text-ink">{t("pos.cart")}</h2>
                  <p className="m-0 text-xs text-fg-subtle">{t("pos.cartCount", { count: itemCount })}</p>
                </div>
              </div>
              <Button variant="ghost" onClick={() => { if (cart.length) track("cart_abandoned", { line_count: countBucket(cart.length) }); setCart([]); }} disabled={!cart.length} icon={<Icon name="trash" className="size-4" />}>{t("pos.clear")}</Button>
            </div>

            {cart.length === 0 ? (
              <EmptyState icon="cart" title={t("pos.emptyCart")} />
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {cart.map(({ product, quantity }) => (
                  <li key={product.variantId} className="grid gap-2 rounded-[16px] border border-line bg-paper p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-ink">{product.name}</strong>
                        <small className="text-xs text-fg-subtle">{variantName(product) ? `${variantName(product)} · ` : ""}{t("pos.perUnit", { price: money(product.salePriceXof), unit: product.baseUnit })}</small>
                      </div>
                      <button type="button" onClick={() => removeLine(product.variantId)} aria-label={t("pos.remove", { product: product.name })} className="-me-1 -mt-1 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-fg-subtle hover:bg-danger-soft hover:text-danger"><Icon name="close" className="size-4" /></button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-[176px] shrink-0">
                        <QuantityInput id={`qty-${product.variantId}`} value={quantity} onChange={(value) => setQuantity(product.variantId, value)}
                          invalid={!parseQuantityInput(quantity)} ariaLabel={t("pos.qtyFor", { product: product.name })} />
                      </div>
                      <strong className="numeric ms-auto text-end text-[0.95rem] text-ink">{money(lineTotal(product.salePriceXof, quantity))}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Field label={t("pos.customer")} hint={customerRequired && cart.length ? t("pos.customerRequired") : t("pos.customerOptional")}>
              {(props) => (
                <Select {...props} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">{customerRequired && cart.length ? t("pos.chooseCustomer") : t("pos.walkIn")}</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}
                </Select>
              )}
            </Field>
            <Link href="/business/customers" className="-mt-2 justify-self-start text-sm font-semibold text-brand-strong no-underline">{t("pos.createCustomer")}</Link>

            <fieldset className="m-0 grid gap-3 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-bold text-ink">{t("pos.payment")}</legend>
              {payments.map((part, index) => (
                <div key={index} className="grid gap-2 rounded-[16px] border border-line p-3">
                  <div role="radiogroup" aria-label={t("pos.payment")} className="flex flex-wrap gap-1.5">
                    {methods.map((method) => (
                      <button key={method} type="button" role="radio" aria-checked={part.method === method} onClick={() => changePayment(index, { method })}
                        className={cn("min-h-10 cursor-pointer rounded-full border px-3 text-[0.82rem] font-semibold", part.method === method ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface text-fg-muted hover:border-brand-tint")}>
                        {t(`pos.methods.${method}`)}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <Field className="min-w-0 flex-1" label={part.method === "cash" ? t("pos.amountReceived") : t("pos.amountDeclared")}>
                      {(props) => <Input {...props} inputMode="numeric" pattern="[0-9]*" value={part.touched ? part.amountXof : (settlement.rows[index]?.value ? String(settlement.rows[index]!.value) : "")} placeholder="0" className="numeric text-end"
                        onChange={(event) => changePayment(index, { amountXof: event.target.value.replace(/\D/g, ""), touched: true })}
                        onFocus={(event) => event.currentTarget.select()} />}
                    </Field>
                    {total > 0n && <Button variant="secondary" onClick={() => {
                      // Espèces : la ligne reprend le suivi automatique du reste dû. Autre moyen : le reste dû après les autres lignes.
                      if (part.method === "cash") return changePayment(index, { amountXof: "", touched: false });
                      const others = settlement.rows.reduce((sum, row, i) => i === index ? sum : sum + row.applied, 0n);
                      changePayment(index, { amountXof: String(total > others ? total - others : 0n), touched: true });
                    }}>{t("pos.exactAmount")}</Button>}
                    {payments.length > 1 && <button type="button" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))} aria-label={t("pos.removeMethod")} className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg-subtle hover:text-danger"><Icon name="trash" className="size-4" /></button>}
                  </div>
                </div>
              ))}
              <Button variant="ghost" className="justify-self-start" onClick={() => setPayments((current) => [...current, { method: "wave", amountXof: "", touched: false }])} icon={<Icon name="plus" className="size-4" />}>{t("pos.addMethod")}</Button>
              {declaredPartExists && <p className="m-0 rounded-[12px] bg-brand-soft p-2.5 text-xs text-brand-strong">{t("pos.manualNote")}</p>}
              {settlement.changeXof > 0n && (
                <p role="status" className="m-0 flex items-baseline justify-between gap-3 rounded-[12px] bg-ok-soft p-3 text-ok">
                  <span className="text-sm font-semibold">{t("pos.changeDue")}</span>
                  <strong className="numeric text-xl">{money(settlement.changeXof)}</strong>
                </p>
              )}
            </fieldset>

            {/* Totaux en panneau bleu royal, comme le détail de la référence */}
            <div className="grid gap-3 rounded-[20px] bg-brand-glow p-4 text-white shadow-raised">
              <div className="grid gap-1.5 sm:grid-cols-3 sm:gap-2">
                {[["pos.paid", settlement.paidXof], ["pos.cashGiven", settlement.cashGivenXof], ["pos.balanceDue", settlement.dueXof]].map(([key, value]) => (
                  <div key={String(key)} className="flex min-w-0 items-center justify-between gap-2 rounded-[12px] border border-white/20 bg-white/12 px-3 py-1.5 sm:block sm:p-2">
                    <p className="m-0 text-[0.72rem] text-white/80 sm:truncate sm:text-[0.68rem]">{t(key as "pos.total")}</p>
                    <p className="numeric m-0 text-start text-[0.85rem] font-bold sm:mt-0.5 sm:truncate sm:text-[0.82rem] rtl:text-end">{money(value as bigint)}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-end justify-between gap-3">
                <span className="text-sm text-white/85">{t("pos.total")}</span>
                <strong className="numeric text-[1.9rem] leading-none font-bold tracking-[-0.03em]">{money(total)}</strong>
              </div>
              <button disabled={pending || !cart.length || settlement.overpaid}
                className="inline-flex min-h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-white px-5 text-base font-bold text-brand-strong shadow-card hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? t("pos.submitting") : <><Icon name="check" />{t("pos.submit", { amount: money(total) })}</>}
              </button>
            </div>
          </Card>
        </form>
      </div>

      {/* Téléphone : rappel permanent du panier au-dessus de la barre de navigation. */}
      {mobileView === "catalog" && cart.length > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-lg lg:hidden">
          <button type="button" onClick={() => setMobileView("cart")}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[20px] border-0 bg-brand-gradient px-4 text-white shadow-brand">
            <span className="grid size-9 place-items-center rounded-full bg-white/20"><Icon name="cart" className="size-5" /></span>
            <span className="grid text-start">
              <strong className="text-sm">{t("pos.viewCart")}</strong>
              <small className="text-xs text-white/80">{t("pos.cartCount", { count: itemCount })}</small>
            </span>
            <strong className="numeric ms-auto text-base">{money(total)}</strong>
          </button>
        </div>
      )}
    </div>
  );
}
