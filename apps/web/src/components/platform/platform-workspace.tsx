"use client";

import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./platform-workspace.module.css";

type Section = "dashboard" | "businesses" | "subscriptions" | "plans" | "promotions" | "audit";
type Business = { businessId: string; name: string; activity: string; status: string; createdAt: string; subscription: null | { status: string; endsAt: string; planName: string } };
type Plan = { id: string; code: string; name: string; priceXof: string; durationDays: number; active: boolean; features: { pos: boolean; reports: boolean; inventory: boolean; procurement: boolean; productLimit: number | null; userLimit: number | null } };
type Promotion = { id: string; code: string; discountPercent: number | null; discountXof: string | null; startsAt: string; endsAt: string | null; maxRedemptions: number | null; active: boolean; useCount: number; state: string; eligibleBusinesses: Array<{ businessId: string; businessName: string }>; redemptions: Array<{ id: string; businessName: string; discountAmountXof: string; redeemedAt: string }> };
type Dashboard = { businesses: Record<string, number>; subscriptions: Record<string, number>; trials: { current: number; expired: number }; confirmedSaasPayments: { count: number; amountXof: string }; recentEvents: Array<{ id: string; eventType: string; entityType: string; occurredAt: string }>; incidents: { available: boolean; message: string } };
type Subscription = { id: string; businessName: string; status: string; startsAt: string; endsAt: string; trialEndsAt: string | null; planName: string; planPriceXof: string; payments: Array<{ status: string; amountXof: string; occurredAt: string }> };
type AuditEntry = { id: string; eventType: string; entityType: string; entityId: string; metadata: Record<string, unknown>; occurredAt: string };

const nav: Array<{ id: Section; label: string; path: string; icon: string }> = [
  { id: "dashboard", label: "Vue d’ensemble", path: "/platform", icon: "M3 3h7v7H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 14h7v7H3z" },
  { id: "businesses", label: "Commerces", path: "/platform/businesses", icon: "M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6 M9 9h.01 M15 9h.01" },
  { id: "subscriptions", label: "Abonnements", path: "/platform/subscriptions", icon: "M4 5h16v14H4z M8 9h8 M8 13h5" },
  { id: "plans", label: "Forfaits", path: "/platform/plans", icon: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h4" },
  { id: "promotions", label: "Promotions", path: "/platform/promotions", icon: "M20 12 12 4H4v8l8 8 8-8Z M8 8h.01" },
  { id: "audit", label: "Journal d’activité", path: "/platform/audit", icon: "M4 5h16 M4 12h16 M4 19h16 M7 5v.01 M7 12v.01 M7 19v.01" },
];
const descriptions: Record<Section, string> = {
  dashboard: "État de la plateforme calculé à partir des espaces et abonnements enregistrés.",
  businesses: "Consultez les espaces et leurs informations administratives. Les données métier privées restent hors de cette console.",
  subscriptions: "Suivez les abonnements SaaS, séparés des encaissements des commerces.",
  plans: "Gérez les offres et les fonctionnalités réellement disponibles par forfait.",
  promotions: "Gérez les codes, leurs limites et leurs utilisations enregistrées.",
  audit: "Historique des actions administratives et événements plateforme disponibles.",
};
const money = (v: string | number) => new Intl.NumberFormat("fr-FR").format(Number(v)) + " F CFA";
const date = (v?: string | null) => v ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(v)) : "—";
const statuses: Record<string, string> = { active: "Actif", suspended: "Suspendu", pending: "En attente", expired: "Expiré", canceled: "Annulé", confirmed: "Confirmé", failed: "Échoué", refunded: "Remboursé", disabled: "Désactivé", scheduled: "Programmé" };
const activities: Record<string, string> = { hardware: "Quincaillerie", phones: "Téléphones", general: "Boutique générale", clothing: "Vêtements" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "La demande n’a pas pu être traitée.");
  }
  return response.json() as Promise<T>;
}
function Icon({ path }: { path: string }) { return <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}><path d={path} /></svg>; }
function Badge({ value }: { value: string }) { return <span className={styles.badge + " " + (styles["status_" + value] || "")}>{statuses[value] || value}</span>; }
function ErrorNotice({ children }: { children: string }) { return <p className={styles.error} role="alert">{children}</p>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}><span /><p>{text}</p></div>; }

