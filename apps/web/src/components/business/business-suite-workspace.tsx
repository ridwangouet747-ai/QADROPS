"use client";

import { Children, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { operationKeyFor, type OperationAttempt } from "@/lib/client/operation-key";
import { useBusinessRole, type BusinessArea } from "./business-shell";

type Row = Record<string, unknown>;
type Payload = Row & { error?: string };
type ProductRow = { id: string; name: string; description: string | null; categoryId: string | null; categoryName: string | null; baseUnit: string; variantId: string; variantLabel: string; sku: string | null; salePriceXof: string; onHand: string; averageCostXof: string; costKnown: boolean; lowStockThreshold: string };
type CustomerRow = { id: string; name: string; phone: string | null; saleCount: string; balanceXof: string };
type SupplierRow = { id: string; name: string; phone: string | null; purchaseCount: string; purchaseTotalXof: string };
type Settings = { name: string; phone: string | null; address: string | null; email: string | null; primaryColor: string; paperWidthMm: number; showLogo: boolean; receiptFooter: string | null; role?: string };
type SupplierOption = { id: string; name: string };

const paths: Record<string, string> = { sales: "/api/business/sales", customers: "/api/business/customers", suppliers: "/api/business/suppliers", purchases: "/api/business/purchases", expenses: "/api/business/expenses", settings: "/api/business/settings" };
const headings: Record<string, [string, string, string]> = {
  dashboard: ["ACTIVITÉ DU COMMERCE", "Vue d’ensemble", "Les chiffres et alertes issus des opérations enregistrées dans votre espace."],
  products: ["CATALOGUE", "Produits", "Retrouvez vos articles, leurs prix et le niveau de stock associé."],
  sales: ["ENCAISSEMENTS", "Ventes", "Historique des ventes, règlements confirmés et soldes restant dus."],
  customers: ["RELATION CLIENT", "Clients & crédits", "Les comptes clients sont facultatifs pour une vente comptant."],
  stock: ["DISPONIBILITÉ", "Stock", "Niveaux courants et journal traçable des mouvements."],
  suppliers: ["APPROVISIONNEMENT", "Fournisseurs", "Contacts utiles et volumes d’achat reçus."],
  purchases: ["APPROVISIONNEMENT", "Achats reçus", "Chaque réception augmente le stock et actualise le coût moyen pondéré."],
  expenses: ["SUIVI DE CAISSE", "Dépenses", "Charges d’exploitation présentées à part des achats de stock."],
  settings: ["IDENTITÉ DU COMMERCE", "Paramètres", "Coordonnées du commerce et préférences d’impression de ses reçus."],
  modules: ["ESPACE DE TRAVAIL", "Tous les modules", "Accédez aux opérations disponibles pour votre commerce."]
};

const links = [
  ["dashboard", "Vue d’ensemble", "Activité du jour, encaissements et alertes."], ["pos", "Caisse", "Recherche produit, panier, paiement et reçu."],
  ["products", "Produits", "Catalogue, catégories, prix et unités."], ["sales", "Ventes", "Historique, détail, reçu et créances."],
  ["customers", "Clients & crédits", "Comptes clients et soldes à régler."], ["stock", "Stock", "Quantités disponibles et mouvements."],
  ["inventory", "Inventaires", "Comptage, écarts, validation à deux personnes."], ["suppliers", "Fournisseurs", "Contacts d’approvisionnement."],
  ["purchases", "Achats reçus", "Réception des lignes et mise à jour du coût moyen."], ["expenses", "Dépenses", "Enregistrement des charges d’exploitation."],
  ["reports", "Rapports", "Périodes, flux financiers et export CSV."], ["opening", "Démarrage", "Stock de départ et anciennes dettes."], ["settings", "Paramètres", "Identité du commerce et format de reçu."],
] as const;

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  try { return `${new Intl.NumberFormat("fr-FR").format(BigInt(String(value)))} F CFA`; } catch { return "—"; }
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Abidjan" }).format(date);
}

