# Performance et base de données

Mission 11, phase 6 (2026-11-03). Ce document décrit les mesures locales, les changements appliqués aux requêtes, la pagination par curseur, les index et l'ordre des verrous. Constats d'origine : `docs/engineering/mission-11-plan.md` § 2 (D-1 à D-7).

> **Limite principale.** Toutes les durées viennent de PGlite, qui exécute PostgreSQL en WebAssembly dans le processus Node, sans réseau et avec une seule connexion. Elles ne sont **pas représentatives de Neon**. Sur Neon, chaque requête coûte au moins un aller-retour réseau. Le **nombre de requêtes** est donc l'indicateur transposable, pas les millisecondes. La mesure sur Neon reste bloquée tant qu'il n'existe pas de préproduction (blocage **B-1**).

## 1. Méthode

- Script : `apps/web/scripts/bench-pglite.ts`. Lancez-le depuis `apps/web` avec `npx tsx scripts/bench-pglite.ts`. `BENCH_RUNS=7` fixe le nombre de passages (5 par défaut). Le script ne contacte aucune base distante.
- Jeu de données synthétique, chargé en SQL (`generate_series`). Il comprend deux commerces. Chacun a 5 000 produits et variantes, 1 500 clients et 150 fournisseurs. Il a aussi 20 000 ventes de 2 lignes réparties sur 400 jours, avec leurs paiements, sorties de stock et règlements de crédit. S'y ajoutent 3 000 dépenses, 600 achats, 100 dettes d'ouverture et 5 000 événements d'audit. Un `analyze` suit le chargement.
- Pour chaque opération, le script compte les requêtes SQL avec le logger Drizzle, sans `BEGIN` ni `COMMIT`. Il garde la durée médiane de N passages, après un passage de chauffe.
- **Bruit** : la machine de mesure était partagée avec d'autres processus. Des durées médianes de la même opération ont varié de 30 à 50 % d'un lancement à l'autre. Pour limiter ce biais, l'avant et l'après ont été mesurés **l'un juste après l'autre**, 7 passages chacun. L'avant a tourné sur le code de `6362d27`, restauré temporairement dans le même répertoire de travail.

## 2. Résultats (PGlite, 2026-11-03)

| Opération | Requêtes avant | Requêtes après | Médiane avant (ms) | Médiane après (ms) |
| --- | --- | --- | --- | --- |
| Tableau de bord (`getBusinessOverview`) | 31, dont environ 26 en parallèle | 7, dont au plus 4 en parallèle | 425,3 | 245,5 |
| Rapport mensuel complet (`getCommercialReport`) | 24 | 3 | 273,3 | 154,6 |
| Liste complète des clients (`GET /api/business/customers`) | 2 | 2 | 104,7 | 77,2 |
| Page de 50 clients (`?limit=50`) | absente | 2 | — | 6,3 |
| Vente de 20 lignes (`createSale`) | 71 | 14 | 94,7 | 34,9 |

Autres lancements, pour situer le bruit :
- Un premier « avant » (5 passages, machine moins chargée) : 369,3 / 297,0 / 87,2 / 109,3 ms.
- Un « après » lancé juste avant l'« avant » apparié : 301,9 / 327,0 / 104,1 / 7,4 / 37,2 ms.

Les nombres de requêtes sont identiques d'un lancement à l'autre.

Sur Neon, le gain attendu vient surtout des allers-retours supprimés : 24 de moins pour le tableau de bord, 21 pour un rapport et 57 pour une vente de 20 lignes. Le chiffre reste à mesurer (B-1).

## 3. Changements par constat

### D-1 : tableau de bord

`getBusinessOverview` envoie 7 requêtes :
- une requête lit l'identité, la permission `report:read` et le profil ;
- trois requêtes viennent de `getDashboardReports` (`reports.ts`) : une pour les chiffres de base des quatre périodes (jour, veille, semaine, semaine précédente), puis une par résumé ;
- trois listes sont lues l'une après l'autre (ventes récentes, stock bas, activité).

Au plus 4 requêtes sont en vol en même temps, contre environ 26 avant. La réponse garde la même forme. Le test `performance.integration.test.ts` vérifie que `getDashboardReports` renvoie exactement `getCommercialReport` du jour et de la semaine.

### D-3 : rapports bornés par la période

`getCommercialReport` envoie 3 requêtes :
- la permission et le fuseau ;
- les chiffres de base de la période et de la période de comparaison, en une requête `VALUES … CROSS JOIN LATERAL` ;
- un instantané qui rassemble tout le reste.

