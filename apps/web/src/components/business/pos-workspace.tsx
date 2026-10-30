"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

type Product = { id: string; name: string; categoryId: string | null; categoryName: string | null; baseUnit: string; variantId: string; variantLabel: string; sku: string | null; salePriceXof: string; onHand: string };
type Customer = { id: string; name: string; phone: string | null; balanceXof: string };
type CartLine = { product: Product; quantity: string };
type PayMethod = "cash" | "wave" | "orange_money" | "mtn_momo" | "other";
type PaymentPart = { method: PayMethod; amountXof: string };
const SCALE = 1_000_000n;
const methods: { value: PayMethod; label: string; external: boolean }[] = [
  { value: "cash", label: "Espèces", external: false }, { value: "wave", label: "Wave", external: true },
  { value: "orange_money", label: "Orange Money", external: true }, { value: "mtn_momo", label: "MTN MoMo", external: true }, { value: "other", label: "Autre", external: true },
];
const formatMoney = (value: bigint) => `${new Intl.NumberFormat("fr-FR").format(value)} F CFA`;
function micros(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{0,6}))?$/.exec(value);
  if (!match) return 0n;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? "").padEnd(6, "0"));
}
function lineTotal(price: string, qty: string) { const q = micros(qty); return (BigInt(price) * q + SCALE / 2n) / SCALE; }