export function PlatformWorkspace({ section, preview }: { section: Section; preview: boolean }) {
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [data, setData] = useState<unknown>(null); const [merchants, setMerchants] = useState<Business[]>([]);
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("all");
  const [mobileMenu, setMobileMenu] = useState(false); const [busyId, setBusyId] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null); const [showCreate, setShowCreate] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (section === "dashboard") setData(await api<Dashboard>("/api/platform/dashboard"));
      else if (section === "businesses") {
        const query = new URLSearchParams(); if (search) query.set("q", search); if (filter !== "all") query.set("status", filter);
        const result = await api<Business[]>("/api/platform/businesses?" + query.toString()); setMerchants(result); setData(result);
      } else if (section === "subscriptions") setData((await api<{ subscriptions: Subscription[] }>("/api/platform/subscriptions")).subscriptions);
      else if (section === "plans") setData(await api<Plan[]>("/api/platform/plans"));
      else if (section === "promotions") {
        const results = await Promise.all([api<Promotion[]>("/api/platform/promotions"), api<Business[]>("/api/platform/businesses")]);
        setMerchants(results[1]); setData(results[0]);
      } else setData(await api<AuditEntry[]>("/api/platform/audit"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur inattendue."); }
    finally { setLoading(false); }
  }, [section, search, filter]);
  useEffect(() => { void load(); }, [load]);

  async function statusAction(item: Business) {
    const next = item.status === "suspended" ? "active" : "suspended";
    if (!window.confirm((next === "suspended" ? "Suspendre" : "Réactiver") + " l’espace « " + item.name + " » ? L’action sera journalisée.")) return;
    setBusyId(item.businessId); setError(""); setNotice("");
    try { await api("/api/platform/businesses/" + encodeURIComponent(item.businessId), { method: "PATCH", body: JSON.stringify({ status: next }) }); setNotice("Espace mis à jour et action journalisée."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action impossible."); }
    finally { setBusyId(""); }
  }
  async function openDetail(id: string) {
    setDetail(null); setError("");
    try { setDetail(await api<Record<string, unknown>>("/api/platform/businesses/" + encodeURIComponent(id))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Fiche indisponible."); }
  }
  async function togglePlan(plan: Plan) {
    setBusyId(plan.id);
    try { await api("/api/platform/plans/" + plan.id, { method: "PATCH", body: JSON.stringify({ active: !plan.active }) }); setNotice("Forfait " + (plan.active ? "désactivé." : "activé.")); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusyId(""); }
  }

  const title = nav.find((item) => item.id === section)?.label || "Administration plateforme";
  return <main className={styles.frame}>
    <aside className={styles.sidebar + (mobileMenu ? " " + styles.sidebarOpen : "")}>
      <Link href="/platform" className={styles.brand}><span className={styles.brandMark}><i /><i /><i /></span><span>QADR OPS<small>ADMINISTRATION PLATEFORME</small></span></Link>
      <div className={styles.sidebarLabel}>GESTION SAAS</div>
      <nav className={styles.nav} aria-label="Navigation plateforme">{nav.map((item) => <Link key={item.id} href={item.path} onClick={() => setMobileMenu(false)} aria-current={section === item.id ? "page" : undefined} className={styles.navItem + (section === item.id ? " " + styles.navActive : "")}><Icon path={item.icon} /><span>{item.label}</span></Link>)}</nav>
      <div className={styles.sidebarFoot}><span />Console réservée aux administrateurs autorisés</div>
    </aside>
    <div className={styles.main}>
      <header className={styles.header}><button type="button" className={styles.menuButton} aria-label="Ouvrir la navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}><Icon path="M4 7h16 M4 12h16 M4 17h16" /></button><div className={styles.crumb}>Plateforme <span>/</span> {title}</div><div className={styles.headerRight}><span className={styles.scope}>Espace séparé des commerces</span><span className={styles.avatar}>SA</span></div></header>
      {preview && <div className={styles.previewBanner}><span />PRÉVISUALISATION LOCALE — données fictives isolées en mémoire</div>}
      <section className={styles.content}>
        <div className={styles.pageHeading}><div><p className={styles.eyebrow}>QADR OPS · PLATEFORME</p><h1>{title}</h1><p>{descriptions[section]}</p></div>{(section === "plans" || section === "promotions") && <button type="button" className={styles.primaryButton} onClick={() => setShowCreate(true)}>{section === "plans" ? "Créer un forfait" : "Créer un code"}</button>}</div>
        {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <ErrorNotice>{error}</ErrorNotice>}
        {loading ? <div className={styles.loading} aria-live="polite">Chargement des données plateforme…</div> :
          section === "dashboard" && data ? <DashboardView data={data as Dashboard} /> :
          section === "businesses" ? <BusinessesView items={merchants} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} statusAction={statusAction} openDetail={openDetail} busyId={busyId} onRefresh={() => void load()} /> :
          section === "subscriptions" ? <SubscriptionsView items={(data || []) as Subscription[]} /> :
          section === "plans" ? <PlansView items={(data || []) as Plan[]} busyId={busyId} toggle={togglePlan} /> :
          section === "promotions" ? <PromotionsView items={(data || []) as Promotion[]} merchants={merchants} refresh={() => void load()} setError={setError} setNotice={setNotice} onEdit={setEditingPromotion} /> :
          <AuditView items={(data || []) as AuditEntry[]} />}
        {detail && <BusinessDialog data={detail} onClose={() => setDetail(null)} />}
      </section>
    </div>
    {showCreate && section === "plans" && <PlanDialog onClose={() => setShowCreate(false)} setError={setError} onSaved={async () => { setShowCreate(false); setNotice("Forfait créé et action journalisée."); await load(); }} />}
    {showCreate && section === "promotions" && <PromotionDialog merchants={merchants} onClose={() => setShowCreate(false)} setError={setError} onSaved={async () => { setShowCreate(false); setNotice("Code promotionnel créé et action journalisée."); await load(); }} />}
    {editingPromotion && <PromotionDialog initial={editingPromotion} merchants={merchants} onClose={() => setEditingPromotion(null)} setError={setError} onSaved={async () => { setEditingPromotion(null); setNotice("Code promotionnel modifié et action journalisée."); await load(); }} />}
  </main>;
}

function DashboardView({ data }: { data: Dashboard }) {
  const rows = [
    ["Espaces commerces", data.businesses.total || 0, (data.businesses.active || 0) + " actifs · " + (data.businesses.suspended || 0) + " suspendus"],
    ["Abonnements actifs", data.subscriptions.active || 0, (data.subscriptions.pending || 0) + " en attente · " + (data.subscriptions.expired || 0) + " expirés"],
    ["Essais en cours", data.trials.current, data.trials.expired + " essais terminés"],
    ["Paiements SaaS confirmés", data.confirmedSaasPayments.count, money(data.confirmedSaasPayments.amountXof)],
  ];
  return <div><div className={styles.summaryStrip}>{rows.map((row) => <div className={styles.summary} key={String(row[0])}><span>{row[0]}</span><strong>{row[1]}</strong><small>{row[2]}</small></div>)}</div><div className={styles.columns}>
    <section className={styles.panel}><h2>Abonnements par statut</h2><p>Répartition calculée depuis les enregistrements.</p><div className={styles.statusRows}>{["active", "pending", "suspended", "expired", "canceled"].map((key) => <div key={key}><span>{statuses[key]}</span><strong>{data.subscriptions[key] || 0}</strong></div>)}</div><p className={styles.note}>Les montants concernent uniquement les règlements SaaS.</p></section>
    <section className={styles.panel}><h2>Activité plateforme</h2><p>Actions administratives récentes.</p>{data.recentEvents.length ? <ul className={styles.eventList}>{data.recentEvents.map((event) => <li key={event.id}><strong>{formatEvent(event.eventType)}</strong><small>{event.entityType} · {date(event.occurredAt)}</small></li>)}</ul> : <Empty text="Aucun événement plateforme." />}<div className={styles.incident}>Suivi des incidents non configuré<small>{data.incidents.message}</small></div></section>
  </div></div>;
}

function BusinessesView({ items, search, setSearch, filter, setFilter, statusAction, openDetail, busyId, onRefresh }: { items: Business[]; search: string; setSearch: (s: string) => void; filter: string; setFilter: (s: string) => void; statusAction: (b: Business) => void; openDetail: (id: string) => void; busyId: string; onRefresh: () => void }) {
  return <section className={styles.panel}><div className={styles.toolbar}><label className={styles.search}><span className={styles.srOnly}>Rechercher</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou contact professionnel" /></label><label><span className={styles.srOnly}>Filtrer par statut</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="suspended">Suspendus</option><option value="pending">En attente</option><option value="expired">Expirés</option></select></label><button className={styles.secondaryButton} type="button" onClick={onRefresh}>Actualiser</button></div>
    {items.length ? <div className={styles.tableWrap}><table><thead><tr><th>Commerce</th><th>Activité</th><th>Statut espace</th><th>Abonnement</th><th>Inscription</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.businessId}><td><button type="button" className={styles.nameButton} onClick={() => openDetail(item.businessId)}>{item.name}<small>{item.businessId}</small></button></td><td>{activities[item.activity] || "Non précisée"}</td><td><Badge value={item.status} /></td><td>{item.subscription ? <>{item.subscription.planName}<small>{statuses[item.subscription.status] || item.subscription.status} · {date(item.subscription.endsAt)}</small></> : "Aucun forfait"}</td><td>{date(item.createdAt)}</td><td><button className={styles.actionButton} type="button" disabled={busyId === item.businessId} onClick={() => void statusAction(item)}>{item.status === "suspended" ? "Réactiver" : "Suspendre"}</button></td></tr>)}</tbody></table></div> : <Empty text="Aucun commerce ne correspond aux critères." />}<p className={styles.note}>{items.length} résultat(s) · informations administratives uniquement.</p></section>;
}