Les agrégats qui parcouraient tous les paiements du commerce, comme la répartition payé / partiel / crédit et les créances à la fin de période, ne lisent plus que les paiements des ventes concernées (`LATERAL` par vente). Les chiffres ne changent pas. Le test d'équivalence rejoue les requêtes historiques non bornées sur août, septembre et octobre, avec des paiements avant, pendant et après la période. Il compare aussi un cas calculé à la main.

### D-5 : scans et N+1

- `getBusinessSale` filtre les remboursements en SQL, par jointure sur les paiements de la vente. Avant, il lisait tous les remboursements du commerce puis les filtrait en JavaScript.
- `listInventorySessions` fait une seule requête, avec des compteurs en sous-requêtes indexées. Avant, il faisait 2 requêtes par inventaire, soit jusqu'à 201.

### D-2 : verrous de vente et inventaire

- **Vente** : les variantes sont verrouillées par **un seul** `SELECT … FOR UPDATE` trié par identifiant croissant, comme avant. Les écritures sont désormais groupées : une insertion pour toutes les lignes, un `UPDATE … FROM (VALUES …)` pour tout le stock (`setVariantStock`, `src/lib/domain/stock-writes.ts`), une insertion pour les mouvements et une pour les paiements. Le verrou est tenu le temps de 4 requêtes au lieu de 3 par ligne. L'idempotence, la caisse ouverte (`attachOpenCashSession`) et les notifications sont inchangées.
- **Inventaire** :
  - `INVENTORY_MAX_LINES` vaut 2 000 produits par comptage (`inventory.ts`). Au-delà, `startInventory` répond `422` avec le code `inventory_too_large`. L'écran affiche le message traduit `inventory.start.tooLarge` (fr, en, ar), qui demande de choisir une catégorie.
  - La validation écrit par lots de 500 : stock et mouvements, deux requêtes par lot.
  - Un inventaire déjà ouvert au-delà de 2 000 lignes, créé avant ce plafond, reste validable.
- **Non modifié** : la réception d'achat (`createReceivedPurchase`) verrouille déjà ses variantes en une requête triée. Elle écrit encore ligne par ligne, avec un maximum de 100 lignes.

### D-6 : interblocages et écritures pendant une lecture

- `updateBusinessSettings` prend d'abord `FOR UPDATE` sur `business_profile`, avant `assertBusinessOperational`. Ce dernier prenait `FOR SHARE` sur la même ligne, puis la transaction voulait la mettre à jour. Deux enregistrements simultanés pouvaient alors s'interbloquer. L'ordre est désormais fixe : profil, organisation, réglages du ticket.
- `getPlatformOverview` et `listPlatformSubscriptions` n'appellent plus `expireDueSubscriptions`. Aucune lecture n'écrit en base.
  - Le statut affiché est calculé par `effectiveSubscriptionStatus` : un essai ou un abonnement actif dont l'échéance est passée se lit « expired ». C'est aussi le cas dans `listPlatformBusinesses` et `getPlatformBusiness`.
  - Le filtre par statut suit le statut affiché.
  - L'écriture et son audit sont faits par le cron quotidien `/api/cron/subscriptions`.
  - L'accès commercial était déjà refusé dès l'échéance par `assertBusinessOperational`.

### D-7 : pagination par curseur

Le modèle est celui de `GET /api/business/products?limit=`. Si `limit` ou `cursor` est présent, la route renvoie `{ items, nextCursor }`. `limit` va de 1 à 100 (24 par défaut). Sinon, la **réponse historique est inchangée**.

| Route | Tri | Réponse sans paramètre (inchangée) |
| --- | --- | --- |
| `GET /api/business/customers` | nom, puis identifiant | `{ customers }`, la liste complète (caisse) |
| `GET /api/business/suppliers` | nom, puis identifiant | `{ suppliers }`, la liste complète |
| `GET /api/business/stock` | nom du produit, puis variante | `{ items, movements }` ; en mode paginé, seulement les niveaux (les mouvements ont `/api/business/stock/movements`) |
| `GET /api/business/sales` | date décroissante, puis identifiant | `{ sales }`, 200 lignes ; `from` et `to` restent valables en mode paginé |
| `GET /api/business/purchases` | date décroissante, puis identifiant | `{ purchases }`, 200 lignes |
| `GET /api/business/expenses` | date décroissante, puis identifiant | `{ expenses }`, 200 lignes |

- Le curseur est opaque (base64url). Il ne contient que les clés de tri, jamais d'identifiant de commerce. Un curseur invalide donne `400`.
- Le curseur de date garde la valeur exacte de PostgreSQL en texte, à la microseconde. Deux lignes à la même date sont départagées par l'identifiant, sans perte ni doublon.
- Les tests couvrent les points suivants :
  - l'union des pages est égale à la liste historique, dans le même ordre ;
  - aucune ligne n'est répétée ;
  - un curseur de A rejoué dans B ne renvoie que des lignes de B ;
  - un membre de B ne lit pas A (`403`) ;
  - un curseur falsifié donne `400`.
