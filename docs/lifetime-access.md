# Accès à vie (abonnement permanent)

Mise en place : 2026-11-27, branche `feature/lifetime-business-access`, migration `0029_lifetime_access.sql`.
Code : `apps/web/src/lib/domain/subscription-lifecycle.ts` (règle d'accès), `platform.ts` (formules, attribution
directe, console), `commercial-codes.ts` (codes à vie), `subscription-billing.ts` (refus du paiement en ligne).
Tests : `src/test/lifetime-access.http.test.ts`, `src/lib/domain/subscription-lifecycle.test.ts`.

## 1. Modèle

| Table | Colonne | Valeurs | Règle |
| --- | --- | --- | --- |
| `subscription_plan` | `duration_kind` | `fixed_duration` (défaut), `lifetime` | `fixed_duration` ⇒ `duration_days` > 0 ; `lifetime` ⇒ `duration_days` nul (`plan_amount_duration_check`). |
| `business_subscription` | `duration_kind` | idem | `fixed_duration` ⇒ `ends_at` renseigné ; `lifetime` ⇒ `ends_at` nul et statut ni `pending`, ni `trialing`, ni `expired` (`subscription_duration_check`). |
| `commercial_access_code` | `duration_unit` | `day`, `month`, `lifetime` | `lifetime` ⇒ `duration_value` nul (`commercial_code_duration_check`). |

- L'abonnement garde **ses propres conditions** : modifier, retirer ou même changer le type d'une formule ne change
  aucun accès déjà accordé.
