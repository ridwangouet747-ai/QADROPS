# Rapports commerciaux et clôture de caisse (mission 09)

Code : `apps/web/src/lib/domain/reports.ts` (rapports), `apps/web/src/lib/domain/cash-session.ts` (caisse), migration `apps/web/drizzle/0011_cash_sessions_reports.sql`. Écrans : `/business/reports`, `/business/cash`. Tests : `reports.integration.test.ts`, `cash-session.integration.test.ts` (PGlite).

## 1. Sources des indicateurs

| Indicateur | Source | Date retenue |
| --- | --- | --- |
| Chiffre d'affaires, nombre de ventes, remises | `sale.total_xof`, statuts `completed`, `partially_refunded`, `refunded` (une vente `voided` est exclue) | `sale.occurred_at` |
| Quantités vendues, catégories, produits | `sale_line` (`quantity`, `line_total_xof`) → `product_variant` → `product` → `product_category` | date de la vente |
| Coût des marchandises vendues | `sale_line.cogs_xof`, seulement si `cost_available` | date de la vente |
| Encaissements | `payment` aux statuts `confirmed`, `partially_refunded`, `refunded` | `payment.confirmed_at` |
| Paiements en attente | `payment.status = 'pending'` (Mobile Money déclaré à la caisse, jamais confirmé par un prestataire) | `payment.occurred_at` |
| Paiement mixte | vente avec au moins deux moyens de paiement non échoués | date de la vente |
| Règlements de crédits | `payment` relié à `receivable_payment` | `confirmed_at` |
| Crédit accordé | pour chaque vente avec client : total − paiements saisis au comptoir (hors règlements ultérieurs, hors échecs) | date de la vente |
| Restant dû sur ventes | total − encaissements confirmés avant la fin de période | fin de période |
| Anciennes dettes clients | `opening_balance` (`party_type = 'customer'`) et `opening_balance_payment` | `occurred_at` du règlement |
| Dépenses | `expense.amount_xof`, `expense.category`, `expense.payment_method` (nul = « non précisé » pour l'historique) | `expense.occurred_at` |
| Achats, paiements fournisseurs | `purchase` (`received`), `purchase_payment` | `occurred_at` |
| Dettes fournisseurs | achats reçus − paiements, + anciennes dettes fournisseurs restantes | fin de période |
| Remboursements | `payment_refund.status = 'confirmed'` | `occurred_at` |
| Stock | `stock_movement` par motif ; mouvements importants = hors ventes, plus grandes quantités | `occurred_at` |
| Écarts d'inventaire | `inventory_line` des sessions validées | `validated_at` |
| Activité par employé | `sale.cashier_user_id`, `payment.recorded_by_user_id`, `expense.paid_by_user_id` | dates ci-dessus |

## 2. Règles financières appliquées

- **Chiffre d'affaires ≠ encaissements** : une vente à crédit ou payée par Wave en attente compte dans le chiffre d'affaires, pas dans l'argent encaissé.
- **Un paiement en attente n'est jamais encaissé.** Il apparaît à part (« en attente de confirmation »). Aucune intégration Wave, Orange Money, MTN ou GeniusPay n'existe : ces paiements restent en attente.
- **Dépenses engagées / payées** : une dépense est saisie au moment où elle est payée ; il n'existe pas encore de dépense engagée non payée, les deux totaux sont donc égaux et l'écran le dit.
- **Coût des marchandises vendues et marge brute** : la marge n'est dite complète que si chaque ligne vendue a un coût connu. Sinon l'écran affiche « Incomplète », le nombre de lignes sans coût et la marge sur les seules lignes au coût connu.
- **Bénéfice net** : non calculé. Le « résultat estimé » vaut marge complète − dépenses de la période, présenté comme indicatif (ni amortissements, ni impôts, ni stocks invendus).
- **Trésorerie** : Qadr Ops ne connaît pas le solde des comptes ou du coffre. Le rapport donne le solde des mouvements de la période : encaissements + anciennes dettes reçues − dépenses − paiements fournisseurs − remboursements.
- **Créances / dettes** : soldes à la fin de période, ventes et anciennes dettes séparées.
- **Anciennes dettes et stock de départ** : un remboursement de dette initiale est un mouvement d'argent, jamais une vente ; un stock de départ n'ajoute aucun chiffre d'affaires (testé).
- **Montants** : entiers XOF calculés par PostgreSQL (`bigint`), renvoyés en chaînes ; les variations sont en points de base (1 % = 100). Aucun total de référence n'est calculé dans le navigateur.
- **Périodes** : fuseau du commerce (`business_profile.timezone`, `Africa/Abidjan` par défaut). Jour de minuit à minuit, semaine du lundi au dimanche, mois et année civils, période libre de 1 à 366 jours comparée à la période de même durée qui la précède.
- **Isolation** : chaque requête filtre par le commerce de la session ; permission `report:read` (propriétaire, administrateur, gestionnaire de stock, comptable).

## 3. Exports

Depuis la mission 11, phase 4 : classeur Excel, rapport PDF et résumé CSV, détaillés dans `docs/exports.md`.

- **CSV** : `GET /api/business/reports/export?format=csv&period=…` (même permission). BOM UTF-8. `csvCell` est partagé (`src/lib/exports/csv.ts`) : un nombre simple, même négatif, reste un nombre ; tout autre texte qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est préfixé d'une apostrophe (testé).
- **XLSX** : `format=xlsx`, une feuille Synthèse et neuf feuilles détaillées, sans aucune formule.
- **PDF** : `format=pdf`, généré par le serveur en français ou en anglais. En arabe, le bouton « Imprimer » reste la voie pour un rapport en arabe : le navigateur peut l'enregistrer en PDF.

## 4. Clôture de caisse

- **Notion de caisse** : il n'existait ni caisse ni point de vente dans le modèle. La session est donc rattachée au **commerce** et au **membre** (pas de notion de tiroir physique, à ajouter si un commerce a plusieurs tiroirs partagés).
- **Ouverture** : fonds de départ (entier ≥ 0), date et heure du serveur, observation facultative. Une seule session ouverte par membre (index unique partiel).
- **Rattachement** : au moment de l'écriture, chaque opération **en espèces** prend la session ouverte de la personne qui l'enregistre (`cash_session_id` sur `payment`, `expense`, `purchase_payment`, `opening_balance_payment`, `payment_refund`), sous verrou partagé. Sans session ouverte, l'opération reste « hors session » (elle n'est pas refusée).
- **Espèces théoriques** = fonds initial + ventes en espèces + crédits remboursés en espèces + anciennes dettes réglées en espèces + entrées justifiées − dépenses en espèces − fournisseurs payés en espèces − remboursements en espèces − sorties justifiées. Mobile Money et paiements en attente sont exclus.
- **Écart** = espèces comptées − espèces théoriques ; une justification est obligatoire s'il n'est pas nul (contrôlé par le service et par une contrainte `CHECK`).
- **Irréversibilité** : la clôture verrouille la session (`FOR UPDATE`), recalcule le théorique et fige montants et détail (`closing_snapshot`). Un déclencheur refuse toute modification d'une session clôturée (sauf le passage à « validée ») et toute suppression ; les mouvements de caisse sont en ajout seul et seulement dans une session ouverte. Une correction ultérieure s'enregistre comme une opération distincte (entrée ou sortie dans une session ouverte).
- **Permissions** (`cash`) : caissier `open`, `close`, `read` (sa caisse) ; comptable `audit` (toutes les caisses) et `validate` ; propriétaire et administrateur tout, dont `manage` (clôturer la caisse d'un absent, tracé `onBehalf` dans l'audit). Un responsable ne valide pas sa propre caisse, sauf le propriétaire.
- **Idempotence** : `cash_session.open|movement|close|validate` passent par `runIdempotent` avec une clé fournie par l'écran ; ouverture, clôture et validation bloquées pour un commerce suspendu ou expiré (`assertBusinessOperational`).
- **Comparaison** : écarts cumulés et nombre de clôtures en manque par personne, sur les clôtures affichées.

