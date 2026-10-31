# Stock initial et soldes d’ouverture

**Statut au 2026-10-30 (mission 06) : implémenté et testé sur PGlite.** Rien n’a encore été vérifié sur PostgreSQL/Neon réel (voir la dernière section).

## Ce qui a été livré

| Besoin | Tables (migration `0008_opening_balances.sql`) | Service (`src/lib/domain/opening.ts`) | API |
| --- | --- | --- | --- |
| Stock de départ | `stock_opening`, `stock_opening_line` ; `stock_movement.opening_line_id` ; raison `opening_stock` | `listOpeningCandidates`, `postStockOpening` | `GET`/`POST /api/business/stock/opening` |
| Dettes de départ des clients et dettes envers les fournisseurs | `opening_balance` (`party_type` = `customer`/`supplier`) | `listOpeningBalances`, `createOpeningBalance` | `GET /api/business/opening-balances?party=…`, `POST /api/business/opening-balances` |
| Règlements de ces anciennes dettes | `opening_balance_payment` | `recordOpeningBalancePayment` | `POST /api/business/opening-balances/{id}/payments` |

**Interface** : écran « Démarrage » (`/business/opening`), accessible depuis le menu « Plus », le bouton « Stock de départ » de l’écran Stock et la grille des modules.

### Règles appliquées côté serveur

- **Produit éligible au stock de départ** : il n’a encore **aucun mouvement**, **aucune ligne d’ouverture**, un **stock à zéro**, et ni lui ni sa variante ne sont archivés. Ces conditions sont vérifiées dans la transaction, sous verrou `FOR UPDATE`. La contrainte unique `stock_opening_line_variant_unique` les garantit aussi au niveau de la base.
- **Correction ultérieure** : toujours par un inventaire (mouvement `inventory_adjustment`). L’ouverture d’origine n’est jamais modifiée.
- **Mouvement créé** :
  - raison `opening_stock` et lien `opening_line_id` obligatoire ; la contrainte `stock_movement_opening_reason_check` impose la cohérence entre les deux ;
  - date du mouvement = date de référence à 00:00 (Abidjan, UTC+0) ; cette date ne peut pas être dans le futur.
- **Coût d’achat** : facultatif. S’il est absent, le coût moyen reste « non renseigné » (`cost_known=false`) ; il n’est jamais inventé.
- **Ce que l’ouverture ne crée jamais** : ni vente, ni achat, ni dépense, ni paiement. Elle ne change donc pas le chiffre d’affaires.
- **Soldes d’ouverture** :
  - un seul par client ou fournisseur (index uniques partiels) ;
  - montant entier XOF strictement positif ;
  - date ni future ni antérieure à 2000 ;
  - les règlements ne peuvent pas dépasser le reste dû (verrou `FOR UPDATE` sur le solde).
- **Idempotence** : toute écriture passe par `runIdempotent`, avec trois nouvelles opérations : `stock.opening`, `opening_balance.create` et `opening_balance.payment`.
- **Permissions** :

  | Opération | Permission requise |
  | --- | --- |
  | Stock de départ | `inventory.adjust` |
  | Créer une dette client | `customer.update` |
  | Créer une dette fournisseur | `supplier.update` |
  | Règlement d’un client | `payment.record` |
  | Règlement à un fournisseur | `purchase.create` |

- **Audit** : `stock.opening_posted`, `opening_balance.created` et `opening_balance.payment_recorded`.
- **Totaux** : la liste des clients ajoute le reste dû d’ouverture au solde (`openingDueXof` exposé à part). La liste des fournisseurs expose `openingDueXof`.

### Limites connues

- **Rapports et tableau de bord** : ils n’incluent pas encore les dettes d’ouverture ni leurs règlements. « Crédits clients ouverts » et « Encaissé » ne portent que sur les ventes faites dans Qadr Ops. C’est volontaire : pas de chiffre d’affaires fictif. À intégrer lors de la mission « rapports ».
- **Correction d’un solde d’ouverture erroné** : pas encore prévue (pas d’annulation ni de contre-écriture). À concevoir.
- **Brouillon du stock de départ** : il reste en mémoire dans la page. Il est perdu si la page est fermée avant l’enregistrement.

### À vérifier sur un vrai PostgreSQL (Neon) avant production