export function PosWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [payments, setPayments] = useState<PaymentPart[]>([{ method: "cash", amountXof: "" }]);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [success, setSuccess] = useState<{ id: string; reference: string; totalXof: string; paidXof: string; dueXof: string } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/business/products", { cache: "no-store" }), fetch("/api/business/customers", { cache: "no-store" })]).then(async ([productResponse, customerResponse]) => {
      const [productData, customerData] = await Promise.all([productResponse.json(), customerResponse.json()]) as [{ products?: Product[]; categories?: { id: string; name: string }[]; error?: string }, { customers?: Customer[]; error?: string }];
      if (!productResponse.ok) throw new Error(productData.error || "Le catalogue n’est pas disponible.");
      if (!customerResponse.ok) throw new Error(customerData.error || "Les clients ne sont pas disponibles.");
      if (active) { setProducts(productData.products ?? []); setCategories(productData.categories ?? []); setCustomers(customerData.customers ?? []); }
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Impossible de charger la caisse."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filteredProducts = useMemo(() => products.filter((item) =>
    (!categoryId || item.categoryId === categoryId) && (!search || `${item.name} ${item.sku ?? ""} ${item.variantLabel}`.toLowerCase().includes(search.toLowerCase()))
    && micros(item.onHand) > 0n,
  ), [products, categoryId, search]);
  const total = cart.reduce((sum, line) => sum + lineTotal(line.product.salePriceXof, line.quantity), 0n);
  const paymentsTotal = payments.reduce((sum, part) => sum + (part.amountXof.match(/^[0-9]+$/) ? BigInt(part.amountXof) : 0n), 0n);
  const confirmedCash = payments.filter((part) => part.method === "cash").reduce((sum, part) => sum + (part.amountXof.match(/^[0-9]+$/) ? BigInt(part.amountXof) : 0n), 0n);
  const mobilePartExists = payments.some((part) => part.method !== "cash" && part.amountXof !== "");
  const customerRequired = confirmedCash < total || mobilePartExists;

  function addProduct(product: Product) {
    setError(""); setSuccess(null);
    setCart((current) => {
      const found = current.find((line) => line.product.variantId === product.variantId);
      if (found) return current.map((line) => line.product.variantId === product.variantId ? { ...line, quantity: String(Number(line.quantity) + 1) } : line);
      return [...current, { product, quantity: "1" }];
    });
  }

  function setQuantity(variantId: string, value: string) {
    setCart((current) => current.map((line) => line.product.variantId === variantId ? { ...line, quantity: value } : line));
  }

  function changePayment(index: number, key: keyof PaymentPart, value: string) {
    setPayments((current) => current.map((part, i) => i === index ? { ...part, [key]: value } : part));
  }

  async function finishSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true);
    try {
      if (!cart.length) throw new Error("Ajoutez au moins un article au panier.");
      if (paymentsTotal > total) throw new Error("Le total des règlements dépasse le montant de la vente.");
      if (customerRequired && !customerId) throw new Error("Associez un client au solde restant ou au paiement mobile en attente.");
      const salePayload = { customerId: customerId || undefined,
        lines: cart.map((line) => ({ variantId: line.product.variantId, quantity: line.quantity })),
        payments: payments.filter((part) => /^[1-9]\d*$/.test(part.amountXof)),
      };
      const fingerprint = JSON.stringify(salePayload);
      if (attemptRef.current?.fingerprint !== fingerprint) attemptRef.current = { fingerprint, key: crypto.randomUUID() };
      const idempotencyKey = attemptRef.current.key;
      const response = await fetch("/api/business/sales", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ ...salePayload, idempotencyKey }),
      });
      const body = await response.json() as { sale?: { id: string; reference: string; totalXof: string; paidXof: string; dueXof: string }; error?: string };
      if (!response.ok || !body.sale) throw new Error(body.error || "La vente n’a pas été enregistrée.");
      setSuccess(body.sale); attemptRef.current = null; setCart([]); setCustomerId(""); setPayments([{ method: "cash", amountXof: "" }]);
      const refreshed = await fetch("/api/business/products", { cache: "no-store" }).then((result) => result.json()) as { products?: Product[] };
      if (refreshed.products) setProducts(refreshed.products);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "La vente n’a pas été enregistrée."); }
    finally { setPending(false); }
  }

  return <>
    <div className="business-heading"><div><p className="business-kicker">ENREGISTREMENT RAPIDE</p><h1>Caisse</h1><p>Recherchez, ajoutez au panier, vérifiez le règlement puis enregistrez la vente.</p></div><Link className="business-secondary suite-primary-link" href="/business/sales">Historique des ventes</Link></div>
    {error && <p className="business-alert" role="alert">{error}</p>}
    {success && <section className="pos-success" role="status"><div><small>VENTE ENREGISTRÉE</small><h2>{success.reference}</h2><p>Total {formatMoney(BigInt(success.totalXof))} · Confirmé {formatMoney(BigInt(success.paidXof))} · Solde {formatMoney(BigInt(success.dueXof))}</p><p>Le stock a été mis à jour. Une impression ratée n’annule pas la vente.</p></div><div><Link className="business-secondary" href={`/business/sales/${success.id}/receipt`}>Afficher / imprimer le reçu</Link><button type="button" className="business-primary" onClick={() => setSuccess(null)}>Nouvelle vente</button></div></section>}
    <div className="pos-layout">
      <section className="panel pos-catalog" aria-labelledby="pos-products-title"><header className="suite-panel-head"><div><h2 id="pos-products-title">Catalogue</h2><p>{filteredProducts.length} article(s) disponible(s)</p></div></header>
        <label className="pos-search-label">Rechercher un produit<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, référence ou SKU" /></label>
        <div className="pos-category-filters" aria-label="Filtrer par catégorie"><button type="button" className={!categoryId ? "selected" : ""} onClick={() => setCategoryId("")}>Tout</button>{categories.map((category) => <button type="button" key={category.id} className={categoryId === category.id ? "selected" : ""} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div>
        {loading ? <p className="suite-loading" role="status">Chargement du catalogue…</p> : <div className="pos-product-list">{filteredProducts.map((item) => <button type="button" className="pos-product" key={item.variantId} onClick={() => addProduct(item)}><span className="pos-product-glyph" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><span className="pos-product-description"><strong>{item.name}</strong><small>{item.variantLabel} · {item.sku ?? item.baseUnit}</small><small>Disponible : {item.onHand} {item.baseUnit}</small></span><span className="pos-product-price">{formatMoney(BigInt(item.salePriceXof))}<small>Ajouter</small></span></button>)}{!filteredProducts.length && <p className="suite-empty">Aucun produit ne correspond. Vérifiez le nom, la catégorie ou la disponibilité.</p>}</div>}
      </section>
      <form className="panel pos-cart" onSubmit={(event) => void finishSale(event)}><header className="suite-panel-head"><div><h2>Panier</h2><p>{cart.length} ligne(s) · saisie décimale jusqu’à 6 chiffres</p></div><button type="button" className="suite-link-button" onClick={() => setCart([])} disabled={!cart.length}>Vider</button></header>
        <div className="pos-cart-lines">{cart.map(({ product, quantity: qty }) => <div className="pos-cart-line" key={product.variantId}><div className="pos-cart-name"><strong>{product.name}</strong><small>{product.variantLabel} · {formatMoney(BigInt(product.salePriceXof))} / {product.baseUnit}</small></div><label>Qté<input inputMode="decimal" aria-label={`Quantité de ${product.name}`} value={qty} onChange={(event) => setQuantity(product.variantId, event.target.value)} /></label><strong className="pos-line-total">{formatMoney(lineTotal(product.salePriceXof, qty))}</strong><button type="button" className="pos-remove" aria-label={`Retirer ${product.name}`} onClick={() => setCart((current) => current.filter((line) => line.product.variantId !== product.variantId))}>Retirer</button></div>)}{!cart.length && <p className="suite-empty">Sélectionnez un article dans le catalogue pour commencer.</p>}</div>
        <div className="pos-customer-field"><label>Client{customerRequired ? " · nécessaire pour le solde dû" : " · facultatif"}<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">{customerRequired ? "Choisir un client" : "Vente comptant sans fiche client"}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}</select></label><Link href="/business/customers">Créer une fiche client</Link></div>
        <div className="pos-payment-block"><div className="suite-panel-head"><div><h3>Règlement</h3><p>Les paiements électroniques saisis ici restent en attente de confirmation externe.</p></div><button type="button" className="suite-link-button" onClick={() => setPayments((current) => [...current, { method: "wave", amountXof: "" }])}>+ Ajouter un moyen</button></div>
          {payments.map((part, index) => <div className="pos-payment-part" key={index}><label>Moyen<select value={part.method} onChange={(event) => changePayment(index, "method", event.target.value)}>{methods.map((method) => <option key={method.value} value={method.value}>{method.label}{method.external ? " · en attente / simulation" : ""}</option>)}</select></label><label>{part.method === "cash" ? "Montant reçu" : "Montant saisi · non confirmé"}<input inputMode="numeric" pattern="[0-9]*" value={part.amountXof} onChange={(event) => changePayment(index, "amountXof", event.target.value)} placeholder="0" /></label>{payments.length > 1 && <button type="button" className="pos-remove" aria-label="Retirer ce moyen de paiement" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}>Retirer</button>}</div>)}
        </div>
        <div className="pos-totals"><div><span>Total de la vente</span><strong>{formatMoney(total)}</strong></div><div><span>Espèces confirmées</span><strong>{formatMoney(confirmedCash)}</strong></div><div><span>Règlements saisis</span><strong>{formatMoney(paymentsTotal)}</strong></div><div className="pos-balance"><span>Solde dû (hors paiements en attente)</span><strong>{formatMoney(total > confirmedCash ? total - confirmedCash : 0n)}</strong></div></div>
        <button className="business-primary pos-submit" disabled={pending || !cart.length || paymentsTotal > total}>{pending ? "Enregistrement de la vente…" : "Valider la vente"}</button>
        <p className="pos-help">Une vente partiellement réglée ou un paiement mobile non confirmé doit être associé à un client. Les services externes Mobile Money ne sont pas connectés.</p>
      </form>
    </div>
  </>;
}
