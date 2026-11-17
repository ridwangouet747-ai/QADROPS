# Mission CTO du 2026-11-17 : caisse, Super Admin, formulaires, page publique, release

> Rapport de l'agent. Il distingue ce qui est prouvé (commande, résultat) de ce qui ne l'est pas.
> Aucun paiement réel, aucune vente, aucun compte ni aucune donnée métier n'a été créé en production.
> Branche `feat/mission-codes-2026-11-16`, commits `a48c9aa` (mission) et `c01e572` (exception d'audit CI).
> Migration ajoutée : `0027_manual_payments_cash_change.sql` (additive).

**Verdict : DÉPLOYÉ, VALIDATION PARTIELLE.** Le code testé est en production (`c01e572`, projet Vercel `web`),
la migration est appliquée sur `main` et sur staging ; les parcours connectés (caisse, clients, codes) n'ont pas été
rejoués sur la production ni sur l'aperçu Vercel (protégé par l'authentification Vercel), seulement en local.

## A. Super Admin

- Le seul accès visible est le lien « Espace Qadr Agency » de `/login` (vers `/platform/login`) ; vérifié sur la
  production : c'est le seul `href="/platform…"` de la page.
- Supprimés : le lien « Administration de la plateforme » de `/select-business` et la redirection automatique vers
  `/platform` après connexion d'un compte qui détient le droit plateforme. `getAccountOverview` ne renvoie plus
  `isPlatformAdmin` : l'espace commerçant ne révèle jamais ce droit.
- La protection reste côté serveur (`getPlatformContext` : droit `platform_admin` + session plateforme). Test
  `platform-and-system.http.test.ts` : anonyme, propriétaire, administrateur, caissier, gestionnaire de stock,
  comptable, membre et compte sans commerce reçoivent 404 sur les routes plateforme ; le propriétaire de la
  plateforme y accède. Aucune promotion automatique du premier compte (inchangé).

## B. Caisse (`docs/caisse-reglements.md`)

| Exigence | Réalisation |
| --- | --- |
| Total / montants affectés / espèces remises / monnaie / solde | `payment.amount_xof` = part affectée, `tendered_xof` = remis, `change_xof` = rendu (contrainte `payment_cash_tender_check`) ; payé et reste dû calculés sur les parts affectées |
| Montant reçu prérempli | la ligne espèces suit le reste dû tant que le caissier n'y touche pas ; le champ se sélectionne au focus (corrigé après essai : la saisie s'ajoutait au montant prérempli) |
| Mobile Money manuel | Wave, Orange Money, MTN MoMo, **Moov Money** (nouveau) : déclaratifs, `confirmed` à la saisie, aucune passerelle ; avis à l'écran |
| Paiement mixte | plusieurs lignes ; Mobile Money supérieur au total refusé (pas de monnaie sur un transfert) |
| Caisse nette | exemple du mandat (1 000 remis, 200 rendus) : 800 dans les espèces attendues ; le détail affiche « dont billets reçus » et « dont monnaie rendue » hors calcul |
| Reçu | une ligne par moyen, espèces remises, monnaie rendue, reste dû, statut Payé / Partiellement payé / À crédit (fr/en/ar) |
| Historique | aucun paiement réécrit ; les anciens Mobile Money `pending` gardent leur statut |

Contrôle visuel local (aperçu PGlite, 1 280 px) : vente de 6 500 F, champ prérempli 6 500 ; 10 000 remis + 500 Wave →
« Monnaie à rendre 4 000 F CFA », payé 6 500, reste 0.

## C. Formulaire produit

Chevauchement quantité / unité corrigé (liste en cartes sous `lg`, `min-w-0`, quantité et unité séparées ; champ
`Field` sans étirement). Quantité de départ facultative à la création, enregistrée comme **stock d'ouverture**
(`postStockOpening`, idempotent), jamais comme achat. Règles d'unité inchangées (une seule unité de stock).

## D. Dette existante d'un client

