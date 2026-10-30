# QADR OPS

SaaS de gestion commerciale multi-tenant pour quincailleries, téléphonie, boutiques générales et vêtements.

## Structure du dépôt

Le dépôt contient deux applications **indépendantes**. Chacune a ses propres dépendances et ses propres commandes.

| Emplacement | Rôle | Pile | Lancer depuis |
| --- | --- | --- | --- |
| racine (`src/`, `public/`, `test/`, `data/`) | **MVP historique**, conservé comme référence fonctionnelle | Node.js pur, aucune dépendance, stockage JSON | la racine |
| `apps/web/` | **Application SaaS cible**, où se fait le développement actif | Next.js 16, Better Auth, Drizzle, Neon/PGlite | `apps/web` (voir [apps/web/README.md](apps/web/README.md)) |
| `docs/` | Architecture, modèle métier, administration de la plateforme | — | — |
| `design-system/` | Charte graphique (`qadr-ops/MASTER.md`) | — | — |

Les migrations Drizzle sont dans `apps/web/drizzle/`. Le dossier `drizzle/` et les fichiers de configuration Next.js encore présents à la racine (`next.config.ts`, `tsconfig.json`, `package-lock.json`, etc.) sont d'**anciennes copies**. Ils sont exclus du versionnement par `.gitignore` et restent sur disque en attendant une suppression autorisée. Ne lancez aucune commande Next.js depuis la racine.

## Lancer le MVP historique

Prérequis : Node.js 22 ou plus récent (motifs de fichiers dans `node --test`).

```powershell
npm test
npm start
```

`npm test` n'exécute que `test/**/*.test.js`. Il ne touche pas aux tests de `apps/web`, qui passent par Vitest.

Ouvrez `http://localhost:3000`. Les données sont enregistrées dans `data/qadr-ops.json` (ignoré par Git). Pour les tests, un répertoire temporaire est utilisé.

## Fonctionnalités livrées

- Inscription d'un commerce et de son administrateur.
- Espaces clients isolés côté API par jeton de session signé.
- Produits, catégories libres, unités, attributs métier, seuil de stock.
- Vente comptant ou crédit, paiements mixtes, déduction atomique de stock et idempotence par clé client.
- Historique de mouvements, dépenses et tableau de bord issu de données réelles.
- Rôles `owner`, `manager`, `cashier`; l'employé ne peut pas administrer le commerce.
- Abonnements d'espace (`pending`, `active`, `suspended`, `expired`) distincts des paiements des ventes.

## Architecture et limites du MVP

L'API HTTP et l'interface statique n'ont aucune dépendance externe. Le stockage JSON est volontairement adapté à la démonstration et aux essais locaux, pas à la production ou à plusieurs processus serveur. Avant déploiement, remplacez `JsonStore` par PostgreSQL et appliquez le filtre `tenantId` au niveau des politiques de lignes (RLS), des requêtes et des clés d'index.

Les paiements Mobile Money sont modélisés avec les statuts `pending`, `confirmed`, `failed` et `refunded`; aucune intégration GeniusPay n'est simulée. Une intégration réelle devra vérifier la signature des webhooks, l'identifiant fournisseur, le montant, la devise et l'idempotence avant d'appeler la confirmation de paiement.

La décision d'intégration GeniusPay et le plan de sécurité du webhook sont détaillés dans [docs/architecture.md](docs/architecture.md).

## Superadministration et promotions

Créez le premier compte de plateforme au démarrage ; ces identifiants ne sont jamais créés depuis l'interface d'un commerce :

```powershell
$env:QADR_BOOTSTRAP_ADMIN_EMAIL = 'admin@votre-domaine.com'
$env:QADR_BOOTSTRAP_ADMIN_PASSWORD = 'choisissez-un-mot-de-passe-solide'
npm start
```

Ce compte ouvre le tableau « Promotions et codes promo ». Il peut générer/créer, consulter et désactiver les codes. Une entreprise nouvelle est en attente jusqu'à l'application d'un code d'essai ou d'accès VIP valide. Les réductions sont mémorisées sur l'abonnement en vue du futur module de facturation, sans être confondues avec les paiements d'une vente.

## Endpoints principaux

`POST /api/auth/register` crée un tenant, l'administrateur et une session. `POST /api/auth/login` ouvre une session. Les routes protégées requièrent `Authorization: Bearer <token>`.

| Route | Rôle minimal | Objet |
| --- | --- | --- |
| `GET /api/me` | connecté | identité et entreprise courante |
| `GET, POST /api/products` | cashier, manager | consulter/créer produits |
| `POST /api/sales` | cashier | créer une vente idempotente |
| `POST /api/payments/:saleId` | cashier | ajouter un paiement contrôlé |
| `GET /api/dashboard` | cashier | indicateurs du jour |
| `GET /api/stock-movements` | manager | historique de stock |
| `GET, POST /api/expenses` | manager | dépenses |

Les usages monétaires sont stockés en unités mineures (`priceMinor`: centimes), malgré la devise XOF sans décimales courantes.