function PageHeading({ section, action }: { section: string; action?: ReactNode }) {
  const [kicker, title, description] = headings[section] ?? headings.modules;
  return <div className="business-heading"><div><p className="business-kicker">{kicker}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Panel({ title, detail, action, children, className = "" }: { title: string; detail?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel suite-panel ${className}`}><header className="suite-panel-head"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>{children}</section>;
}

function DataTable({ columns, children, empty = "Aucune opération enregistrée pour le moment." }: { columns: string[]; children: ReactNode; empty?: string }) {
  const hasRows = Children.count(children) > 0;
  return <div className="suite-table-scroll"><table className="suite-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody>{!hasRows && <tfoot><tr><td colSpan={columns.length}>{empty}</td></tr></tfoot>}</table></div>;
}

export function BusinessSuiteWorkspace({ section }: { section: Exclude<BusinessArea, "dashboard" | "pos" | "products" | "stock" | "inventory" | "reports"> }) {
  const role = useBusinessRole();
  const canManageCustomers = ["owner", "admin", "cashier"].includes(role);
  const canManageSuppliers = ["owner", "admin", "stock_manager"].includes(role);
  const canManageExpenses = ["owner", "admin", "accountant"].includes(role);
  const canManageSettings = ["owner", "admin"].includes(role);
  const endpoint = paths[section];
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef<OperationAttempt>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [customerDraft, setCustomerDraft] = useState({ name: "", phone: "" });
  const [supplierDraft, setSupplierDraft] = useState({ name: "", phone: "" });
  const [expenseDraft, setExpenseDraft] = useState({ category: "transport", description: "", amountXof: "" });
  const [purchaseDraft, setPurchaseDraft] = useState({ supplierId: "", variantId: "", quantity: "1", unitCostXof: "", reference: `ACH-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-01`, paidXof: "0", paymentMethod: "cash" });
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [productOptions, setProductOptions] = useState<ProductRow[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);

  const reload = useCallback(async () => {
    if (!endpoint) return;
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = await response.json() as Payload;
      if (!response.ok) throw new Error(result.error || "Impossible de charger ces données.");
      setData(result);
      if (section === "settings" && result.settings) setSettingsDraft(result.settings as unknown as Settings);
      if (section === "purchases" && Array.isArray(result.suppliers)) {
        setPurchaseDraft((current) => ({ ...current, supplierId: current.supplierId || String((result.suppliers as Row[])[0]?.id ?? "") }));
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Une erreur empêche le chargement."); }
  }, [endpoint, section]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (section !== "purchases") return;
    let active = true;
    void Promise.all([fetch("/api/business/products", { cache: "no-store" }), fetch("/api/business/suppliers", { cache: "no-store" })]).then(async ([productsResponse, suppliersResponse]) => {
      const [result, supplierResult] = await Promise.all([productsResponse.json(), suppliersResponse.json()]) as [Payload, Payload];
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
      const result = await response.json() as Payload;
      if (!response.ok) throw new Error(result.error || "L’opération n’a pas abouti.");
      if (idempotent) attemptRef.current = null;
      setNotice(success); await reload();
      if (section === "customers") setCustomerDraft({ name: "", phone: "" });
      if (section === "suppliers") setSupplierDraft({ name: "", phone: "" });
      if (section === "expenses") setExpenseDraft({ category: "transport", description: "", amountXof: "" });
      if (section === "purchases") setPurchaseDraft((current) => ({ ...current, reference: `ACH-${Date.now().toString().slice(-8)}`, quantity: "1", unitCostXof: "", paidXof: "0" }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "L’opération n’a pas abouti."); }
    finally { setBusy(false); }
  }

  if (section === "modules") {
    const permissions: Record<string, string[]> = { owner: links.map(([key]) => key), admin: links.map(([key]) => key), stock_manager: ["dashboard", "products", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "reports", "opening"], accountant: ["dashboard", "sales", "customers", "stock", "inventory", "suppliers", "purchases", "expenses", "reports"], cashier: ["pos", "products", "sales", "customers", "stock"], member: ["products", "sales", "customers", "stock", "inventory", "suppliers", "purchases"] };
    const allowed = permissions[role] ?? permissions.member;
    return <><PageHeading section={section} /><div className="suite-module-grid">{links.filter(([key]) => allowed.includes(key)).map(([key, label, description], index) => <Link className="suite-module-link" href={`/business/${key}`} key={key}><span className="suite-module-index">{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><span>{description}</span><b aria-hidden="true">↗</b></Link>)}</div></>;
  }

  if (section === "sales") {
    const rows = (data?.sales as Row[] | undefined) ?? [];
    return <><PageHeading section={section} action={<Link className="business-primary suite-primary-link" href="/business/pos">Nouvelle vente</Link>} />{error && <p className="business-alert" role="alert">{error}</p>}
      <Panel title="Journal des ventes" detail={`${rows.length} opération(s) affichée(s)`}><DataTable columns={["Référence", "Client", "Date", "Total", "Confirmé", "À régler", "Reçu"]} empty={data ? "Aucune vente enregistrée." : "Chargement…"}>{rows.map((row) => <tr key={String(row.id)}><td><Link href={`/business/sales/${row.id}`}>{String(row.reference)}</Link></td><td>{String(row.customerName ?? "Comptant")}</td><td>{dateTime(row.occurredAt)}</td><td>{money(row.totalXof)}</td><td>{money(row.paidXof)}</td><td>{money(row.dueXof)}</td><td><Link className="suite-text-link" href={`/business/sales/${row.id}/receipt`}>Imprimer</Link></td></tr>)}</DataTable></Panel>
    </>;
  }

  if (section === "customers") {
    const rows = (data?.customers as CustomerRow[] | undefined) ?? [];
    return <><PageHeading section={section} action={<Link className="business-secondary suite-primary-link" href="/business/pos">Vente comptant sans client</Link>} />{error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}
        <div className="suite-two-column">{canManageCustomers && <Panel title="Nouveau client" detail="Créer une fiche seulement si le suivi le nécessite."><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/customers", "POST", customerDraft, "Client ajouté.")}><label>Nom du client<input required maxLength={160} value={customerDraft.name} onChange={(event) => setCustomerDraft({ ...customerDraft, name: event.target.value })} /></label><label>Téléphone (facultatif)<input type="tel" maxLength={60} value={customerDraft.phone} onChange={(event) => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /></label><button className="business-primary" disabled={busy}>{busy ? "Enregistrement…" : "Ajouter le client"}</button></form></Panel>}
        <Panel title="Comptes clients" detail="Le solde est recalculé depuis les ventes et paiements confirmés."><DataTable columns={["Client", "Téléphone", "Ventes", "Solde dû"]} empty={data ? "Aucun client enregistré." : "Chargement…"}>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.phone || "—"}</td><td>{row.saleCount}</td><td className={BigInt(row.balanceXof) > 0n ? "suite-due" : ""}>{money(row.balanceXof)}</td></tr>)}</DataTable></Panel></div>
      <p className="business-footnote">Un règlement mobile saisi manuellement correspond à une réception vérifiée par l’équipe. Les paiements initiés via un fournisseur externe restent en attente tant qu’aucune intégration ne les confirme.</p>
    </>;
  }

  if (section === "suppliers") {
    const rows = (data?.suppliers as SupplierRow[] | undefined) ?? [];
    return <><PageHeading section={section} />{error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}<div className="suite-two-column">{canManageSuppliers && <Panel title="Ajouter un fournisseur"><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/suppliers", "POST", supplierDraft, "Fournisseur ajouté.")}><label>Nom ou raison sociale<input required maxLength={160} value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })} /></label><label>Téléphone<input type="tel" maxLength={60} value={supplierDraft.phone} onChange={(event) => setSupplierDraft({ ...supplierDraft, phone: event.target.value })} /></label><button className="business-primary" disabled={busy}>Enregistrer le fournisseur</button></form></Panel>}<Panel title="Fournisseurs actifs"><DataTable columns={["Fournisseur", "Téléphone", "Achats reçus", "Montant total"]} empty={data ? "Aucun fournisseur enregistré." : "Chargement…"}>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.phone ?? "—"}</td><td>{row.purchaseCount}</td><td>{money(row.purchaseTotalXof)}</td></tr>)}</DataTable></Panel></div></>;
  }

  if (section === "purchases") {
    const rows = (data?.purchases as Row[] | undefined) ?? []; const suppliers = supplierOptions;
    return <><PageHeading section={section} />{error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}<div className="suite-two-column">{canManageSuppliers && <Panel title="Réceptionner un achat" detail="La réception actualise le stock et son coût moyen pondéré."><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/purchases", "POST", { ...purchaseDraft, lines: [{ variantId: purchaseDraft.variantId, quantity: purchaseDraft.quantity, unitCostXof: purchaseDraft.unitCostXof }] }, "Approvisionnement reçu ; stock et coût moyen mis à jour.", true)}>
      <label>Fournisseur<select required value={purchaseDraft.supplierId} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, supplierId: event.target.value })}><option value="">Choisir…</option>{suppliers.map((row) => <option value={String(row.id)} key={String(row.id)}>{String(row.name)}</option>)}</select></label><label>Référence d’achat<input required value={purchaseDraft.reference} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, reference: event.target.value })} /></label>
      <label>Article / variante<select required value={purchaseDraft.variantId} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, variantId: event.target.value })}><option value="">Choisir…</option>{productOptions.map((row) => <option value={row.variantId} key={row.variantId}>{row.name} · {row.variantLabel} ({row.sku ?? "sans SKU"})</option>)}</select></label><div className="suite-form-row"><label>Quantité reçue<input required inputMode="decimal" pattern="[0-9]+(\\.[0-9]{1,6})?" value={purchaseDraft.quantity} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, quantity: event.target.value })} /></label><label>Coût unitaire (XOF)<input required inputMode="numeric" pattern="[0-9]+" value={purchaseDraft.unitCostXof} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, unitCostXof: event.target.value })} /></label></div><div className="suite-form-row"><label>Payé au fournisseur<input inputMode="numeric" pattern="[0-9]*" value={purchaseDraft.paidXof} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, paidXof: event.target.value })} /></label><label>Mode de règlement<select value={purchaseDraft.paymentMethod} onChange={(event) => setPurchaseDraft({ ...purchaseDraft, paymentMethod: event.target.value })}><option value="cash">Espèces</option><option value="wave">Wave (saisie manuelle)</option><option value="orange_money">Orange Money (saisie manuelle)</option><option value="mtn_momo">MTN MoMo (saisie manuelle)</option><option value="other">Autre</option></select></label></div><button className="business-primary" disabled={busy || !suppliers.length || !productOptions.length}>{busy ? "Réception en cours…" : "Confirmer la réception"}</button>
      </form>{!suppliers.length && <p className="suite-form-help">Ajoutez d’abord un fournisseur dans le module Fournisseurs.</p>}</Panel>}
      <Panel title="Derniers achats" detail="Les achats de stock sont séparés des dépenses d’exploitation."><DataTable columns={["Référence", "Fournisseur", "Date", "Total reçu", "Règlement"]} empty={data ? "Aucun achat réceptionné." : "Chargement…"}>{rows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.reference)}</strong></td><td>{String(row.supplierName)}</td><td>{dateTime(row.occurredAt)}</td><td>{money(row.totalXof)}</td><td>{money(row.paidXof)}</td></tr>)}</DataTable></Panel></div></>;
  }

  if (section === "expenses") {
    const rows = (data?.expenses as Row[] | undefined) ?? [];
    return <><PageHeading section={section} />{error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}<div className="suite-two-column">{canManageExpenses && <Panel title="Nouvelle dépense" detail="N’enregistrez pas l’achat de marchandises comme charge courante."><form className="suite-form" onSubmit={(event) => void submit(event, "/api/business/expenses", "POST", expenseDraft, "Dépense enregistrée.", true)}><label>Catégorie<select value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })}><option value="transport">Transport</option><option value="rent">Loyer</option><option value="utilities">Électricité / eau</option><option value="supplies">Fournitures</option><option value="other">Autre</option></select></label><label>Description<input required maxLength={240} value={expenseDraft.description} onChange={(event) => setExpenseDraft({ ...expenseDraft, description: event.target.value })} /></label><label>Montant (XOF)<input required inputMode="numeric" pattern="[0-9]+" value={expenseDraft.amountXof} onChange={(event) => setExpenseDraft({ ...expenseDraft, amountXof: event.target.value })} /></label><button className="business-primary" disabled={busy}>Enregistrer la dépense</button></form></Panel>}<Panel title="Dépenses récentes"><DataTable columns={["Date", "Catégorie", "Description", "Montant"]} empty={data ? "Aucune dépense saisie." : "Chargement…"}>{rows.map((row) => <tr key={String(row.id)}><td>{dateTime(row.occurredAt)}</td><td>{String(row.category)}</td><td>{String(row.description)}</td><td>{money(row.amountXof)}</td></tr>)}</DataTable></Panel></div></>;
  }

  if (section === "settings") {
    const settings = settingsDraft ?? data?.settings as Settings | undefined;
    return <><PageHeading section={section} />{error && <p className="business-alert" role="alert">{error}</p>}{notice && <p className="business-notice" role="status">{notice}</p>}{settings && <form className="suite-settings" onSubmit={(event) => void submit(event, "/api/business/settings", "PATCH", { ...settings, email: settings.email || "", receiptFooter: settings.receiptFooter || null }, "Paramètres du commerce enregistrés.")}>
      <Panel title="Profil commercial" detail="Ces informations identifient votre commerce dans les pages et documents."><div className="suite-form-grid"><label>Nom commercial<input required value={settings.name} onChange={(event) => setSettingsDraft({ ...settings, name: event.target.value })} /></label><label>Téléphone professionnel<input type="tel" value={settings.phone ?? ""} onChange={(event) => setSettingsDraft({ ...settings, phone: event.target.value || null })} /></label><label className="suite-span-two">Adresse<input value={settings.address ?? ""} onChange={(event) => setSettingsDraft({ ...settings, address: event.target.value || null })} /></label><label>E-mail professionnel<input type="email" value={settings.email ?? ""} onChange={(event) => setSettingsDraft({ ...settings, email: event.target.value || null })} /></label><label>Devise<select value="XOF" disabled><option>XOF — Franc CFA BCEAO</option></select></label><label>Fuseau horaire<select value="Africa/Abidjan" disabled><option>Africa/Abidjan</option></select></label><label>Couleur principale<input type="color" value={settings.primaryColor} onChange={(event) => setSettingsDraft({ ...settings, primaryColor: event.target.value })} /></label></div></Panel>
      <Panel title="Reçu thermique" detail="L’impression s’effectue depuis le navigateur ; aucune imprimante n’est détectée automatiquement."><div className="suite-form-grid"><label>Largeur du ticket<select value={settings.paperWidthMm} onChange={(event) => setSettingsDraft({ ...settings, paperWidthMm: Number(event.target.value) })}><option value={58}>58 mm</option><option value={80}>80 mm</option></select></label><label className="suite-checkbox"><input type="checkbox" checked={settings.showLogo} onChange={(event) => setSettingsDraft({ ...settings, showLogo: event.target.checked })} />Afficher le logo du commerce (si configuré)</label><label className="suite-span-two">Message de pied de ticket<textarea maxLength={300} value={settings.receiptFooter ?? ""} onChange={(event) => setSettingsDraft({ ...settings, receiptFooter: event.target.value || null })} /></label></div><div className="suite-receipt-preview"><small>APERÇU DU REÇU</small><strong>{settings.name}</strong><span>{settings.phone || "Téléphone à renseigner"}</span><span>Vente · 12 500 F CFA</span><em>{settings.receiptFooter || "Merci de votre visite"}</em><span>{settings.paperWidthMm} mm · exemple de mise en page</span></div></Panel>
      <div className="suite-save-row"><span>XOF · Africa/Abidjan</span>{canManageSettings ? <button className="business-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer les paramètres"}</button> : <span>Lecture seule selon votre rôle.</span>}</div>
    </form>}{!settings && !error && <p className="suite-loading">Chargement des paramètres…</p>}</>;
  }

  return <><PageHeading section={section} /><p className="suite-empty">Cette section n’est pas disponible.</p></>;
}