function BusinessDialog({ data, onClose }: { data: Record<string, unknown>; onClose: () => void }) {
  const subs = (data.subscriptions || []) as Array<Record<string, unknown>>;
  return <Modal title={String(data.name || "Fiche commerce")} onClose={onClose}><dl className={styles.detailGrid}>{[["Activité", activities[String(data.activity)] || "Non précisée"], ["Statut", statuses[String(data.status)] || String(data.status)], ["Créé le", date(String(data.createdAt || ""))], ["Membres", String(data.memberCount || 0)], ["Téléphone professionnel", String(data.phone || "Non renseigné")], ["E-mail professionnel", String(data.businessEmail || "Non renseigné")], ["Adresse", String(data.address || "Non renseignée")]].map((row) => <div key={row[0]}><dt>{row[0]}</dt><dd>{row[1]}</dd></div>)}</dl><h3>Abonnements</h3>{subs.map((sub, i) => <p className={styles.subRow} key={String(sub.id || i)}>{String(sub.planName)} · {statuses[String(sub.status)] || String(sub.status)} · échéance {date(String(sub.endsAt || ""))}</p>)}<p className={styles.note}>Aucun accès aux ventes, clients, stocks, reçus ou encaissements.</p></Modal>;
}

function SubscriptionsView({ items }: { items: Subscription[] }) {
  const confirmed = items.reduce((total, item) => total + item.payments.filter((p) => p.status === "confirmed").reduce((sum, p) => sum + Number(p.amountXof), 0), 0);
  return <section className={styles.panel}><h2>Abonnements et règlements SaaS</h2><p>{items.length} abonnements · règlements confirmés : {money(confirmed)}</p>{items.length ? <div className={styles.tableWrap}><table><thead><tr><th>Commerce</th><th>Forfait</th><th>Statut</th><th>Période</th><th>Essai</th><th>Règlements SaaS</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.businessName}</td><td>{item.planName}<small>{money(item.planPriceXof)} / période</small></td><td><Badge value={item.status} /></td><td>{date(item.startsAt)} — {date(item.endsAt)}</td><td>{date(item.trialEndsAt)}</td><td>{item.payments.length ? item.payments.map((p, i) => <div key={i}>{money(p.amountXof)} · <Badge value={p.status} /> · {date(p.occurredAt)}</div>) : "Aucun règlement"}</td></tr>)}</tbody></table></div> : <Empty text="Aucun abonnement enregistré." />}<p className={styles.note}>Les paiements de clients aux commerces sont exclus.</p></section>;
}

