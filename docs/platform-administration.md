# QADR OPS — Administration de plateforme

> Mise à jour mission 08 (2026-10-31) : console « Qadr Ops Platform » refondue (identité monochrome, sept rubriques), machine à états des abonnements, codes d'accès générés en série, quotas de forfait appliqués côté serveur, journal d'audit en ajout seul. Les sections historiques ci-dessous restent valables sauf mention contraire.

## Mission 08 — état livré

### Identité visuelle isolée

Business garde FINNOVA (lavande, violet, bleu nuit). Platform utilise des jetons préfixés `pf-` déclarés dans `src/app/globals.css` (`--color-pf-*`, `--shadow-pf-*`) et des composants propres dans `src/components/platform/pf-ui.tsx`. Aucun composant Business n'importe ces fichiers ; aucun jeton Business n'a été modifié. Référence : grand plan blanc cassé translucide, navigation latérale en pilules (active en noir), cartes blanches arrondies, panneaux anthracite, très grands titres, graphiques fins sans bibliothèque.

### Rubriques

| Rubrique | Route | Contenu |
| --- | --- | --- |
| Vue d'ensemble | `/platform` | Commerces par état réel (actif, essai, suspendu, expiré, sans abonnement), abonnements en attente et à échéance sous 7 jours, inscriptions par jour/semaine (7, 30, 90 j), répartition par forfait, panneaux sombres (activité, alertes, abonnements à surveiller), revenus distinguant facturé / encaissé / en attente / remboursé / avantages promotionnels, dernières inscriptions et opérations, récapitulatif des forfaits. Tout vient de `GET /api/platform/overview`. |
| Commerces | `/platform/businesses` | Recherche (nom, téléphone, e-mail ou nom du propriétaire), filtres état et forfait, propriétaire, date, membres, forfait ; fiche avec abonnements et historique administratif ; suspension et réactivation confirmées avec motif obligatoire. |
| Abonnements | `/platform/subscriptions` | Commerce, forfait, période, jours restants, statut, origine (manuel, code d'accès, paiement), historique, paiements ; prolongation ou annulation motivées. |
| Forfaits | `/platform/plans` | Code, nom, description, prix XOF, devise (XOF uniquement), durée, fonctionnalités, utilisateurs et produits max, stockage, actif/inactif ; avant/après dans l'audit. |
| Promotions | `/platform/promotions` | Génération en série de codes d'accès (7 j, 21 j, 1 mois, 3 mois, durée libre), forfait, utilisation unique ou multiple, début, expiration, commerce éligible, campagne ; pause, reprise, révocation motivées ; états actif, programmé, en pause, épuisé, expiré, révoqué. |
| Activité et audit | `/platform/audit` | Recherche plein texte (motif, campagne, auteur…), filtre par famille d'actions et par dates, pagination par date. |
| Paramètres | `/platform/settings` | Profil, liste des administrateurs, procédure d'attribution, rappels (paiements non intégrés, expiration automatique). |

Le module Paiements n'apparaît pas : aucun prestataire de paiement d'abonnement n'est intégré.

### Sécurité

- Accès : `getPlatformContext` (session Better Auth + `platform_admin` non révoqué) sur chaque page et route, et `requirePlatformAdmin` dans chaque service. Un rôle de commerce ne donne jamais accès.
- Attribution : **uniquement** `scripts/platform-admin.ts` (`grant` / `revoke`), avec `QADR_DB_TARGET`, confirmation saisie « CONFIRMER », motif obligatoire, trace `platform.admin_granted|revoked`. Impossible de retirer le dernier administrateur. Aucune route HTTP, aucune inscription publique.
- Aucun accès aux données commerciales (ventes, clients, stocks) depuis la console.

### Machine à états des abonnements (`src/lib/domain/subscription-lifecycle.ts`)

Valeurs du schéma conservées (`canceled` garde son orthographe), `trialing` ajouté par la migration 0010 :

```
pending → trialing | active | canceled
trialing → active | suspended | expired | canceled
active → suspended | expired | canceled
suspended → trialing | active | expired | canceled
expired, canceled : terminaux (une nouvelle période crée un nouvel abonnement)
```

- Expiration sans intervention : `assertBusinessOperational` refuse les opérations dès l'échéance (essai ou actif) ; `expireDueSubscriptions` normalise les statuts à chaque lecture de la console et via `GET /api/cron/subscriptions` (en-tête `Authorization: Bearer $CRON_SECRET`, 404 sans secret). Chaque expiration écrit `subscription.expired` (auteur : système).
- Suspension : les périodes en cours passent `suspended` en mémorisant leur état (`status_before_suspension`) ; la réactivation les rétablit, ou les expire si l'échéance est passée.
- Pas de cercle vicieux avec `pending` : un code d'accès appliqué par le propriétaire ou l'administrateur du commerce (`POST /api/business/subscription/promotion`) transforme l'abonnement en attente en essai, ou crée un essai s'il n'y en a pas, ou prolonge l'essai/abonnement en cours du même forfait. Aucun paiement n'est créé : une période offerte n'est jamais un revenu.
- Application d'un code : verrou sur la ligne du code, une fois par commerce (contrainte unique), rejouable (le même envoi renvoie le résultat initial, `replayed: true`), refus des codes révoqués, en pause, expirés, épuisés, non éligibles, ou d'un autre forfait en cours ; tracée (`subscription.access_code_redeemed`).
- Codes : 12 caractères tirés par `crypto.randomInt` dans un alphabet sans ambiguïté (31 symboles, ≈ 59 bits), préfixe facultatif, série de 1 à 200 ; ils ne sont montrés qu'une fois et jamais écrits dans le journal.

### Quotas de forfait appliqués côté serveur (`src/lib/domain/plan-limits.ts`)

- Utilisateurs : membres non désactivés + invitations encore valables ≤ `userLimit` (vérifié avant chaque nouvelle invitation ; une invitation renouvelée garde sa place).
- Produits actifs ≤ `productLimit` (vérifié dans `createProduct`).
- Sans abonnement en cours, aucune limite (politique « sans abonnement » toujours non tranchée).
- Les cases de fonctionnalités (caisse, rapports, inventaires, achats) et le stockage sont **indicatifs** : ils ne sont pas encore appliqués, et l'interface le dit.

### Journal d'audit

Chaque entrée : auteur (ou Système), action, commerce concerné, avant, après, motif, résultat, date. La migration 0010 ajoute un déclencheur `audit_event_no_update_delete` qui refuse toute modification ou suppression (« audit_event est en ajout seul »), testé.

### Migration locale `0010_platform_onboarding.sql`

Statut `trialing`, origine et état avant suspension des abonnements ; description, devise, stockage des forfaits ; type, forfait, durée offerte, campagne, série, révocation des codes ; format du commerce et clé de création (onboarding) ; nom affiché sur les reçus ; index ; déclencheur d'audit. Jamais appliquée à Neon.

### Tests

`platform-console.integration.test.ts` (PGlite, 14 tests) et `platform.integration.test.ts` (6 tests, mis à jour : motif obligatoire, rejeu idempotent).

## Séparation et autorisations

La console `/platform` est distincte des espaces commerciaux. En environnement réel, l'accès exige une session Better Auth valide et un enregistrement actif dans `platform_admin` (`revoked_at IS NULL`). Un rôle `owner`, `admin` ou tout autre rôle d'organisation ne confère jamais ce privilège. Les pages et toutes les API plateforme effectuent ce contrôle côté serveur; les services vérifient également le grant avant chaque lecture ou écriture. Une révocation prend effet à la prochaine requête. Aucun compte plateforme n'est créé automatiquement en production.

Le contrôle plateforme ne donne pas d'accès implicite aux ventes, clients, lignes de caisse, paiements des clients, reçus, produits ou stocks. La fiche d'un commerce ne présente que l'identité et les coordonnées administratives, le nombre de membres et les abonnements. Les actions de suspension/réactivation touchent le profil et les abonnements actifs concernés dans une transaction, puis écrivent un événement `platform.*` sans données commerciales.

## Fonctionnalités et routes

| Écran | Route | Données/actions |
| --- | --- | --- |
| Vue d'ensemble | `/platform` | Comptages commerces/abonnements/essais, somme des règlements SaaS confirmés, journal récent. |
| Commerces | `/platform/businesses` | Recherche et filtre, fiche administrative, suspension/réactivation confirmée et auditée. |
| Abonnements | `/platform/subscriptions` | Périodes, essais, plans, statuts et seuls les paiements `subscription_payment`. |
| Forfaits | `/platform/plans` | Création, activation/désactivation et fonctionnalités/quotas allow-listés. |
| Promotions | `/platform/promotions` | Création, activation/désactivation, périodes, types d'avantage, éligibilité, plafond et utilisations. |
| Audit | `/platform/audit` | Événements globaux de plateforme, sans secrets ni contenu de paiement. |

Les routes JSON correspondantes sont sous `/api/platform/*`. La route commerçant `/api/business/subscription/promotion` applique un code uniquement à un abonnement en attente et exige le rôle commercial `owner` ou `admin` du commerce cible.

## Règles financières et promotions

- Les indicateurs de paiements plateforme ne lisent que `subscription_payment` avec statut confirmé. Ils n'additionnent jamais les `payment` des ventes client.
- Un code est non cumulable. Il peut porter une réduction en pourcentage ou en montant XOF, une fenêtre de validité, un plafond et une liste d'entreprises éligibles (liste vide = toutes).
- Une promotion ne s'applique qu'une fois par commerce (contrainte unique actuelle) et à un abonnement en attente. Le montant XOF est arrondi à l'unité la plus proche pour le pourcentage, plafonné au tarif du forfait; la réduction effective et le code sont conservés dans `promotion_redemption`.
- La consommation du plafond verrouille la ligne de promotion dans la transaction et la contrainte unique par commerce constitue une défense supplémentaire. Le solde, s'il est positif, devient un paiement d'abonnement **en attente**. Aucun encaissement ni confirmation fournisseur n'est simulé par l'application du code.
- Modifier/désactiver un forfait ne modifie pas les abonnements historiques. Le journal d'audit ne contient que les champs changés et références non sensibles.

Les essais sont dérivés de `trial_ends_at`; les essais en cours sont ceux dont la date est future, les essais expirés ceux dont la date est passée. Le tableau de bord signale explicitement l'absence de module d'incidents plutôt que d'inventer un indicateur.

## Prévisualisation locale

Dans `apps/web`, lancer `npm run preview` puis ouvrir `http://localhost:3001/platform`. Le lanceur définit `QADR_PREVIEW_MODE=true`, force `NODE_ENV=development` et retire `DATABASE_URL` de l'environnement enfant. La base PGlite est créée en mémoire; un utilisateur plateforme synthétique n'est jamais membre d'un commerce. Les données de démonstration sont explicitement fictives et comprennent plusieurs statuts, plans, essais, un paiement SaaS confirmé, un code utilisé, des ventes datées, une créance, un remboursement et un inventaire validé.

Ne pas utiliser `QADR_PREVIEW_MODE` dans un déploiement. Hors développement le contexte refuse explicitement l'accès. Les données disparaissent à l'arrêt du serveur et sont recréées au prochain lancement; aucun fichier de base ou compte production n'est créé.

## Migration locale `0006_furry_vision.sql`

La migration ajoute les commerces éligibles d'une promotion, le snapshot de code et le montant de remise, la date de fin d'essai et des contraintes de validation. Elle backfill le snapshot des anciennes utilisations depuis le code de promotion existant avant de rendre la colonne obligatoire. `drizzle-kit generate` ne contacte aucune base; cette migration n'a pas été appliquée à Neon ni à une autre base distante. Toute future application devra d'abord vérifier les contraintes de période/limite sur les données ciblées et prendre une sauvegarde restaurable.

## Limites connues

- Les permissions d'administration plateforme sont attribuées par `scripts/platform-admin.ts` (mission 08) ; aucun écran ne peut s'auto-attribuer le rôle.
- L'authentification réelle s'appuie sur Better Auth et nécessite une session et une base configurées; la prévisualisation contourne l'écran de connexion uniquement dans le runtime local isolé.
- L'encaissement/renouvellement SaaS par un fournisseur n'est pas intégré ici. Un statut confirmé n'est jamais créé par le formulaire de promotion.
- Aucun panneau de monitoring d'incidents n'existe encore.
- Le contrôle transactionnel et les intégrations de schéma ont été exercés avec PGlite; cela ne prouve pas les comportements multi-connexion PostgreSQL/Neon en production.