- **Écrans (mission 12, lot L3).** Produits et stock (niveaux, mouvements) utilisaient déjà `usePagedList`. Clients, fournisseurs, ventes, achats et dépenses (`business-suite-workspace.tsx`) chargent désormais 50 lignes, puis « Charger la suite » ajoute la page suivante sans retirer les lignes affichées ; en fin de liste, le bouton disparaît et « Toutes les lignes sont affichées » s'affiche. Après une écriture, la liste repart de la première page ; une page « suite » arrivée après un rechargement est ignorée. Ces écrans n'ont ni filtre ni recherche côté client. La caisse et le formulaire de réception d'achat lisent toujours le catalogue et les fournisseurs complets, sans `limit`.
- La liste complète des clients et sa page n'utilisent pas le même plan, et les deux ont été mesurés :
  - la page lit les ventes client par client (`LATERAL`, index) ;
  - la liste complète agrège en une passe les seules ventes rattachées à un client.
  - Les soldes sont comparés à la requête historique dans les tests.

### D-4 : index (migration `0017_performance_indexes`)

Seules des créations d'index : la migration n'est pas destructive. Chaque index sert une requête existante, et tous commencent par `business_id`, sauf ceux de `notification_delivery`, une table de plateforme sans commerce.

| Index | Requête servie |
| --- | --- |
| `customer_business_name_idx (business_id, name, id)` | liste et pages de clients |
| `sale_customer_idx (business_id, customer_id)`, partiel | soldes clients |
| `purchase_supplier_idx (business_id, supplier_id)` | totaux par fournisseur |
| `purchase_payment_purchase_idx (business_id, purchase_id)` | montant payé de chaque achat (journal des achats) |
| `purchase_payment_cash_session_idx`, `expense_cash_session_idx`, `refund_cash_session_idx`, `opening_payment_cash_session_idx` (`business_id, cash_session_id`), partiels | totaux de clôture de caisse (`cash-session.ts`) |
| `refund_business_date_idx (business_id, occurred_at)` | remboursements d'une période (rapports) |
| `notification_delivery_subscription_idx (subscription_id, status, attempted_at)` | limite d'envois par appareil |
| `notification_delivery_attempted_idx (attempted_at)` | statistiques de la console |

`purchase_line` n'a pas reçu d'index sur `purchase_id`, contrairement à ce qu'annonçait D-4. Aucune requête de l'application ne lit les lignes d'un achat par `purchase_id`. Ses mouvements de stock sont retrouvés par `purchase_line_id`, qui est déjà unique. Les achats ne sont jamais supprimés, donc la clé étrangère n'a pas de recherche à faire. Cet index sera à ajouter avec le premier écran de détail d'achat.

**À l'application sur Neon** : `CREATE INDEX`, sans `CONCURRENTLY`, bloque les écritures de la table pendant sa construction. C'est sans conséquence tant que les tables sont vides, ce qui est le cas aujourd'hui puisqu'aucune migration n'a été appliquée à Neon. Sur des tables déjà remplies, il faudra planifier un créneau ou appliquer ces index à la main avec `CONCURRENTLY`.

## 4. Règles durables

- **Ordre des verrous** : verrouillez les variantes en une seule requête `FOR UPDATE` triée par identifiant, puis écrivez en lots (`setVariantStock`). Pour les réglages du commerce, l'ordre est profil, organisation, puis réglages du ticket.
- **Lecture sans écriture** : une route GET n'écrit jamais. Un état dérivé du temps, comme une échéance passée, se calcule à la lecture.
- **Listes** : toute nouvelle liste longue reçoit le mode `?limit=`/`cursor`, avec un tri total qui se termine par l'identifiant. La réponse sans paramètre ne change pas.
- **Index** : seulement pour une requête réelle, préfixés par `business_id` pour les données d'un commerce.

## 5. Non vérifié

- Durées sur Neon et sous charge concurrente réelle (B-1). PGlite n'a qu'une connexion, si bien que l'interblocage de `updateBusinessSettings` ne peut pas y être reproduit. Sa correction est raisonnée, pas démontrée.
- Plans d'exécution sur PostgreSQL réel avec des statistiques de production.
- Comportement du bouton « Charger la suite » sur plus de quelques centaines de lignes réelles : vérifié seulement en aperçu local (PGlite, 53 dépenses d'essai).