function PlansView({ items, busyId, toggle }: { items: Plan[]; busyId: string; toggle: (p: Plan) => void }) {
  return <section className={styles.panel}><h2>Forfaits</h2><p>Désactiver un forfait ne modifie pas les abonnements historiques.</p>{items.length ? <div className={styles.tableWrap}><table><thead><tr><th>Forfait</th><th>Tarif</th><th>Limites</th><th>Fonctionnalités</th><th>État</th><th /></tr></thead><tbody>{items.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.code}</small></td><td>{money(p.priceXof)}<small>/{p.durationDays} jours</small></td><td>{p.features.productLimit || "Sans limite"} produits · {p.features.userLimit || "Sans limite"} utilisateurs</td><td>{[["pos","Caisse"],["reports","Rapports"],["inventory","Inventaires"],["procurement","Achats"]].map(([key, label]) => <span className={p.features[key as keyof Plan["features"]] ? styles.featureOn : styles.featureOff} key={key}>{label}</span>)}</td><td><Badge value={p.active ? "active" : "disabled"} /></td><td><button className={styles.actionButton} disabled={busyId === p.id} type="button" onClick={() => toggle(p)}>{p.active ? "Désactiver" : "Activer"}</button></td></tr>)}</tbody></table></div> : <Empty text="Aucun forfait défini." />}</section>;
}

