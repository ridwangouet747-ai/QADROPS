# QADR OPS — modèle métier initial

## Source unique des commerces et membres

Better Auth Organization 1.7.7 est la source de référence des organisations, membres, invitations et rôles. `organization.id` est exactement l'identifiant du commerce : toutes les tables métier stockent cet identifiant comme `business_id`, et `business_profile.business_id` est à la fois sa clé primaire et une FK vers `organization.id`. Il n'existe pas de table métier parallèle des membres. Les rôles plateforme sont séparés dans `platform_admin`; cette table ne donne aucun accès implicite aux données d'un commerce.

Les clés étrangères composées `(business_id, id)` empêchent la plupart des références croisées entre commerces. Toute lecture ou mutation API doit aussi filtrer par l'organisation active validée côté serveur et vérifier la permission Better Auth; les FKs ne remplacent pas l'autorisation. Les suppressions de commerces et des faits commerciaux sont restreintes; on archive ou change un statut, on ne supprime pas l'historique. Les cascades ne concernent que l'identité et le cycle de vie Better Auth (membres/invitations/sessions/comptes).

Rôles statiques fournis : `owner`, `admin`, `member`, `cashier`, `stock_manager`, `accountant`. Les autorisations précises sont centralisées dans `apps/web/src/lib/auth/permissions.ts`. L'édition dynamique de rôles, les équipes et la suppression d'organisation sont désactivées.

## Tables et liens

| Domaine | Tables | Principales relations |
| --- | --- | --- |
| Authentification | `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` | Organization est commerce; member est l'unique appartenance; session porte `active_organization_id`. |
| Commerce | `business_profile`, `platform_admin`, `receipt_settings` | Profil 1:1 de l'organisation; administration plateforme séparée; reçu par commerce. |
| Catalogue | `product_category`, `product`, `product_variant` | Catégorie/produit/variante tenant-scoped; variantes gardent stock courant, coût moyen et révision. |
| Ventes | `customer`, `sale`, `sale_line`, `payment`, `payment_refund`, `receivable_payment` | Vente avec lignes et paiements mixtes; un client est facultatif; remboursement est un événement séparé; allocations de crédit séparées. |
| Stock | `stock_movement`, `inventory_session`, `inventory_line` | Journal immuable et unique par ligne source; les sessions mémorisent comptage, référence théorique et version observée. |
| Achats et charges | `supplier`, `purchase`, `purchase_line`, `purchase_payment`, `expense` | Réception alimente le stock; règlements fournisseurs et dépenses sont distincts. |
| SaaS et audit | `subscription_plan`, `business_subscription`, `subscription_payment`, `promotion_code`, `promotion_redemption`, `audit_event`, `payment_provider_event` | Paiement SaaS dans une table financière distincte des encaissements magasin; événements prestataire idempotents; audit append-only. |

Les rapports sont calculés depuis les écritures et ne sont pas stockés comme agrégats mutables. `payment` ne contient que les paiements de ventes aux clients et `recorded_by_user_id` rattache une saisie manuelle à un membre du bon commerce; `subscription_payment` ne contient que les règlements de l'abonnement du commerçant à QADR OPS.

## Montants et coût

Les encaissements, prix, remises, dépenses et remboursements XOF sont des `bigint` en francs entiers. Les quantités sont `numeric(24,6)` et les coûts unitaires moyens `numeric(30,12)`; le code métier doit garder ces valeurs en chaînes décimales ou en entiers mis à l'échelle, jamais en `number` flottant. La sérialisation API des `bigint` doit utiliser des chaînes.

À réception : `nouveau coût moyen = (ancienne quantité × ancien coût moyen + quantité reçue × coût d'achat unitaire) / quantité totale`. Si l'ancien stock est nul, le coût reçu devient le coût moyen. Le calcul est conservé à 12 décimales et arrondi moitié vers le haut; le COGS d'une ligne de vente est arrondi au franc entier le plus proche, moitié vers le haut. Le coût moyen reste une valeur décimale en XOF par unité de base. La vente fige `unit_cost_snapshot_xof` et `cogs_xof` pour rendre la marge historique stable.

Le helper `apps/web/src/lib/domain/costing.ts` implémente ces règles en `bigint`; les opérations réelles doivent en plus utiliser un verrou transactionnel de la variante et écrire projection + journal atomiquement.

## Inventaires et idempotence

Une ligne d'inventaire capture `counted_at`, `theoretical_qty` et `expected_stock_revision` au moment où le comptage physique est saisi, ainsi que `counted_qty`, le membre compteur et le motif obligatoire en cas d'écart. `inventory_scope_variant` fige au démarrage les variantes du périmètre (tout le stock actif ou une catégorie), tandis que le stock de référence n'est capturé qu'au comptage de chaque ligne. Le cycle est `counting → submitted → validated` (ou `canceled`). La validation est une transaction interactive : elle exige un membre habilité distinct de tous les compteurs, verrouille la session et les variantes dans l'ordre des identifiants, écrit une seule fois le mouvement `counted_qty - theoretical_qty`, puis ajoute cet écart au stock courant et incrémente sa révision. Les entrées/sorties postérieures restent donc dans le stock final. Une opération qui rendrait le stock négatif est refusée en entier et nécessite une réconciliation. La clé unique par ligne rend un rejeu sans double ajustement.