Case « Ce client me doit déjà de l'argent » à la création (montant, date, note) ; service
`createCustomerWithOpeningBalance` : fiche, solde d'ouverture et audit dans une transaction `runIdempotent`,
distincte de toute vente. Remboursements partiels et totaux (dépassement 409), caissier refusé (403), isolation A/B
(même 404 qu'un identifiant inconnu). Test : `customer-opening-debt.http.test.ts` (6/6).

## E. `/redeem-code`

Débordement corrigé à toutes les largeurs (320 à 1 280 px, fr/ar) ; un message WhatsApp collé est réduit au code
`QADR-…` ; messages valide, invalide, utilisé, expiré, révoqué, réseau et succès en fr/en/ar (codes stables de la
route, inchangée). WhatsApp n'a pas été modifié : 4 liens `wa.me` vers le même numéro sur la production.

## F. Page publique

Photos fournies réparties par métier (quincaillerie, téléphonie, vêtements) en cartes illustrées, fond « salle
quadrillée » à la place des fonds blancs, pages superposées dans la section des écrans. Recadrages sans marque ni
filigrane, proportions conservées, texte alternatif « Illustration : … » et mention visible (images générées par IA,
pas des clients). Mouvement réduit respecté, aucun débordement de 320 à 1 440 px (fr/en/ar). Détail :
`docs/product/landing-page.md` § 5 bis.

## G. Tests et contrôles

| Commande | Résultat |
| --- | --- |
| `npx vitest run` (suite complète, local) | 963 réussis, 10 ignorés, 3 échecs, tous dus au changement de règle Mobile Money ; attentes recalculées à la main (`exports`, `performance` : 17/17 ensuite), aucun test supprimé |
| `npm run typecheck`, `npm run lint` | 0 erreur |
| `npx drizzle-kit check` puis `generate` | « Everything's fine », « No schema changes » |
| `npm run build` (local) | compilation et 91 pages générées, puis arrêt par l'avis de mise à jour Next.js réservé aux agents (§ K) |
| CI `44154631300` (branche, `c01e572`) et `44156213724` (`main`) | **succès**, toutes étapes dont Vitest complet, build et audit |
| CI `44141277026` (`a48c9aa`) | échec à la seule étape d'audit (alerte `picomatch`, § K) |

## H. Migrations et Neon

- Point de retour : branche `sauvegarde-main-avant-0027-2026-11-17` (copie de `main`, sans calcul). Pas de
  `pg_dump` (outils absents du poste ce jour), comme pour 0026.
- Répétition sur `repetition-0027-2026-11-17` (copie de `main`) avec `scripts/migrate-production.ts` : 27 → 28,
  contraintes et colonnes présentes, paiements existants intacts.
- **Staging** (`mission-14-staging`, base `qadr_staging`) : il lui manquait aussi 0026. 0026 et 0027 appliquées en
  une transaction en tant que propriétaire, avec les lignes de journal Drizzle (empreintes identiques à celles de la
  répétition) : 28 migrations.
- **Production** (`main`) : `migrate-production.ts` (cible, phrase de confirmation, connexion directe) : « 27
  appliquées, 1 en attente … Terminé en une transaction : 28 ». Contrôle : 3 contraintes `moov_money`,
  `payment_cash_tender_check`, 2 colonnes.
- Aucune branche supprimée. Les fichiers de variables tirés pour la migration ont été effacés du poste.

## I. Déploiement

| Point | État constaté |
| --- | --- |
| Dépôt | `QADROPS` **privé** (404 anonyme, accès authentifié valide) |
| Aperçu | statut Vercel **success** sur `a48c9aa` et `c01e572` ; protégé par l'authentification Vercel : non ouvert par l'agent |
| Fusion | avance rapide sans forçage `6d816e7..c01e572` sur `main` |
| Production | `dpl_8QHhmYySdZQCWaGkKejdFF8VUgtW`, projet `web`, **READY**, `githubCommitSha` = `c01e57207961b56f82d4e4145a47ef493931f335`, alias `web-phi-beryl-45.vercel.app` |
| Pages | `/`, `/redeem-code`, `/join-business`, `/login`, `/register`, `/platform/login`, `/privacy` : 200 ; images `public/landing/ambiance` servies ; `/business/pos` et `/select-business` redirigent (307) sans session |
| Journaux | `vercel logs --environment production --since 30m`, niveau erreur : 0 enregistrement |

## J. Sécurité et données

Tenant de la session seulement (un `businessId` forgé est ignoré, testé) ; permissions avant écriture ;
`assertBusinessOperational` et idempotence sur les nouvelles écritures (dette de départ, stock de départ, vente) ;
contraintes en base sur la monnaie ; aucun secret affiché ni versionné ; la CI lit l'état GitHub avec l'identifiant
déjà utilisé par git, jamais affiché.

## K. Limites et actions du propriétaire

1. **Exception d'audit** (accord du 2026-11-17) : `picomatch` GHSA-fc5q-39xc-vjpf (ReDoS, aucune version corrigée,
   outillage de build/test) excusée jusqu'au **2026-12-17** dans `lib/security/dependency-audit.ts` ; elle bloquera de
   nouveau ensuite. Toute autre alerte high/critical bloque.
2. **Next.js 16.4.2** : deux alertes modérées (`'use cache'` + paramètres racine, non utilisés ici). Mise à jour de
   correctif vers 16.4.6 recommandée dans un lot séparé.
3. **Non vérifié** : parcours connectés sur l'aperçu Vercel ou la production (caisse, client avec dette, code
   commercial réel), Turnstile réel, imprimante réelle, vrai téléphone.
4. Bloquants hérités : offre Vercel Hobby (non commerciale), offre Neon Free sans sauvegarde planifiée,
   `QADR_CODE_SECRET`, formule Standard à créer, domaine et clés Resend/Turnstile de production.
5. Historique daté des remboursements d'une dette de départ : conservé en base, pas encore affiché ligne par ligne.