function PromotionsView({ items, merchants, refresh, setError, setNotice, onEdit }: { items: Promotion[]; merchants: Business[]; refresh: () => void; setError: (s: string) => void; setNotice: (s: string) => void; onEdit: (promotion: Promotion) => void }) {
  async function toggle(p: Promotion) {
    if (!window.confirm((p.active ? "Désactiver " : "Activer ") + p.code + " ?")) return;
    try {
      await api("/api/platform/promotions/" + p.id, { method: "PATCH", body: JSON.stringify({ code: p.code, discountPercent: p.discountPercent, discountXof: p.discountXof, startsAt: new Date(p.startsAt).toISOString(), endsAt: p.endsAt ? new Date(p.endsAt).toISOString() : null, maxRedemptions: p.maxRedemptions, active: !p.active, eligibleBusinessIds: p.eligibleBusinesses.map((b) => b.businessId) }) });
      setNotice("Code mis à jour."); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action impossible."); }
  }
  return <div className={styles.promoList}>{items.length ? items.map((p) => <section className={styles.promoRow} key={p.id}><div><strong className={styles.promoCode}>{p.code}</strong> <Badge value={p.state} /><p>{p.discountPercent !== null ? p.discountPercent + " %" : money(p.discountXof || "0")} · non cumulable</p><small>Du {date(p.startsAt)} au {date(p.endsAt)} · {p.useCount}{p.maxRedemptions ? " / " + p.maxRedemptions : ""} utilisations</small></div><div><strong>Éligibilité</strong><small>{p.eligibleBusinesses.length ? p.eligibleBusinesses.map((b) => b.businessName).join(", ") : "Tous les commerces"}</small><small>{merchants.length} commerce(s) référencés</small></div><div><strong>Historique</strong>{p.redemptions.length ? p.redemptions.map((r) => <small key={r.id}>{r.businessName} · {money(r.discountAmountXof)} · {date(r.redeemedAt)}</small>) : <small>Aucune utilisation</small>}</div><div className={styles.promoActions}><button type="button" className={styles.actionButton} onClick={() => onEdit(p)}>Modifier</button><button type="button" className={styles.actionButton} onClick={() => void toggle(p)}>{p.active ? "Désactiver" : "Activer"}</button></div></section>) : <section className={styles.panel}><Empty text="Aucun code promotionnel défini." /></section>}</div>;
}

function AuditView({ items }: { items: AuditEntry[] }) {
  return <section className={styles.panel}><h2>Événements administratifs</h2><p>Secrets et contenus sensibles non affichés.</p>{items.length ? <div className={styles.tableWrap}><table><thead><tr><th>Événement</th><th>Ressource</th><th>Référence</th><th>Détails limités</th><th>Date</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{formatEvent(item.eventType)}</td><td>{item.entityType}</td><td>{item.entityId}</td><td>{Object.entries(item.metadata || {}).map(([key, value]) => <small className={styles.meta} key={key}>{key}: {typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "—"}</small>)}</td><td>{date(item.occurredAt)}</td></tr>)}</tbody></table></div> : <Empty text="Aucun événement plateforme." />}</section>;
}