Une vente atomique verrouille toutes les variantes dans un ordre stable, vérifie les quantités, écrit vente/lignes/paiements confirmés/mouvements, puis met à jour le stock. Les contraintes uniques sur référence + clé d'idempotence arrêtent les doubles soumissions. Les paiements externes commencent en attente et ne deviennent confirmés que par webhook vérifié ou confirmation serveur-à-serveur; `payment_provider_event` déduplique les notifications. Les totaux de remboursements et d'encaissements doivent être contrôlés dans la même transaction que l'écriture.

Les achats reçus, les dépenses et les règlements de créance sont idempotents par `idempotency_record`, depuis la migration `0007`. La clé primaire `(business_id, idempotency_key)` isole les clés par commerce. La table conserve l'opération, l'empreinte SHA-256 de la requête normalisée (acteur compris) et le résultat JSON renvoyé à la première exécution, écrit dans la même transaction que l'opération. Une soumission concurrente avec la même clé échoue sur la clé primaire, est annulée en entier, puis reçoit le résultat déjà enregistré. Le paiement issu d'un règlement de créance porte `payment.idempotency_key = 'receivable:<clé client>'`.

Toute écriture commerciale vérifie d'abord, dans sa transaction, que le commerce est opérationnel (`apps/web/src/lib/domain/operation-guard.ts`) : profil ni `suspended` ni `expired`, et abonnement en vigueur s'il en a déjà eu un. Le verrou `FOR SHARE` sur `business_profile` fait attendre une suspension concurrente jusqu'à la fin des écritures en cours.

## Définitions de rapport

- Chiffre d'affaires des ventes : somme de `sale.total_xof` des ventes finalisées sur `occurred_at`, remises déjà déduites, avant remboursements; les ventes annulées sont exclues.
- Remboursements : somme des remboursements confirmés selon leur propre `occurred_at`, présentée séparément; ventes nettes de remboursement = chiffre d'affaires des ventes moins remboursements sur la période de remboursement choisie (ne pas réécrire la date historique de la vente).
- Encaissements : paiements confirmés par date de confirmation/encaissement, ventilés par mode; un paiement en attente/échoué ne compte pas. Le mode correspond au paiement, pas à la vente.
- Créances ouvertes à date : solde des ventes finalisées liées à un client, moins paiements confirmés rattachés à ces ventes, jusqu'à la borne de fin. Les remboursements sont affichés séparément et ne règlent pas automatiquement une créance : le modèle courant n'enregistre pas d'affectation du remboursement à une créance ni d'extinction. Toute extinction devra devenir une écriture dédiée et auditée. Les créances sont un solde à date, pas un flux de ventes de la période.
- Dépenses : dépenses enregistrées selon leur date d'occurrence; les achats de stock restent des achats/fournisseurs et ne sont pas une charge de période par défaut.
- Marge brute estimée : ventes nettes des remises moins COGS figés à la vente, avant remboursements faute d'affectation fiable par ligne. Elle n'est publiée que si chaque ligne de vente de la période a un coût marqué disponible (`cost_available`). Ne pas appeler cela bénéfice net : frais, taxes et autres charges peuvent manquer.
- Semaines : lundi 00:00 à dimanche 23:59:59.999 selon le fuseau du commerce; période personnalisée demi-ouverte `[début, fin)` pour éviter les doubles comptes aux frontières. Les vues jour/semaine/mois/année suivent le même fuseau. La période précédente est la période calendaire de même nature; le pourcentage de variation est indisponible quand son chiffre d'affaires vaut zéro.

## Driver et environnement

Le driver est passé de Neon HTTP à `drizzle-orm/neon-serverless` avec `Pool` parce que les encaissements, ventes et inventaires requièrent transactions interactives avec verrouillage et lecture conditionnelle. L'API HTTP convient aux requêtes isolées/batchées mais ne constitue pas une transaction interactive adaptée à ces scénarios. Le routeur Better Auth est explicitement Node.js; le projet demande Node `24.x` afin de s'appuyer sur le WebSocket global effectivement constaté en local (Node 24.15). La documentation Vercel consultée annonce Node 24.x, 22.x et 20.x; aucune configuration/projet Vercel réel n'est disponible ici, donc l'exécution du déploiement reste à confirmer dans les paramètres du projet.

Neon n'a pas été contacté, aucun test de connexion n'a été effectué et aucune migration distante n'a été appliquée. La génération Drizzle produit uniquement des fichiers SQL locaux. Avant premier déploiement, créer/identifier une base strictement développement, vérifier le runtime Node du projet Vercel et exécuter les migrations sur un environnement isolé après sauvegarde/restauration vérifiée.