- Une date nulle seule ne signifie jamais « à vie » : le type est toujours lu explicitement. Un abonnement à durée
  déterminée sans fin est refusé par la base (et lu « échu » par le code s'il existait).
- Jamais de longue durée fictive (ni 999 999 jours, ni an 9999).
- Un seul accès à vie vivant (`active` ou `suspended`) par commerce : index unique partiel `subscription_one_lifetime_idx`.
- La migration est additive : les lignes existantes reçoivent `fixed_duration` ; aucune donnée historique n'est
  transformée en accès permanent.

Piège corrigé pendant les tests : en SQL, `duration_days > 0` vaut NULL quand la valeur est nulle, et une contrainte
CHECK qui vaut NULL est **acceptée**. Les contraintes testent donc `is not null` explicitement.

## 2. Règle d'accès unique

`isInForce(subscription, now)` (et son pendant SQL `subscriptionInForceSql(now)`, utilisé par
`assertBusinessOperational`) : statut `trialing` ou `active`, date de début atteinte, et, pour une durée déterminée,
date de fin non atteinte. Un accès à vie n'expire jamais de lui-même ; seules l'annulation (révocation) ou la
suspension du commerce y mettent fin. `businessLifecycle`, `effectiveSubscriptionStatus`, `commercialAccess`, la
console et les notifications passent tous par cette règle ; `byCoverage` classe l'accès à vie avant toute période fixe.

Le navigateur n'envoie jamais le type d'accès : `isLifetime`, `expiresAt: null`, `durationDays`, `status` envoyés par le
client sont ignorés (corps stricts côté plateforme, champs inconnus ignorés côté commerçant). Le cron d'expiration ne
touche que les abonnements `fixed_duration`.

## 3. Parcours

1. **Formule** (`/platform`, Forfaits) : « Type de durée » = Durée déterminée ou Accès à vie. Pour un accès à vie, le
   champ des jours disparaît et « Sans date d'expiration » s'affiche. Chaque carte montre Type, Durée et Statut.
2. **Code à vie** (`/platform`, Accès commerciaux) : pour une formule à vie, la durée est forcée à « Accès à vie »
   (`duration: "lifetime"`). Le serveur refuse les combinaisons croisées (`lifetime_plan_requires_lifetime`,
   `lifetime_requires_lifetime_plan`). La date limite d'activation reste distincte et s'applique normalement.
3. **Activation du code** : un abonnement `lifetime` sans date de fin est créé (ou l'abonnement en attente est converti).
   Une période fixe en cours reste intacte dans l'historique. Si le commerce a déjà un accès à vie : 409
   `lifetime_active`, le code n'est pas consommé.
4. **Attribution directe** (`/platform`, fiche du commerce, « Accorder un accès à vie ») : formule à vie publiée, motif
   (5 caractères au moins) et case de confirmation. Route `POST /api/platform/businesses/{id}/lifetime`, corps
   `{ planId, reason, confirm: true }`, propriétaire de la plateforme seulement (tout autre compte : 404). Refus :
   commerce suspendu (409 `business_suspended`), accès à vie déjà présent (409 `lifetime_active`), formule non à vie
   (422) ou non publiée (422 `plan_inactive`).
5. **Affichage commerçant** (`/business/subscription`) : « Votre forfait : … », statut Actif, « Expiration : Aucune —
   Accès permanent ». Ni compte à rebours ni date inventée (`endsAt` et `remainingDays` nuls dans l'API).
6. **Révocation** : action « Révoquer l'accès à vie » (annulation, terminale) dans la liste des abonnements. Prolonger
   un accès à vie est refusé (409 `lifetime_not_extendable`). Suspendre le commerce suspend l'accès ; la réactivation
   le rétablit (pas d'échéance à vérifier).
7. **Paiement en ligne** (GeniusPay, en pause) : une formule à vie n'est jamais proposée ni payable en ligne (422
   `lifetime_not_payable_online`) ; un commerce à vie ne peut pas ouvrir de paiement (409). Si un paiement arrivait
   malgré tout pendant un accès à vie, il est enregistré sans période et signalé (`subscription.payment_during_lifetime`).
8. **Codes privés de la plateforme** et **campagnes publiques** : jamais appliqués sur un accès à vie (409) ; une
   campagne ne porte que sur des formules à durée déterminée.

## 4. Audit

| Événement | Quand |
| --- | --- |
| `platform.plan_created` / `platform.plan_updated` (métadonnée `durationKind`) | formule à vie créée ou modifiée |
| `platform.commercial_code_created` (`durationUnit: lifetime`) | code à vie généré |
| `subscription.commercial_code_activated` (`after.durationKind: lifetime`) | code à vie activé |
| `subscription.lifetime_granted` (administrateur, date, motif, état précédent) | attribution directe |
| `platform.business_suspended` / `platform.business_active` | suspension et réactivation |
| `platform.lifetime_access_revoked` | révocation |
| `subscription.payment_during_lifetime` | paiement reçu pendant un accès à vie (à traiter à la main) |

## 5. Concurrence

L'activation d'un code et l'attribution directe verrouillent la ligne `business_profile` (`FOR UPDATE`) avant de lire
les abonnements : deux opérations simultanées sur le même commerce sont sérialisées. L'index unique partiel est le
filet final ; sa violation est convertie en 409 (`isUniqueViolation`).

## 6. Mise en production

Rien n'est appliqué à distance par cette branche. Aucune formule à vie n'est créée automatiquement : elle se crée dans
la console.

### 6.1 Répétition locale du 2026-11-28 (réussie)

Instance PostgreSQL locale et temporaire, en mémoire : PGlite 0.5.10 = **PostgreSQL 18.6** (même version majeure que
Neon), aucune connexion réseau. Migrations 0000-0028 par le migrateur Drizzle (même mécanisme que
`scripts/migrate-production.ts` : migrations en attente et journal dans une transaction), données représentatives
(formule publiée et formule archivée, six commerces aux statuts `active`, `trialing`, `expired`, `canceled`,
`suspended`, `pending`, un abonnement ancien expiré, codes en jours, en mois et déjà consommé), puis **0029 seule**
(92 ms). 16 contrôles sur 16 réussis :

1. 0029 s'exécute sans erreur (30 migrations au journal) ;
2. statuts, dates de début et de fin des abonnements, prix, durées et publication des formules, codes : inchangés ;
3. toutes les lignes existantes deviennent `fixed_duration` ;
4. une formule à vie s'enregistre (`duration_days` nul) ; à vie avec jours, fixe sans jours, type inconnu : refusés ;
5. `ends_at` nul accepté pour un accès à vie, refusé pour une durée déterminée (insertion et mise à jour) ;
6. dix états incohérents refusés (à vie avec fin, en essai, expiré, en attente, deuxième accès à vie vivant, type
   inconnu, code à vie avec valeur, code en jours ou en mois sans valeur, code de 13 mois) ; après révocation, un
   nouvel accès à vie est possible et l'ancien reste au dossier ;
7. un ancien code (mois) se consomme, un code à vie se crée ;
8. transaction d'activation (abonnement + consommation du code) : un échec annule les deux écritures ; sans échec,
   les deux sont validées.

Limite de cette répétition locale : PGlite n'a qu'une connexion. Les courses entre connexions réelles ont été rejouées
ensuite sur Neon (§ 6.3).

### 6.2 Isolation Vercel (constatée et corrigée le 2026-11-28)

Projet `web` : la poussée d'une branche crée un déploiement Preview (protégé par l'authentification Vercel). Les
variables Neon de l'intégration (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`) ne visent que
**Production**. Les seules variables Preview liées à une base étaient propres aux branches
`perf/global-performance-optimization` et `perf/ultimate-performance-optimization` (`DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) ; valeurs illisibles (type « sensitive »), cible documentée par les rapports
de mission : base de **test** `qadr_staging` (branche `mission-14-staging`), pas la production. Les deux PR étant
fusionnées, ces 6 entrées ont été **supprimées** le 2026-11-28 avec l'accord du propriétaire. Après suppression :
34 variables, aucune propre à une branche, **aucune variable de base de données en Preview**, `DATABASE_URL` de
Production intacte. L'application ne lit que `DATABASE_URL` : un Preview n'a donc **aucune** base et ne peut pas joindre
Neon Production.

### 6.3 Répétition sur Neon du 2026-11-28 (réussie)

Branche `repetition-0029-2026-11-28` (`br-silent-bonus-bcxrf6mr`), copiée de `main` le 2026-11-28 à 13:57 UTC
(PostgreSQL 18.7), après suppression, avec accord, de `repetition-0026-2026-11-16` (répétition d'une migration déjà
appliquée ; sa sauvegarde `sauvegarde-main-avant-0026-2026-11-16` est conservée). Production non touchée.

1. **État initial** : 29 migrations, 6 abonnements (tous `active`), 2 formules, 10 codes, 6 commerces, 142 événements
   d'audit ; empreintes MD5 (identifiant, statut, début, fin, formule) : abonnements `a088872b…`, formules `969915e1…`,
   codes `933a1ab5…`.
2. **0029 par `scripts/migrate-production.ts`** (connexion directe, phrase de confirmation nommant l'hôte de la
   branche) : « en attente : 1 », « Terminé en une transaction : 30 migration(s) au journal », 40 s connexion comprise.
3. **Après** : mêmes comptes, **mêmes empreintes** (abonnements, formules, codes) ; 6 abonnements et 2 formules en
   `fixed_duration` ; 4 contraintes présentes et validées ; index `subscription_one_lifetime_idx` présent.
4. **Contrôles SQL, 10 connexions indépendantes** (10 processus serveur distincts), 12/12 réussis :
   forfait et code à vie enregistrables ; 3 formules, 4 codes et 6 abonnements incohérents refusés (`23514`) ; mise à nul
   de la fin d'un abonnement réel copié refusée ; transaction d'activation atomique (échec `23505` → ni abonnement ni
   consommation du code) ; 10 attributions simultanées avec le verrou du profil → **1 réussite, 9 refus** ;
   10 insertions simultanées sans verrou → **1 insertion, 9 `23505`** (l'index est le dernier filet) ; 10 activations
   simultanées du même code → **1 activation, 9 « déjà utilisé », aucun abonnement orphelin** ; après révocation, un
   nouvel accès à vie est possible. Lignes de test préfixées et retirées (0 restante), empreintes inchangées ensuite.
5. **Parcours complets, vrais services, vraies sessions, sur ce PostgreSQL Neon** (harnais `QADR_TEST_POSTGRES_URL`,
   bases jetables `qadr_t_*` créées puis supprimées sur la branche) : `lifetime-access.http.test.ts`,
   `commercial-access-codes.http.test.ts`, `commercial-access.http.test.ts` → **3 fichiers, 46 tests, 46 réussis**
   (formule classique et à vie, codes classique et à vie, activation, attribution directe, affichage commerçant,
   suspension, révocation, historique, sécurité, concurrence).

### 6.4 Procédure de production (deux étapes contrôlées, chacune sur accord explicite du propriétaire)

0029 est **additive** : l'ancien code continue de fonctionner sur le nouveau schéma (les insertions sans
`duration_kind` prennent `fixed_duration`, `ends_at` reste fourni). L'ordre est donc : **migrer, puis fusionner** (le
nouveau code lit `duration_kind` et échouerait sur l'ancien schéma).

**Étape A — base (aucun déploiement)**

1. **Sauvegarde complète** : `pg_dump -Fc` de `main` (connexion directe, outils 18.7, mot de passe par `PGPASSFILE`
   privé), plus une branche Neon `sauvegarde-main-avant-0029-<date>` (point de retour instantané ; une place de branche
   à libérer, par exemple la branche de répétition une fois le rapport validé).
2. **Restauration testée** : `pg_restore` du fichier dans une base vide d'une branche de test (jamais `main`), puis
   comparaison des comptes par table et des empreintes ci-dessus (`docs/engineering/backup-restore.md`).
3. **Vérification finale** : relire le journal de `main` (29 migrations), comparer ses empreintes à celles de la
   répétition, contrôler que la PR est verte et inchangée depuis la répétition.
4. **Migration** : depuis `apps/web`, `QADR_DB_TARGET=production`, `DATABASE_URL_UNPOOLED` = connexion directe de
   `main`, `QADR_MIGRATION_CONFIRM="MIGRER LA PRODUCTION <hôte>/<base>"`, `npx tsx scripts/migrate-production.ts`.
   Jamais `scripts/migrate.ts` sur `main`.
5. **Vérification des données** : 30 migrations, mêmes comptes et mêmes empreintes qu'avant, tout `fixed_duration`,
   4 contraintes validées, index présent ; l'application en production (ancien code) répond normalement.

**Étape B — application (après présentation des résultats de l'étape A)**

6. **Fusion** de la PR dans `main`.
7. **Déploiement Vercel** de production (déclenché par la fusion) ; vérifier son état `READY` et son commit.
8. **Tests après déploiement** : pages publiques et `/login`, `/business/subscription` d'un commerce existant
   (expiration datée, inchangée), console `/platform` (formules, codes, « Accorder un accès à vie » visible) ; Sentry
   sans nouvelle erreur. Aucune formule à vie n'est créée automatiquement.

Retour arrière : avant toute écriture `lifetime`, revenir au déploiement précédent suffit (le schéma additif reste
compatible) ; en dernier recours, la branche de sauvegarde ou le `pg_dump` restaurent l'état antérieur.