function PlanDialog({ onClose, setError, onSaved }: { onClose: () => void; setError: (s: string) => void; onSaved: () => void }) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); const form = new FormData(e.currentTarget);
    try { await api("/api/platform/plans", { method: "POST", body: JSON.stringify({ code: String(form.get("code") || "").toUpperCase(), name: form.get("name"), priceXof: form.get("price"), durationDays: Number(form.get("days")), active: true, features: { pos: form.has("pos"), reports: form.has("reports"), inventory: form.has("inventory"), procurement: form.has("procurement"), productLimit: form.get("products") ? Number(form.get("products")) : null, userLimit: form.get("users") ? Number(form.get("users")) : null } }) }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
  }
  return <Modal title="Créer un forfait" onClose={onClose}><form className={styles.form} onSubmit={submit}><div className={styles.formGrid}><Field label="Code"><input required name="code" minLength={2} maxLength={32} /></Field><Field label="Nom"><input required name="name" maxLength={80} /></Field><Field label="Prix (F CFA)"><input required name="price" inputMode="numeric" pattern="[0-9]+" /></Field><Field label="Durée (jours)"><input required name="days" type="number" min="1" defaultValue="30" /></Field><Field label="Limite produits"><input name="products" type="number" min="1" placeholder="Sans limite" /></Field><Field label="Limite utilisateurs"><input name="users" type="number" min="1" placeholder="Sans limite" /></Field></div><fieldset className={styles.checks}><legend>Fonctionnalités</legend>{[["pos","Caisse"],["reports","Rapports"],["inventory","Inventaires"],["procurement","Achats"]].map(([id,label]) => <label key={id}><input type="checkbox" name={id} defaultChecked={id !== "procurement"} />{label}</label>)}</fieldset><Actions onClose={onClose} /></form></Modal>;
}

function PromotionDialog({ merchants, onClose, setError, onSaved, initial }: { merchants: Business[]; onClose: () => void; setError: (s: string) => void; onSaved: () => void; initial?: Promotion }) {
  const [kind, setKind] = useState(initial?.discountPercent !== null ? "percent" : "fixed");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); const form = new FormData(e.currentTarget);
    try { await api(initial ? "/api/platform/promotions/" + initial.id : "/api/platform/promotions", { method: initial ? "PATCH" : "POST", body: JSON.stringify({ code: String(form.get("code") || "").toUpperCase(), discountPercent: kind === "percent" ? Number(form.get("amount")) : null, discountXof: kind === "fixed" ? String(form.get("amount")) : null, startsAt: new Date(String(form.get("starts"))).toISOString(), endsAt: form.get("ends") ? new Date(String(form.get("ends"))).toISOString() : null, maxRedemptions: form.get("limit") ? Number(form.get("limit")) : null, active: initial?.active ?? true, eligibleBusinessIds: form.getAll("eligible").map(String) }) }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
  }
  const initialDate = initial ? new Date(initial.startsAt).toISOString().slice(0,16) : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16);
  const endDate = initial?.endsAt ? new Date(initial.endsAt).toISOString().slice(0,16) : "";
  const selectedBusinesses = new Set(initial?.eligibleBusinesses.map((business) => business.businessId) ?? []);
  const amount = initial?.discountPercent ?? initial?.discountXof ?? "";
  return <Modal title={initial ? "Modifier le code promotionnel" : "Créer un code promotionnel"} onClose={onClose}><form className={styles.form} onSubmit={submit}><div className={styles.formGrid}><Field label="Code"><input required name="code" minLength={3} maxLength={40} defaultValue={initial?.code} /></Field><Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></Field><Field label={kind === "percent" ? "Réduction (%)" : "Réduction (F CFA)"}><input required name="amount" type="number" min="1" max={kind === "percent" ? 100 : undefined} defaultValue={amount} /></Field><Field label="Limite d’utilisations"><input name="limit" type="number" min="1" placeholder="Sans limite" defaultValue={initial?.maxRedemptions ?? ""} /></Field><Field label="Début"><input required name="starts" type="datetime-local" defaultValue={initialDate} /></Field><Field label="Fin"><input name="ends" type="datetime-local" defaultValue={endDate} /></Field></div><fieldset className={styles.checks}><legend>Commerces éligibles (rien coché = tous)</legend><div className={styles.eligible}>{merchants.map((b) => <label key={b.businessId}><input type="checkbox" name="eligible" value={b.businessId} defaultChecked={selectedBusinesses.has(b.businessId)} />{b.name}</label>)}</div></fieldset><p className={styles.note}>Non cumulable. Appliqué à un abonnement en attente; aucun paiement n’est confirmé par cette action.</p><Actions onClose={onClose} /></form></Modal>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}>{label}{children}</label>; }
function Actions({ onClose }: { onClose: () => void }) { return <div className={styles.actions}><button className={styles.secondaryButton} type="button" onClick={onClose}>Annuler</button><button className={styles.primaryButton} type="submit">Enregistrer</button></div>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className={styles.backdrop} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className={styles.close} type="button" aria-label="Fermer" onClick={onClose}>×</button></header>{children}</section></div>; }
function formatEvent(value: string) { return value.replace(/^platform\./, "").replaceAll("_", " ").replaceAll(".", " · ").replace(/^./, (ch) => ch.toUpperCase()); }
