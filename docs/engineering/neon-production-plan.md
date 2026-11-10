# Plan de mise en production de la base Neon

> **Statut : plan seulement, rien n'a été créé.** Rédigé le 2026-11-10 (mission 16). Aucune branche, aucune
> base, aucun projet, aucun instantané, aucune souscription et aucune migration n'ont été faits pour ce
> document. Les constats viennent de l'API Neon en lecture seule et du dépôt ; les offres et tarifs de la
> page *Plans* de Neon relue le 2026-11-10 (mise à jour le 2026-11-04). Chaque étape marquée
> **Propriétaire** exige son accord explicite, et certaines engagent une dépense.
>
> Documents liés : `backup-restore.md` (sauvegardes et restauration), `mission-16-neon.md` (audit du
> 2026-11-10), `vercel-environments.md` (variables par environnement), `docs/privacy/data-map.md`
> (localisation).

## 1. Situation au 2026-11-10

| Élément | Constat |
| --- | --- |
| Projet | `qadr-data-base` (`soft-shadow-92812879`), **AWS us-east-1 (Virginie, États-Unis)**, PostgreSQL 18.6 |
| Création | Par l'intégration **Vercel Marketplace** (organisation « Vercel: … ») : plan, taille de calcul et mise en veille se règlent **dans Vercel** ; la facture Neon passe par Vercel |
| Offre | Free (`free_v3`) : historique 6 h, 1 instantané manuel, aucune sauvegarde planifiée, 1 Go par projet, calcul 0,25 CU, mise en veille après 5 min non désactivable |
| Branche `main` | Racine, **branche de production Vercel** (suppression interdite par l'intégration). Base `neondb` : schéma `public` **vide**, schéma `neon_auth` (9 tables, *Managed Better Auth* activé à l'installation, inutilisé par Qadr Ops). **Jamais migrée.** |
| Branche `mission-14-staging` | Enfant de `main`. Base `qadr_staging` migrée (25 migrations), identique au dépôt. 3 bases jetables orphelines `qadr_t_*` |
| Instantanés | 0 ; aucune planification |
| Autre projet | `neon-charcoal-chair` (`eu-west-2`, Londres). Créé le 2026-10-18 avec le projet Vercel `qadrops`. Branche `main` seule, **archivée**, environ 38 Mio, contenu non examiné (le lire l'aurait réveillé). **Attention :** c'est ce projet, et non `qadr-data-base`, qui fournit la `DATABASE_URL` **sans préfixe** du projet Vercel `qadrops` (Preview et Production). Dans `qadrops`, `qadr-data-base` ne fournit que des variables préfixées `QADROPSDATABASE_*`, que le code ne lit pas (`mission-16-deploiement.md` § 2) |
| Code | Application : `getDatabase()` lit `DATABASE_URL` (pool WebSocket partagé, `attachDatabasePool`). Migrations : `scripts/migrate.ts` lit `DATABASE_URL_UNPOOLED` puis `DATABASE_URL` |

## 2. Prérequis bloquants (avant toute donnée réelle)

1. **Offre payante** (Launch au minimum) : sans elle, une erreur découverte après 6 h n'est rattrapable que par
   un `pg_dump`, et la mise en veille non désactivable ajoute un démarrage à froid aux premières requêtes.
   **Propriétaire** (dépense, depuis Vercel).
2. **Décision de région** (§ 4) : elle est **définitive pour un projet** ; changer de région plus tard impose
   une copie et une restauration complètes avec interruption. **Propriétaire**, après avis du juriste.
3. **Script de migration transactionnel pour la production** (correctif de code à autoriser, hors de ce
   document) :
   - `scripts/migrate.ts` utilise le migrateur `neon-http` de Drizzle (0.45.4), qui exécute chaque instruction
     **séparément, hors transaction**, et n'écrit le journal `__drizzle_migrations` qu'à la toute fin. Un
     échec au milieu des 25 migrations laisserait un schéma partiel **sans journal** : la relance échouerait
     (`relation already exists`) et il faudrait réparer à la main. Le harnais de test utilise au contraire le
     migrateur `neon-serverless` (Pool WebSocket), qui applique tout dans **une seule transaction** ;
   - le script refuse toute cible autre que `QADR_DB_TARGET=development` et demande la phrase « MIGRER CETTE
     BASE DE DÉVELOPPEMENT » : il n'existe **aucun chemin prévu pour la production**.
   Correctif proposé : migrateur `drizzle-orm/neon-serverless/migrator` sur la chaîne directe, cible
   `production` avec affichage de l'hôte, de la base et du nombre de migrations en attente, phrase de
   confirmation distincte, refus si la base contient des tables `public` sans journal. Test associé sur PGlite
   et sur une base jetable de staging.
4. Garde-fou du harnais : `openPostgresHarness` ne supprime pas sa base si `migrate()` échoue (origine
   probable d'une base orpheline, `mission-16-neon.md` § 3). Correctif de test à autoriser.
5. **Dépôt Git distant privé** : les migrations ne sont protégées que par le poste de développement
   (`backup-restore.md` § 7.3).
6. Clés de chiffrement des sauvegardes et outils `pg_dump` 18 (`backup-restore.md` § 4 et § 11).
7. Problèmes ouverts hors base qui bloquent aussi l'ouverture : domaine et clé Resend, clés Turnstile de
   production (`docs/authentication.md` § 7).

## 3. Branche du projet actuel ou projet dédié

| Critère | A. Branche `main` du projet actuel | B. Nouveau projet dédié à la production |
| --- | --- | --- |
| Région | **us-east-1 imposée** (non modifiable) | Au choix à la création |
| Raccordement Vercel | Déjà branche de production de l'intégration. Dans `qadrops`, elle n'est injectée que sous le préfixe `QADROPSDATABASE_*`, que le code ne lit pas. À raccorder sans préfixe au projet Vercel retenu (`web` recommandé, `mission-16-deploiement.md`), en Production seulement | Nouvelle « base » Vercel (*Storage → Add*) à connecter à l'environnement Production ; retirer l'ancienne connexion Production |
| Isolation | Partage le projet avec staging : même fenêtre d'historique, mêmes quotas (calcul, stockage), même fenêtre de maintenance, mêmes bases jetables de test sur une branche voisine | Quotas, réglages et historique propres à la production |
| Accès | Identiques dans les deux cas : dans une organisation gérée par Vercel, presque tous les membres de l'équipe Vercel sont **administrateurs** Neon (rôles hérités, pas de droits par projet) | Idem |
| Restauration instantanée | `main` est racine : PITR possible | Branche racine du nouveau projet : PITR possible |
| Coût | Un seul projet facturé | Deux projets : le calcul de staging reste facturé à part (sur offre payante, le plan s'applique à toutes les bases de l'installation Vercel) |
| `neon_auth` | Schéma inutile présent dans `neondb` | À ne pas activer (option *Auth* décochée à la création) |
| Base applicative | `neondb` (nom par défaut) ou une base dédiée à créer | Base dédiée nommée dès la création |

**Recommandation : B, un projet dédié**, pour trois raisons : la région se choisit une seule fois et doit
l'être en connaissance de cause ; la production ne doit pas partager quotas et historique avec les essais
(les tests créent des bases de plusieurs dizaines de Mo) ; le projet actuel reste alors l'environnement de
staging et de Preview sans risque de confusion. **Si le propriétaire garde us-east-1 et veut la simplicité,
A reste acceptable**, à condition de créer une base applicative dédiée (par exemple `qadr`) plutôt que
`neondb`, et de pointer `DATABASE_URL` de Production dessus.

Dans les deux cas : la branche de production est **protégée** (réglage *Protected branch*, disponible sur
offre payante : à vérifier), et aucune branche de test n'est créée sous elle sans besoin.

## 4. Région

Régions proposées par Neon au compte (API, 2026-11-10) : AWS us-east-1, us-east-2, us-west-2, eu-central-1
(Francfort), eu-west-2 (Londres), ap-southeast-1, ap-southeast-2, sa-east-1 ; Azure eastus2, westus3,
Germany West Central (Francfort). **Aucune région en Afrique** (ni AWS Le Cap, ni Lagos), et aucune à
Paris.

Ce qui compte pour la vitesse : la distance entre **les fonctions Vercel et la base** (plusieurs allers-retours
par requête, transactions interactives), puis la distance entre **le téléphone du commerçant et les
fonctions** (un aller-retour par écran). Les deux doivent être dans la même région.

| Option | Fonctions Vercel | Effet attendu | Limites |
| --- | --- | --- | --- |
| us-east-1 (actuel) | `iad1` (Washington, par défaut) | Base et fonctions voisines | Commerçants d'Abidjan loin des fonctions : aller-retour transatlantique à chaque écran. Mesure du 2026-11-10 depuis le poste de développement (localisation non vérifiée) : **211 ms** de RTT médian vers Neon us-east-1 |
| eu-central-1 (Francfort) | `fra1` | Fonctions et base voisines, et plus proches de l'Afrique de l'Ouest que la côte Est américaine (câbles sous-marins vers l'Europe) | Gain non mesuré : à mesurer depuis Abidjan avant décision |
| eu-west-2 (Londres) | `lhr1` | Comparable à Francfort | Idem |

Toutes ces régions sont **hors de Côte d'Ivoire et hors CEDEAO** : aucune n'apporte de « souveraineté » ni de
« données en Afrique », et une région européenne n'est pas en soi une garantie d'adéquation au sens de la loi
ivoirienne n° 2013-450. La formalité de transfert auprès de l'autorité de protection (ARTCI) reste à
instruire dans tous les cas (`docs/privacy/register-of-processing.md`). **Décision : propriétaire, après
avis du juriste et une mesure de latence depuis Abidjan** (par exemple : temps de chargement de l'aperçu
déployé en Preview dans chaque région, sans données réelles).

## 5. Paramètres de connexion

| Variable | Chaîne | Utilisée par | Règle |
| --- | --- | --- | --- |
| `DATABASE_URL` | ***pooled*** (hôte `-pooler`, PgBouncer en mode transaction) | Application (`getDatabase()`), routes, crons | Une instance Vercel garde **un pool partagé** (`attachDatabasePool`) ; jamais de pool par requête |
| `DATABASE_URL_UNPOOLED` | **directe** (sans `-pooler`) | Migrations, `pg_dump`, `pg_restore`, contrôles d'administration | Jamais exposée à l'application ; jamais dans un journal |

Compatibilité avec PgBouncer en mode transaction, vérifiée dans le code le 2026-11-10 : aucune commande de
session (`SET`, verrou consultatif de session, `LISTEN`) ; les transactions interactives (y compris
`repeatable read` en lecture seule de l'export complet) sont compatibles. Toutes les chaînes en
`sslmode=require`. Pool applicatif : `idleTimeoutMillis` 10 s, `connectionTimeoutMillis` 5 s, taille par
défaut du pilote. Le serveur de staging accepte 112 connexions directes à 0,25 CU ; le pooler en accepte
beaucoup plus côté client.

À étudier plus tard, sans urgence : Neon recommande désormais, avec Vercel Fluid Compute, le pilote TCP
`pg` plutôt que le WebSocket (page *Connecting to Neon from Vercel*, mise à jour le 2026-06-05), en
conseillant de mesurer avant de changer. Le pilote actuel a été validé sur Neon (135 tests) : ne pas le
changer sans banc d'essai.

Réglages du calcul de production (offre payante) : taille minimale 0,25 à 0,5 CU, maximale 1 à 2 CU au
lancement ; **mise en veille désactivée** pendant les heures d'ouverture des commerces si le budget le
permet (coût indicatif d'un calcul 0,25 CU toujours actif sur Launch : 0,25 × 730 h × 0,106 $ ≈ 19 $/mois,
hors stockage et historique ; prix Vercel non vérifiés).

## 6. Migrations à appliquer

Toutes : `0000_young_galactus` à `0024_owner_two_factor_rate_limit` (25 fichiers), dans l'ordre du journal
`apps/web/drizzle/meta/_journal.json`, en **une seule transaction** (§ 2.3). Résultat attendu, identique à
`qadr_staging` et à PGlite le 2026-11-10 :

| Contrôle | Valeur attendue |
| --- | --- |
| Lignes de `drizzle."__drizzle_migrations"` | 25 ; dernière empreinte `90f5d57ac169d9e2…` (SHA-256 du fichier 0024) |
| Tables `public` | 63 |
| Colonnes / index / contraintes | 605 / 200 / 825 |
| Clés étrangères / dont composées `(business_id, …)` | 158 / 70 |
| Déclencheurs | 3 : `audit_event_no_update_delete`, `cash_movement_append_only`, `cash_session_immutable_after_close` |
| Empreintes MD5 colonnes / index / contraintes / fonctions | `53cfe55e…` / `52f27198…` / `978a1317…` / `e2142738…` |

La requête qui produit ces valeurs est dans `mission-16-neon.md` § 2. Une nouvelle migration change ces
valeurs : les recalculer sur PGlite avant la mise en production.

## 7. Déroulé et contrôles

| # | Étape | Qui | Contrôle |
| --- | --- | --- | --- |
| 1 | Décider région, option A ou B, offre | Propriétaire (+ juriste) | Décision écrite dans `docs/engineering/decisions.md` |
| 2 | Corriger et tester le script de migration (§ 2.3) et le harnais (§ 2.4) | Agent, après accord | Tests PGlite + une base jetable de staging |
| 3 | Régression locale complète, `npx drizzle-kit check` et `npx drizzle-kit generate` (« No schema changes ») | Agent | Résultats notés |
| 4 | Campagne des 13 fichiers sur staging, un à la fois | Agent | 135 tests attendus |
| 5 | Souscrire l'offre, créer le projet ou la base de production, régler fenêtre d'historique (7 jours sur Launch), sauvegardes planifiées (`backup-restore.md` § 5), protection de branche, alerte de consommation | Propriétaire (Vercel / Neon) | Captures ou relecture API en lecture seule par l'agent |
| 6 | Vérifier que la cible est **vide** : 0 table `public`, pas de schéma `drizzle` ; lire `select now(), version()` | Agent (lecture seule) ou propriétaire | Valeurs notées |
| 7 | Instantané manuel « avant migration initiale » | Propriétaire | Identifiant noté |
| 8 | Migration sur la chaîne **directe** de production, depuis `apps/web`, avec le script corrigé | Propriétaire (saisit la chaîne et la phrase de confirmation) | Sortie du script |
| 9 | Contrôles du § 6 (journal, structure, empreintes) | Agent (lecture seule) | Égalité stricte avec le tableau du § 6 |
| 10 | `npm run db:check` contre `DATABASE_URL` de production (lecture `select 1`) | Propriétaire | « Connexion de lecture réussie » |
| 11 | Variable Vercel Production : `DATABASE_URL` *pooled* seulement. Ne pas créer `DATABASE_URL_UNPOOLED` dans Vercel : l'application ne la lit pas et la chaîne directe reste au terminal des migrations (`mission-16-deploiement.md`). Région des fonctions alignée (`vercel.json` ou réglages) | Propriétaire | `vercel-environments.md` |
| 12 | Création du compte propriétaire de la plateforme (`scripts/platform-owner.ts`, puis `enroll-2fa`) | Propriétaire | Connexion `/platform/login` |
| 13 | Premier `pg_dump` chiffré et relevé des empreintes de contenu (`backup-restore.md` § 4 et § 6.4 e) | Opérateur de sauvegarde | Registre |
| 14 | Parcours de fumée sans données réelles : inscription d'un commerce de test, vente, rapport, puis archivage du commerce de test | Propriétaire | Compte rendu |
| 15 | Ouverture aux commerçants | Propriétaire | — |

Retour arrière : avant l'ouverture (étapes 8 à 14), en cas d'écart, restaurer l'instantané de l'étape 7 ou
recréer la base vide, corriger, recommencer. Après l'ouverture, seule la procédure de `backup-restore.md`
§ 9 s'applique.

## 8. Qui fait quoi

| Acteur | Responsabilités | Interdits |
| --- | --- | --- |
| Propriétaire (Qadr Agency) | Décisions (région, offre, option), souscription, création des ressources Neon et Vercel, saisie des chaînes de connexion, migration de production, comptes de la plateforme | — |
| Juriste | Avis sur la localisation hors CEDEAO et la formalité ARTCI | — |
| Agent de codage | Correctifs de code autorisés, tests locaux et de staging, requêtes de contrôle **en lecture seule**, documentation | Créer, migrer, restaurer ou supprimer une ressource Neon ; lire ou afficher une chaîne de connexion de production ; souscrire |
| Opérateur de sauvegarde | `pg_dump` chiffrés, tests de restauration sur base ou branche dédiée | Restaurer la branche de production |

## 9. Sources (consultées le 2026-11-10)

- Neon, *Plans* : https://neon.com/docs/introduction/plans (mise à jour le 2026-11-04).
- Neon, *Vercel-Managed Integration* : https://neon.com/docs/guides/vercel-managed-integration (mise à jour le
  2026-10-23).
- Neon, *Connecting to Neon from Vercel* : https://neon.com/docs/guides/vercel-connection-methods (mise à
  jour le 2026-06-05).
- API Neon en lecture seule : projet, branches, bases, instantanés, planification, régions.
- Code : `apps/web/src/lib/db/client.ts`, `apps/web/scripts/migrate.ts`,
  `apps/web/node_modules/drizzle-orm/neon-http/migrator.js`, `apps/web/src/test/postgres-harness.ts`.

Les prix et offres changent ; ceux facturés via Vercel n'ont pas été relus. Les revérifier le jour de la
souscription.
