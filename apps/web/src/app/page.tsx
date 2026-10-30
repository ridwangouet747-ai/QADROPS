import type { CSSProperties } from "react";
import { SectorPicker } from "@/components/landing/sector-picker";

const activityBars = [23, 40, 53, 40, 33, 14, 7, 17, 75, 65, 88, 75, 65, 47, 33, 88, 4, 7, 9, 14, 95, 65, 79, 37];

export default function HomePage() {
  return (
    <main id="main-content">
      <a className="skip-link" href="#accueil">Aller au contenu</a>
      <header className="site-header">
        <a className="wordmark" href="#accueil" aria-label="QADR OPS, accueil">
          <span className="wordmark-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>QADR OPS</span>
        </a>
        <nav className="main-nav" aria-label="Navigation principale">
          <a href="#parcours">Le parcours</a>
          <a href="#metiers">Les commerces</a>
          <a href="#principes">Notre approche</a>
        </nav>
        <a className="header-link" href="#parcours">
          Explorer le produit <span aria-hidden="true">↘</span>
        </a>
      </header>

      <section className="hero-section" id="accueil" aria-labelledby="hero-title" tabIndex={-1}>
        <div className="hero-atmosphere" aria-hidden="true" />
        <div className="hero-copy">
          <p className="hero-kicker"><span /> Le commerce, sans angle mort</p>
          <h1 id="hero-title">
            Vendez sans ralentir. <em>Gardez la journée en vue.</em>
          </h1>
          <p className="hero-lede">
            QADR OPS relie ventes, stock et caisse dans un espace dédié à votre entreprise.
            L’équipe avance au comptoir ; vous gardez le fil des opérations.
          </p>
          <a className="button-primary" href="#parcours">
            Découvrir le parcours <span aria-hidden="true">↘</span>
          </a>
          <p className="hero-note">Un même outil, pensé pour quatre réalités du commerce de proximité.</p>
        </div>

        <div className="hero-visual" aria-label="Aperçu illustratif du suivi d’une vente et de son activité">
          <div className="visual-orbit" aria-hidden="true"><i /><i /><i /></div>
          <div className="visual-caption">
            <span>QADR OPS · VUE DE CAISSE</span>
            <span>MAQUETTE FICTIVE</span>
          </div>
          <div className="activity-card">
            <div className="activity-topline">
              <div className="activity-brand"><span className="activity-brand-mark" aria-hidden="true">Q</span><span>Quincaillerie du Centre<small>Espace de vente</small></span></div>
              <span className="activity-status"><i /> Exemple</span>
            </div>
            <div className="activity-heading">
              <div><span>APERÇU DE LA JOURNÉE</span><h2>Ventes enregistrées</h2></div>
              <span className="activity-period">AUJOURD’HUI <b>⌄</b></span>
            </div>
            <div className="activity-total"><strong>11 500</strong><span>F&nbsp;CFA</span><small>1 vente · exemple</small></div>
            <div className="activity-chart" role="img" aria-label="Graphique décoratif des ventes d’exemple sur la journée, sans données réelles">
              <div className="chart-grid" aria-hidden="true"><i /><i /><i /></div>
              <div className="chart-bars" aria-hidden="true">
                {activityBars.map((height, index) => (
                  <i key={index} style={{ "--bar-height": `${height}%`, "--bar-delay": `${760 + index * 24}ms` } as CSSProperties} />
                ))}
              </div>
              <div className="chart-axis" aria-hidden="true"><span>08h</span><span>10h</span><span>12h</span><span>14h</span><span>16h</span></div>
            </div>
            <div className="activity-footer"><span className="activity-payment"><i /> Paiement en espèces</span><span>Vente <b>#QO-0148</b></span></div>
          </div>
          <div className="receipt-note"><span className="receipt-check" aria-hidden="true">✓</span><span><strong>Vente enregistrée</strong><small>Le mouvement rejoint le stock.</small></span><span className="receipt-arrow" aria-hidden="true">↗</span></div>
          <div className="visual-index" aria-hidden="true"><span>01</span><i /></div>
          <div className="hero-trust-line"><span className="trust-lock" aria-hidden="true"><i /></span><span>Un espace distinct pour chaque entreprise</span>
            </div>
        </div>
        <a className="scroll-cue" href="#parcours"><span aria-hidden="true">↓</span> Faire défiler</a>
      </section>

      <section className="intro-strip" aria-label="Fonctions réunies">
        <p>Une même journée, un seul fil de suivi.</p>
        <div><span>Ventes</span><i /> <span>Stock</span><i /> <span>Encaissements</span><i /> <span>Dépenses</span></div>
      </section>

      <section className="journey-section" id="parcours" aria-labelledby="journey-title">
        <div className="section-heading">
          <p className="section-kicker">Du comptoir au bilan</p>
          <h2 id="journey-title">Chaque vente laisse une trace utile.</h2>
          <p>Une transaction confirmée doit expliquer ce qui s’est passé, sans ralentir l’équipe.</p>
        </div>
        <div className="journey-flow">
          <article className="journey-step step-sale">
            <span className="step-no">01</span>
            <div className="step-symbol symbol-bag" aria-hidden="true"><span /><i /><b /></div>
            <h3>La vente est saisie</h3>
            <p>Le produit, la quantité et le moyen de paiement sont réunis sous une référence unique.</p>
          </article>
          <div className="flow-connector" aria-hidden="true"><span /></div>
          <article className="journey-step step-stock">
            <span className="step-no">02</span>
            <div className="step-symbol symbol-stock" aria-hidden="true"><span /><span /><span /></div>
            <h3>Le stock est ajusté</h3>
            <p>Le mouvement associé à la vente rejoint l’historique du produit.</p>
          </article>
          <div className="flow-connector" aria-hidden="true"><span /></div>
          <article className="journey-step step-close">
            <span className="step-no">03</span>
            <div className="step-symbol symbol-ledger" aria-hidden="true"><span /><span /><span /></div>
            <h3>La journée se relit</h3>
            <p>Les encaissements, les crédits et les dépenses restent présentés séparément.</p>
          </article>
        </div>
        <div className="journey-footnote"><span /> Une même opération alimente les bons suivis, sans confondre chiffre d’affaires et bénéfice.</div>
      </section>

      <section className="sectors-section" id="metiers" aria-labelledby="sectors-title">
        <div className="sectors-copy">
          <p className="section-kicker">Un produit commun, des détails adaptés</p>
          <h2 id="sectors-title">Votre métier garde ses habitudes utiles.</h2>
          <p>Chaque entreprise choisit son activité. Les mêmes bases s’adaptent aux unités, variantes et repères de son commerce.</p>
          <SectorPicker />
        </div>
        <div className="sector-stage" aria-live="polite">
          <span className="stage-label">Votre espace, vos données</span>
          <div className="stage-mark" aria-hidden="true"><span>Q</span><i /></div>
          <p className="stage-name">Une seule plateforme.</p>
          <p className="stage-detail">Chaque entreprise retrouve son identité, ses produits et son équipe dans un espace séparé.</p>
          <div className="stage-lines" aria-hidden="true"><span /><span /><span /></div>
          <div className="stage-footer"><span>VENTES</span><span>STOCK</span><span>ÉQUIPE</span></div>
        </div>
      </section>

      <section className="principles-section" id="principes" aria-labelledby="principles-title">
        <div className="principles-heading">
          <p className="section-kicker">Notre ligne de conduite</p>
          <h2 id="principles-title">Le logiciel doit servir le commerce. Pas l’inverse.</h2>
        </div>
        <div className="principles-list">
          <div><span>01</span><h3>Rapide au comptoir</h3><p>La recherche manuelle reste simple. Un compte client n’est pas requis pour une vente comptant.</p></div>
          <div><span>02</span><h3>Clair sur l’argent</h3><p>Vente, paiement reçu, crédit et dépense sont suivis sans être mélangés.</p></div>
          <div><span>03</span><h3>Séparé par entreprise</h3><p>Les produits et les opérations d’un commerce ne sont pas ceux du voisin.</p></div>
        </div>
      </section>

      <section className="closing-section" aria-labelledby="closing-title">
        <div className="closing-ornament" aria-hidden="true"><span /><span /><span /></div>
        <p className="section-kicker">QADR OPS</p>
        <h2 id="closing-title">Un commerce mieux suivi commence par une vente bien enregistrée.</h2>
        <a className="button-light" href="#accueil">Revoir le parcours <span aria-hidden="true">↑</span></a>
        <p className="closing-status">Produit en construction · Les fonctions présentées décrivent la cible du produit.</p>
      </section>

      <footer className="site-footer">
        <a className="wordmark footer-wordmark" href="#accueil"><span className="wordmark-mark" aria-hidden="true"><i /><i /><i /></span><span>QADR OPS</span></a>
        <p>Gestion commerciale pensée pour le quotidien.</p>
        <a href="#principes">Notre approche <span aria-hidden="true">↗</span></a>
      </footer>
    </main>
  );
}
