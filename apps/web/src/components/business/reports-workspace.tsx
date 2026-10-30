"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Report = {
  timezone: string; period: string; startDate: string; endDate: string; generatedAt: string;
  sales: { revenueXof: string; count: string; averageBasketXof: string | null; discountXof: string; previousRevenueXof: string; changeXof: string; changePercent: string | null };
  settlement: { paid: string; partial: string; credit: string };
  collections: { totalXof: string; byMethod: { method: string; amountXof: string }[] };
  receivablesAsOf: { asOf: string; totalXof: string; count: string };
  refunds: { totalXof: string; count: string }; expenses: { totalXof: string; count: string }; purchases: { totalXof: string; count: string };
  grossMarginEstimate: { available: boolean; amountXof: string | null; note: string };
  topProducts: { name: string; quantity: string; revenueXof: string }[];
  inventoryVariance: { gainQty: string; lossQty: string; validatedSessionCount: string };
  trend: { date: string; revenueXof: string }[];
};
const methods: Record<string, string> = { cash: "Espèces", wave: "Wave", orange_money: "Orange Money", mtn_momo: "MTN MoMo", other: "Autre" };
const fmtXof = (value: string | null) => value === null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(BigInt(value))} F CFA`;
const fmtQuantity = (value: string) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const scaled = BigInt(match[2]!) * 1_000_000n + BigInt((match[3] ?? "").slice(0, 6).padEnd(6, "0"));
  const roundedThousandths = (scaled + 500n) / 1_000n;
  const whole = roundedThousandths / 1_000n;
  const fraction = (roundedThousandths % 1_000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${match[1]}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(whole)}${fraction ? `,${fraction}` : ""}`;
};