1. Appliquer `0008_opening_balances.sql` sur une **copie** de la base, avec autorisation : remplacement des trois contraintes `CHECK` et ajout de colonnes et d’index sur `stock_movement`, sans perte de données.
2. Faire deux `postStockOpening` concurrents sur le même produit : l’un doit échouer (unicité ou 409), sans double stock.
3. Mesurer les plans d’exécution :
   - pagination des produits : `ORDER BY name, id` avec `ILIKE` ;
   - pagination des mouvements : index `stock_movement_business_date_idx`.
4. Vérifier le comportement de `FOR UPDATE OF product_variant` avec le pool `neon-serverless`.

---

# Historique : conception initiale (mission 05)

Statut au 2026-10-30 (mission 05) : **non implémenté**. Ce document décrit où et comment l'ajouter. Il n'autorise aucune modification de la base sans validation du périmètre par le propriétaire.

## Pourquoi c'est une opération à part

Quand un commerce commence à utiliser Qadr Ops, il a déjà de la marchandise. Ce stock de départ :

- **n'est pas une vente** : il n'entre ni dans le chiffre d'affaires ni dans les créances ;
- **n'est pas un achat** : il n'y a ni fournisseur, ni dette fournisseur, ni décaissement ;
- **n'est pas un inventaire** : il n'y a pas d'écart par rapport à un stock théorique déjà suivi.

L'enregistrer comme l'une de ces opérations fausserait les rapports et l'historique (règle 8 de `CLAUDE.md`).

## Contrainte actuelle du schéma

La table `stock_movement` (`apps/web/src/lib/db/schema.ts`) impose aujourd'hui deux règles :

- `stock_movement_reason_check` : `reason` ∈ `sale`, `purchase`, `inventory_adjustment`, `manual_adjustment`, `return` ;
- `stock_movement_source_one_check` : exactement une source parmi `sale_line_id`, `purchase_line_id` et `inventory_line_id`.

Aucun mouvement d'ouverture ne peut donc être enregistré sans **migration**.

## Proposition (à valider)

1. **Nouvelle table `stock_opening`** : `business_id`, `id`, statut `draft | posted`, `posted_by`, `posted_at`, `note`, avec la clé composée `(business_id, id)`.
2. **Nouvelle table `stock_opening_line`** : `business_id`, `opening_id`, `variant_id`, `quantity`, `unit_cost_xof` (facultatif, pour initialiser le coût moyen), `source_reference` (ligne d'un import Qadr Capture, par exemple). Contrainte unique `(business_id, opening_id, variant_id)`.
3. **Modifications de `stock_movement`** :
   - nouvelle valeur `opening` pour `reason` ;
   - nouvelle colonne `opening_line_id` (FK composée tenant), ajoutée au contrôle « une seule source » ;
   - index unique partiel sur `(business_id, opening_line_id)`.
4. **Service `postStockOpening`** :
   - vérifier la permission `inventory.adjust` ;
   - appeler `assertBusinessOperational` ;
   - passer par `runIdempotent`, avec une clé fournie par le client et le nom ajouté à `idempotency_operation_check` ;
   - tout faire dans une seule transaction : un mouvement `opening` par ligne, mise à jour de `on_hand` et du coût moyen, puis un événement d'audit `stock.opening_posted`.
5. **Règle métier proposée** : une ouverture n'est autorisée que pour une variante qui n'a encore aucun mouvement. Après la première vente, la correction passe par un inventaire, pas par une nouvelle ouverture.
6. **Tests** :
   - isolation entre deux commerces A et B ;
   - idempotence face à une double soumission ;
   - refus si la variante a déjà des mouvements ;
   - ajout à `operation-integrity.integration.test.ts`.

## Place dans l'interface

- **Stock** : un bouton « Saisir le stock de départ » visible tant que des articles n'ont aucun mouvement, avec un parcours de saisie proche de l'inventaire (recherche, stepper de quantité, sauvegarde progressive).
- **Historique** : les mouvements `opening` portent un badge distinct (« Stock d'ouverture »), jamais celui d'un achat ou d'un ajustement.
- **Qadr Capture** : l'import d'un cahier de stock produit un brouillon `stock_opening` à relire, jamais des achats fictifs.