## Validation locale et premiers services

`@electric-sql/pglite` est une dépendance de développement uniquement. Les tests créent une instance PostgreSQL embarquée neuve en mémoire, appliquent le SQL versionné avec le migrateur Drizzle PGlite, vérifient la seconde exécution et ferment cette instance. Le runtime continue d'utiliser le pool Neon WebSocket dans `apps/web/src/lib/db/client.ts`; aucun secret ou URL distante ne sert aux tests.

La première exécution réelle a révélé que `payment_provider_event` référençait `(subscription_payment.business_id, id)` sans unicité correspondante. La table `subscription_payment` a maintenant `subscription_payment_business_id_unique`; la définition, le SQL local `0003` et les snapshots sont alignés. Ce correctif doit être inclus dans la séquence initiale de migration avant toute base partagée. Aucune migration distante n'a été exécutée.

Le parcours de base est implémenté dans `apps/web/src/lib/domain/commercial.ts` et les routes `POST/GET /api/business/products` et `POST /api/business/sales`. Le serveur choisit le commerce à partir de l'organisation active Better Auth, puis le service vérifie l'appartenance et la permission métier. Les routes n'acceptent pas de `businessId` fourni par le client. La création produit crée une variante standard avec stock nul; les entrées de stock initiales ne sont pas encore un module. Une vente vérifie le prix depuis la base, quantifie en entiers à l'échelle 10^-6, verrouille les variantes, contrôle le stock, écrit vente/lignes/paiements/mouvements/audit dans une transaction et refuse tout encaissement supérieur au total. Les paiements partiels laissent un solde dû calculé, mais l'enregistrement ultérieur d'un règlement de créance reste à implémenter. La répétition de la même clé et du même contenu renvoie la vente existante; le contenu différent est rejeté.

`apps/web/src/components/receipts/thermal-receipt.tsx` et la page d'aperçu lisent un reçu existant sans créer de vente. L'impression utilise le dialogue navigateur et propose le « Enregistrer au format PDF » fourni par le navigateur; une largeur CSS 58/80 mm ne garantit pas que le pilote ou l'imprimante adopte le bon format. L'accès USB direct, les pilotes, les tiroirs-caisses et les imprimantes physiques n'ont pas été testés.

PGlite valide ici le SQL, les contraintes, les opérations transactionnelles sur une seule instance, l'atomicité en cas d'exception, les clés d'idempotence et la portée tenant des services testés. Il ne valide pas les conflits simultanés entre connexions, le comportement multi-session de PostgreSQL serveur, le pool WebSocket Neon, Vercel, ni le matériel d'impression. Ces vérifications restent requises plus tard sur un PostgreSQL local/CI, puis une base Neon de développement explicitement identifiée.

## Phase 4 : inventaires et rapports

Les services `apps/web/src/lib/domain/inventory.ts` et `apps/web/src/lib/domain/reports.ts` et les routes `/api/business/inventories`, `/api/business/inventories/[sessionId]` et `/api/business/reports` fournissent le comptage, la soumission, la validation, le détail historique et les rapports agrégés. L'export CSV est limité au commerce autorisé, préfixe les cellules pouvant déclencher une formule et inclut une BOM UTF-8. Le rapport imprimable peut être enregistré en PDF via le navigateur.

Les périodes sont journalières, hebdomadaires, mensuelles, annuelles ou personnalisées (limite 366 jours). Le rapport sépare chiffre d'affaires daté de la vente, paiements datés de confirmation, remboursements par date d'occurrence, créances en solde à la fin de période, dépenses et achats reçus. Il présente panier moyen, ventes payées/partiellement payées/à crédit, évolution et produits les plus vendus. Les achats ne sont pas traités comme charges. La marge brute est masquée si un seul coût manque et reste une estimation avant remboursements, jamais un bénéfice net.

La migration locale `0005_phase4_inventory_reports.sql` ajoute le périmètre figé d'inventaire, l'étape de soumission, les membres ayant compté et les motifs d'écart, ainsi que les marqueurs explicites de disponibilité du coût (`cost_known`, `cost_available`). Elle rétro-remplit le compteur des anciennes lignes d'inventaire depuis le membre initiateur avant d'imposer la contrainte NOT NULL. Elle n'a été appliquée qu'à une instance de test locale PGlite, pas à Neon.

Les services de règlements ultérieurs de créances, réceptions fournisseurs, remboursements, clôture de caisse et intégration matérielle d'impression restent hors périmètre. PostgreSQL ne peut pas exprimer les plafonds agrégés (somme paiements ≤ vente, remboursements ≤ paiement) par un simple `CHECK`; tout règlement/remboursement devra les vérifier dans une transaction avec verrouillage. Toute nouvelle relation tenant ajoutée doit conserver les clés composées.
