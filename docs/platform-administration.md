# QADR OPS — Administration de plateforme

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

- Les permissions d'administration plateforme sont provisionnées hors bande; aucun écran ne peut s'auto-attribuer le rôle.
- L'authentification réelle s'appuie sur Better Auth et nécessite une session et une base configurées; la prévisualisation contourne l'écran de connexion uniquement dans le runtime local isolé.
- L'encaissement/renouvellement SaaS par un fournisseur n'est pas intégré ici. Un statut confirmé n'est jamais créé par le formulaire de promotion.
- Aucun panneau de monitoring d'incidents n'existe encore.
- Le contrôle transactionnel et les intégrations de schéma ont été exercés avec PGlite; cela ne prouve pas les comportements multi-connexion PostgreSQL/Neon en production.