export function ReportsWorkspace() {
  const [period, setPeriod] = useState("monthly");
  const [date, setDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === "custom") { if (startDate) params.set("startDate", startDate); if (endDate) params.set("endDate", endDate); }
    else if (date) params.set("date", date);
    return params.toString();
  }, [period, date, startDate, endDate]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    void fetch(`/api/business/reports?${query}`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { report?: Report; error?: string };
      if (!response.ok || !body.report) throw new Error(body.error ?? "Impossible de charger les rapports.");
      if (alive) setReport(body.report);
    }).catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : "Impossible de charger les rapports."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query]);

  const exportHref = `/api/business/reports/export?${query}&format=csv`;
  const maxTrend = report?.trend.reduce((max, row) => BigInt(row.revenueXof) > max ? BigInt(row.revenueXof) : max, 0n) ?? 0n;
  const trendBars = report?.trend.map((row) => ({ ...row, width: `${maxTrend === 0n ? 0 : Number((BigInt(row.revenueXof) * 100n) / maxTrend)}%` })) ?? [];

  return <div className="reports-workspace">
      <div className="business-heading"><div><p className="business-kicker">ACTIVITÉ · ENCAISSEMENTS · CONTRÔLE</p><h1>Rapports commerciaux</h1><p>Une lecture claire des ventes et des flux réels, avec les remboursements, les créances, les achats et les dépenses séparés.</p></div><span className="business-heading-mark" aria-hidden="true">02</span></div>
      <section className="report-filter panel" aria-label="Période du rapport"><div className="report-period-tabs" role="group" aria-label="Choisir une période">{[["daily", "Jour"], ["weekly", "Semaine"], ["monthly", "Mois"], ["yearly", "Année"], ["custom", "Personnalisée"]].map(([value, label]) => <button key={value} className={period === value ? "period-tab is-active" : "period-tab"} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div><div className="report-date-fields">{period === "custom" ? <><label>Du <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Au <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></> : <label>Date de référence <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}{report && <span className="report-timezone">{report.startDate} → {report.endDate} · {report.timezone}</span>}</div></section>
      {error && <p className="business-alert" role="alert">{error}</p>}
      {loading && <p className="report-loading" role="status">Actualisation des chiffres…</p>}
      {report && <>
        <div className="report-actions"><p>Mis à jour le {new Date(report.generatedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</p><div><a className="business-secondary export-link" href={exportHref}>Télécharger CSV</a><button className="business-secondary screen-only" onClick={() => window.print()}>Imprimer / PDF</button></div></div>
        <section className="report-metrics" aria-label="Indicateurs des ventes"><article className="metric-card metric-featured"><span>CHIFFRE D’AFFAIRES</span><strong>{fmtXof(report.sales.revenueXof)}</strong><small>{report.sales.count} vente{report.sales.count === "1" ? "" : "s"} · remises déduites, avant remboursements</small><div className="metric-comparison"><span>vs période précédente</span><b>{fmtXof(report.sales.changeXof)}</b><small>{report.sales.changePercent === null ? "Comparaison indisponible : aucune vente antérieure." : `${(Number(report.sales.changePercent) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`}</small></div></article>
          <article className="metric-card"><span>ENCAISSEMENTS CONFIRMÉS</span><strong>{fmtXof(report.collections.totalXof)}</strong><small>À la date de confirmation, tous moyens confondus.</small></article>
          <article className="metric-card"><span>CRÉANCES OUVERTES</span><strong>{fmtXof(report.receivablesAsOf.totalXof)}</strong><small>{report.receivablesAsOf.count} vente{report.receivablesAsOf.count === "1" ? "" : "s"} à crédit · solde à la fin de période.</small></article>
          <article className="metric-card"><span>PANIER MOYEN</span><strong>{fmtXof(report.sales.averageBasketXof)}</strong><small>Chiffre d’affaires de la période ÷ ventes finalisées.</small></article>
        </section>
        <div className="report-grid">
          <section className="panel report-chart-panel"><div className="panel-title-row"><div><p className="panel-eyebrow">ÉVOLUTION</p><h2>Ventes dans la période</h2></div><span className="report-chart-unit">F CFA</span></div>{trendBars.length ? <div className="trend-list" role="list" aria-label="Chiffre d’affaires par période">{trendBars.map((row) => <div className="trend-row" role="listitem" key={row.date}><time>{report.period === "yearly" ? new Date(`${row.date}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }) : new Date(`${row.date}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}</time><div className="trend-track"><i style={{ "--trend-width": row.width } as CSSProperties} /></div><strong>{fmtXof(row.revenueXof)}</strong></div>)}</div> : <p className="empty-copy">Aucune vente finalisée sur cette période.</p>}</section>
          <section className="panel collection-panel"><div className="panel-title-row"><div><p className="panel-eyebrow">ARGENT REÇU</p><h2>Par moyen de paiement</h2></div></div>{report.collections.byMethod.length ? <ul className="collection-list">{report.collections.byMethod.map((row) => <li key={row.method}><span><i className={`method-dot method-${row.method}`} aria-hidden="true" />{methods[row.method] ?? row.method}</span><strong>{fmtXof(row.amountXof)}</strong></li>)}</ul> : <p className="empty-copy">Aucun paiement confirmé sur cette période.</p>}<div className="settlement-summary"><span>Ventes entièrement payées <b>{report.settlement.paid}</b></span><span>Ventes partiellement payées <b>{report.settlement.partial}</b></span><span>Ventes à crédit <b>{report.settlement.credit}</b></span></div></section>
          <section className="panel report-table-panel"><div className="panel-title-row"><div><p className="panel-eyebrow">ARTICLES</p><h2>Produits les plus vendus</h2></div><span className="quiet-count">Top 10</span></div>{report.topProducts.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th scope="col">Produit</th><th scope="col">Quantité</th><th scope="col">Chiffre d’affaires</th></tr></thead><tbody>{report.topProducts.map((row, index) => <tr key={`${row.name}-${index}`}><th scope="row"><span className="product-rank">{String(index + 1).padStart(2, "0")}</span>{row.name}</th><td>{fmtQuantity(row.quantity)}</td><td>{fmtXof(row.revenueXof)}</td></tr>)}</tbody></table></div> : <p className="empty-copy">Les produits vendus apparaîtront après les premières ventes.</p>}</section>
          <section className="panel report-flows-panel"><div className="panel-title-row"><div><p className="panel-eyebrow">AUTRES FLUX</p><h2>À distinguer du chiffre d’affaires</h2></div></div><dl className="flow-list"><div><dt>Remboursements confirmés</dt><dd>{fmtXof(report.refunds.totalXof)}<small>{report.refunds.count} opération{report.refunds.count === "1" ? "" : "s"} · date du remboursement</small></dd></div><div><dt>Dépenses</dt><dd>{fmtXof(report.expenses.totalXof)}<small>{report.expenses.count} enregistrement{report.expenses.count === "1" ? "" : "s"} · période d’occurrence</small></dd></div><div><dt>Achats fournisseurs reçus</dt><dd>{fmtXof(report.purchases.totalXof)}<small>{report.purchases.count} réception{report.purchases.count === "1" ? "" : "s"} · présenté séparément des dépenses</small></dd></div><div><dt>Marge brute estimée</dt><dd>{fmtXof(report.grossMarginEstimate.amountXof)}<small>{report.grossMarginEstimate.note}</small></dd></div><div><dt>Écarts de stock validés</dt><dd><span className="variance-loss">−{fmtQuantity(report.inventoryVariance.lossQty)}</span> · <span className="variance-gain">+{fmtQuantity(report.inventoryVariance.gainQty)}</span><small>{report.inventoryVariance.validatedSessionCount} session{report.inventoryVariance.validatedSessionCount === "1" ? "" : "s"} validée{report.inventoryVariance.validatedSessionCount === "1" ? "" : "s"}</small></dd></div></dl></section>
        </div>
        <p className="business-footnote">Les ventes sont datées à leur enregistrement, les paiements à leur confirmation et les remboursements à leur occurrence. Les achats ne sont pas assimilés à des charges. Une marge est masquée dès qu’un coût manque ; aucun bénéfice net n’est calculé.</p>
      </>}
  </div>;
}
