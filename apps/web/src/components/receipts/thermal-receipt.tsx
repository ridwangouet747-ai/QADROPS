"use client";

import { useState } from "react";
import Image from "next/image";

type ReceiptData = Awaited<ReturnType<typeof import("@/lib/domain/receipt").getSaleReceipt>>;

const formatXof = (amount: bigint | string) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(BigInt(amount))} F`;
const paymentNames: Record<string, string> = { cash: "Espèces", wave: "Wave", orange_money: "Orange Money", mtn_momo: "MTN MoMo", other: "Autre" };
const paymentStatuses: Record<string, string> = { pending: "· en attente", failed: "· échoué", refunded: "· remboursé", partially_refunded: "· partiellement remboursé" };

export function ThermalReceipt({ data }: { data: ReceiptData }) {
  const [width, setWidth] = useState<58 | 80>(data.business.paperWidthMm === 80 ? 80 : 58);
  const [printError, setPrintError] = useState("");

  function printReceipt() {
    setPrintError("");
    try {
      if (typeof window.print !== "function") throw new Error("La boîte de dialogue d’impression n’est pas disponible dans ce navigateur.");
      window.print();
    } catch {
      setPrintError("Impression indisponible. Vérifiez le navigateur ou utilisez l’option « Enregistrer au format PDF » du dialogue d’impression.");
    }
  }

  const paid = data.payments.filter((part) => part.status === "confirmed").reduce((sum, part) => sum + BigInt(part.amountXof), 0n);
  const due = data.sale.totalXof - paid;
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.sale.occurredAt));

  return (
    <main className="receipt-page">
      <div className="receipt-controls" aria-label="Options du reçu">
        <div className="receipt-width-control" role="group" aria-label="Largeur du papier">
          <button type="button" aria-pressed={width === 58} onClick={() => setWidth(58)}>58 mm</button>
          <button type="button" aria-pressed={width === 80} onClick={() => setWidth(80)}>80 mm</button>
        </div>
        <button className="receipt-print-button" type="button" onClick={printReceipt}>Imprimer ou enregistrer en PDF</button>
      </div>
      <p className="receipt-note-screen">Aperçu du reçu enregistré · Réimprimer ne crée aucune nouvelle vente.</p>
      {printError && <p className="receipt-print-error" role="alert">{printError}</p>}
      <article className="thermal-receipt" style={{ "--receipt-width": `${width}mm` } as React.CSSProperties} aria-label={`Reçu ${data.sale.reference}`}>
        <header className="thermal-receipt-header">
          {data.business.showLogo && data.business.logo && <Image src={data.business.logo} alt={`Logo de ${data.business.name}`} width={180} height={80} unoptimized />}
          <h1>{data.business.name}</h1>
          {data.business.address && <p>{data.business.address}</p>}
          {data.business.phone && <p>{data.business.phone}</p>}
          {data.business.email && <p>{data.business.email}</p>}
        </header>
        <div className="thermal-receipt-reference"><span>Vente</span><strong>{data.sale.reference}</strong></div>
        <p className="thermal-receipt-date">{date}</p>
        <table className="thermal-receipt-lines">
          <thead><tr><th>Article</th><th>Qté</th><th>Total</th></tr></thead>
          <tbody>{data.lines.map((line, index) => (
            <tr key={`${line.name}-${index}`}>
              <td>{line.name}{line.variant !== "Standard" && <small>{line.variant}</small>}<small>{formatXof(line.unitPriceXof)} / unité</small></td>
              <td>{line.quantity}</td><td>{formatXof(line.totalXof)}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="thermal-receipt-total"><span>Total</span><strong>{formatXof(data.sale.totalXof)}</strong></div>
        <section className="thermal-receipt-payments" aria-label="Détail des paiements">
          <h2>Paiement</h2>
          {data.payments.map((part, index) => <p key={`${part.method}-${index}`}><span>{paymentNames[part.method] ?? part.method} {paymentStatuses[part.status] ?? ""}</span><strong>{formatXof(part.amountXof)}</strong></p>)}
          <p className="thermal-receipt-balance"><span>Reçu</span><strong>{formatXof(paid)}</strong></p>
          {due > 0n && <p className="thermal-receipt-balance"><span>Reste dû</span><strong>{formatXof(due)}</strong></p>}
        </section>
        {data.business.footer && <footer className="thermal-receipt-footer">{data.business.footer}</footer>}
        <p className="thermal-receipt-thanks">Merci et à bientôt</p>
      </article>
    </main>
  );
}
