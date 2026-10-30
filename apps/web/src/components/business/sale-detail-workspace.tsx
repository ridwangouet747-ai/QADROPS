"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { operationKeyFor, type OperationAttempt } from "@/lib/client/operation-key";

type SaleData = { id: string; reference: string; status: string; subtotalXof: string; discountXof: string; totalXof: string; occurredAt: string; customerId: string | null; customerName: string | null; customerPhone: string | null; dueXof: string;
  lines: { id: string; productNameSnapshot: string; variantSnapshot: string; quantity: string; unitPriceXof: string; lineTotalXof: string; costAvailable: boolean }[];
  payments: { id: string; method: string; amountXof: string; status: string; occurredAt: string }[]; refunds: { id: string; amountXof: string; status: string; occurredAt: string }[] };

const money = (value: string) => `${new Intl.NumberFormat("fr-FR").format(BigInt(value))} F CFA`;

export function SaleDetailWorkspace({ saleId }: { saleId: string }) {
  const [sale, setSale] = useState<SaleData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amountXof, setAmountXof] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef<OperationAttempt>(null);
  const reload = useCallback(async () => {
    const response = await fetch(`/api/business/sales/${saleId}`, { cache: "no-store" });
    const body = await response.json() as { sale?: SaleData; error?: string };
    if (!response.ok || !body.sale) throw new Error(body.error || "Vente introuvable.");
    setSale(body.sale);
  }, [saleId]);
  useEffect(() => { void reload().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Impossible de charger la vente.")); }, [reload]);

  async function collect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const settlement = { saleId, amountXof, method };
      const response = await fetch("/api/business/customers/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settlement, idempotencyKey: operationKeyFor(attemptRef, settlement) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Le règlement n’a pas été enregistré.");
      attemptRef.current = null; setAmountXof(""); setNotice("Règlement client enregistré et confirmé manuellement."); await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Le règlement n’a pas été enregistré."); }
    finally { setBusy(false); }
  }

  if (!sale) return <><div className="business-heading"><div><p className="business-kicker">JOURNAL DES VENTES</p><h1>Détail de la vente</h1></div><Link className="business-secondary suite-primary-link" href="/business/sales">Retour aux ventes</Link></div>{error ? <p className="business-alert" role="alert">{error}</p> : <p className="suite-loading">Chargement…</p>}</>;

  return <>
    <div className="business-heading"><div><p className="business-kicker">JOURNAL DES VENTES</p><h1>{sale.reference}</h1><p>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(new Date(sale.occurredAt))} · {sale.customerName ?? "Vente comptant"}</p></div><div className="suite-heading-actions"><Link className="business-secondary suite-primary-link" href="/business/sales">Retour</Link><Link className="business-primary suite-primary-link" href={`/business/sales/${sale.id}/receipt`}>Afficher / imprimer le reçu</Link></div></div>
    {error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}
    <div className="suite-two-column sale-detail-layout">
      <section className="panel suite-panel"><header className="suite-panel-head"><div><h2>Articles vendus</h2><p>Quantités, prix et instantanés conservés à la vente.</p></div></header><div className="sale-detail-lines">{sale.lines.map((line) => <div className="sale-detail-line" key={line.id}><div><strong>{line.productNameSnapshot}</strong><small>{line.variantSnapshot} · {line.quantity} × {money(line.unitPriceXof)}</small></div><strong>{money(line.lineTotalXof)}</strong></div>)}</div><div className="pos-totals sale-detail-totals"><div><span>Sous-total</span><strong>{money(sale.subtotalXof)}</strong></div><div><span>Remise</span><strong>{money(sale.discountXof)}</strong></div><div><span>Total</span><strong>{money(sale.totalXof)}</strong></div><div><span>Confirmé</span><strong>{money((BigInt(sale.totalXof) - BigInt(sale.dueXof)).toString())}</strong></div><div className="pos-balance"><span>Solde restant dû</span><strong>{money(sale.dueXof)}</strong></div></div></section>
      <div className="suite-detail-stack"><section className="panel suite-panel"><header className="suite-panel-head"><div><h2>Règlements</h2><p>Les statuts reflètent la confirmation enregistrée.</p></div></header>{sale.payments.length ? <ul className="suite-payment-list">{sale.payments.map((payment) => <li key={payment.id}><span><strong>{payment.method.replaceAll("_", " ")}</strong><small>{payment.status === "confirmed" ? "Confirmé" : payment.status === "pending" ? "En attente de confirmation externe" : payment.status}</small></span><b>{money(payment.amountXof)}</b></li>)}</ul> : <p className="suite-empty">Aucun règlement enregistré.</p>}{sale.refunds.length > 0 && <div className="suite-refund-list"><h3>Remboursements</h3>{sale.refunds.map((refund) => <p key={refund.id}>{refund.status} · {money(refund.amountXof)}</p>)}</div>}</section>
        {BigInt(sale.dueXof) > 0n && sale.customerId && <section className="panel suite-panel"><header className="suite-panel-head"><div><h2>Enregistrer un règlement</h2><p>{sale.customerName} · solde restant {money(sale.dueXof)}</p></div></header><form className="suite-form" onSubmit={(event) => void collect(event)}><label>Montant reçu (XOF)<input required inputMode="numeric" pattern="[0-9]+" max={sale.dueXof} value={amountXof} onChange={(event) => setAmountXof(event.target.value)} /></label><label>Moyen de paiement<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">Espèces</option><option value="wave">Wave · réception vérifiée manuellement</option><option value="orange_money">Orange Money · réception vérifiée manuellement</option><option value="mtn_momo">MTN MoMo · réception vérifiée manuellement</option><option value="other">Autre</option></select></label><p className="suite-form-help">Ce bouton enregistre une réception que vous avez vérifiée. Il ne consulte pas un compte mobile money.</p><button className="business-primary" disabled={busy}>{busy ? "Enregistrement…" : "Confirmer le règlement reçu"}</button></form></section>}
      </div>
    </div>
  </>;
}