## 5. Captures (aperçu, données fictives)

`docs/captures/mission-09/` : `reports-weekly-fr-1366`, `reports-monthly-en-768`, `reports-daily-ar-390` (RTL), `cash-open-fr-1366`, `cash-open-ar-390` (RTL), `cash-close-review-fr-390` (écart de −1 250 justifié), `cash-close-sending-en-390` (envoi en cours), `cash-history-fr-1366` (clôture validée et comparaison), `onboarding-sync-fr-390`. Aucune capture ne déborde en largeur.

## 6. Vérifications à faire sur un vrai PostgreSQL (Neon)

Tous les tests tournent sur PGlite (une seule connexion : les transactions concurrentes y sont sérialisées). À valider sur PostgreSQL réel, avec plusieurs connexions du pool `neon-serverless` :

1. une vente en espèces et une clôture vraiment simultanées (verrou partagé contre verrou exclusif) ;
2. deux ouvertures simultanées du même membre (index unique partiel, code `23505`) ;
3. les déclencheurs `cash_session_guard` et `cash_movement_guard` (PL/pgSQL) et le message d'erreur renvoyé ;
4. les plans d'exécution des requêtes de rapport sur un volume réaliste (index `payment_business_confirmed_idx`, `sale_business_occurred_idx`, `expense_business_date_idx`, `purchase_payment_business_date_idx`, `opening_payment_business_date_idx`) ;
5. `date_trunc(... at time zone 'Africa/Abidjan')` avec les paramètres de session de Neon.

La migration 0011 n'a été appliquée qu'à PGlite ; elle n'a jamais été lancée sur Neon.
