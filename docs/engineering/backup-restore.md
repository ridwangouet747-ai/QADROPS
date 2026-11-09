# Sauvegarde et restauration de la base Neon PostgreSQL

> **Statut : stratégie et procédure écrites, rien n'a été exécuté.** Rédigé le 2026-11-09. Aucune commande
> n'a été lancée contre Neon pour ce document : ni branche, ni instantané, ni `pg_dump`, ni restauration.
> Les capacités de Neon citées viennent de sa documentation publique consultée le 2026-11-09 (§ 12) ; elles
> **dépendent du plan souscrit**, que le propriétaire doit vérifier dans la console Neon.
>
> Règle absolue : **une restauration de test se fait uniquement sur une branche dédiée, jamais sur la branche
> principale.** Une restauration de la branche principale est une opération de production, réservée au
> plan de reprise (§ 9), avec l'accord écrit du propriétaire.

## 1. Contexte réel (au 2026-11-09)

- Base : Neon PostgreSQL, projet `qadr-data-base`, région AWS `us-east-1` (`docs/privacy/data-map.md`).
- Branches : la branche de **staging** est migrée (mission 14) ; la **branche principale n'a jamais été
  migrée** et ne contient aucune donnée de commerce. Tant que c'est le cas, ce document prépare l'avenir :
  rien de réel n'est encore à sauvegarder.
- Schéma : 25 migrations Drizzle (`apps/web/drizzle/0000` à `0024`), journalisées dans
  `drizzle."__drizzle_migrations"` ; 63 tables dans le schéma `public` (chiffres figés par
  `src/lib/db/pglite-migrations.integration.test.ts`). À mettre à jour à chaque nouvelle migration.
- Connexions : `DATABASE_URL` (chaîne *pooled*, application) et `DATABASE_URL_UNPOOLED` (chaîne directe,
  migrations). Toute sauvegarde ou restauration logique utilise la **chaîne directe** (Neon déconseille
  `pg_dump` sur une connexion *pooled*).
- Horloge : le 2026-11-09, le poste de développement avait **3 624 s de retard** sur Neon
  (`docs/validation.md`) ; après resynchronisation par le propriétaire, l'écart mesuré le même jour était de
  16 ms. Le service Windows Time restant arrêté, toute heure de restauration doit être lue **sur le serveur**
  (`select now()`) ou dans la console Neon, jamais sur l'horloge du poste.
- **Constat Neon du 2026-11-09 (mission 15, lecture seule par l'API)** : `history_retention_seconds = 21600`
  (6 h d'historique de restauration, valeur de l'offre Free), **aucun instantané** et **aucune planification
  d'instantanés** sur la branche `main`, limite de 1 Go par branche. Base `qadr_staging` sur la branche
  `mission-14-staging` : 63 tables, 25 migrations, dernière empreinte identique au fichier
  `0024_owner_two_factor_rate_limit.sql`, empreintes des colonnes et des index identiques à une base PGlite
  migrée depuis le dépôt. Branche `main` : 0 table. Avant toute donnée réelle, une offre payante (Launch au
  minimum) est nécessaire pour obtenir plus de 6 h de restauration et des instantanés : **dépense à décider par
  le propriétaire**.

## 2. Ce qu'il faut protéger

| Élément | Où | Sauvegardé par |
| --- | --- | --- |
| Données des commerces, comptes, sessions, audit, factures d'abonnement | Neon (schéma `public`) | § 3 (Neon) + § 4 (`pg_dump`) |
| Historique des migrations | Neon (schéma `drizzle`) | idem |
| Fichiers privés (originaux d'imports) | Cloudflare R2 (`stored_file` en base) | § 7.1 |
| Secrets et configuration | Variables Vercel, coffre du propriétaire | § 7.2 |
| Code et migrations | Dépôt Git (aucun dépôt distant à ce jour) | § 7.3 |

Données particulièrement sensibles dans une copie de la base : mots de passe hachés (scrypt), jetons de
session, secrets TOTP et codes de secours du propriétaire (chiffrés avec `BETTER_AUTH_SECRET`), clés de
notification push, données personnelles des clients des commerces, montants et dettes. **Une sauvegarde
logique vaut la base entière : elle se protège comme la production.**

## 3. Mécanismes Neon (dépendent du plan)

### 3.1 Restauration instantanée (*instant restore*, PITR) et fenêtre d'historique

- Ramène une **branche racine** (par exemple la branche principale) à un instant donné (horodatage ou LSN)
  dans la fenêtre d'historique. Ne fonctionne **pas** sur une branche enfant.
- La restauration **écrase** toutes les données et tout le schéma de la branche, pour **toutes** ses bases.
  Les connexions sont brièvement coupées ; les chaînes de connexion ne changent pas.
- Neon crée automatiquement une branche de secours `{branche}_old_{horodatage}` contenant l'état d'avant.
- *Time Travel Assist* : requêtes en lecture seule sur un instant passé, pour choisir le bon point avant de
  restaurer.
- Console (*Backup & Restore → Restore from history*), CLI (`neon branches restore`) ou API.
- Non disponible sur une branche issue d'une restauration d'instantané tant que celle-ci n'est pas terminée.

Fenêtre d'historique publiée par Neon (consultée le 2026-11-09) :

| Plan | Fenêtre par défaut | Fenêtre maximale | Coût de l'historique |
| --- | --- | --- | --- |
| Free | 6 h | 6 h, plafonnée à 1 Go d'historique | inclus |
| Launch | 1 jour | 7 jours | 0,20 $/Go-mois |
| Scale | 1 jour | 30 jours | 0,20 $/Go-mois |

Les plans Business, Agent ou Enterprise ne figurent pas sur les pages consultées : **à vérifier**. La fenêtre
se règle dans *Settings → Postgres* et s'applique à toutes les branches du projet. **La fenêtre par défaut
(1 jour sur les plans payants) est trop courte** : une erreur découverte le lundi matin sur un week-end serait
hors fenêtre. Voir § 5.

### 3.2 Branches

- Copie à l'écriture : une branche part de l'état de son parent (actuel, ou à un instant passé dans la
  fenêtre d'historique) sans copie initiale ; ses écritures ne touchent pas le parent.
- Outil principal du **test de restauration** (§ 6) : une branche enfant créée à un instant passé de la
  branche principale permet de vérifier les données sans rien modifier.
- Une branche n'est **pas** une sauvegarde indépendante : elle vit dans le même projet, chez le même
  fournisseur, et disparaît avec le projet.
- Branches incluses : 10 (Free, Launch), 25 (Scale) ; au-delà, 1,50 $/branche-mois (Launch, Scale). Les
  branches de secours `_old_` comptent dans ce total et dans le stockage.

### 3.3 Instantanés (*snapshots*) et sauvegardes planifiées

- Instantané manuel d'une branche racine : 1 sur Free, 100 sur les plans payants ; n'expire pas sauf date
  d'expiration fixée.
- Sauvegardes planifiées (plans payants) : quotidiennes, hebdomadaires ou mensuelles ; rétention de 1 h à
  **35 jours** (35 jours par défaut et au maximum) ; ne comptent pas dans la limite des instantanés manuels.
- Stockage : 0,09 $/Go-mois ; premier instantané planifié facturé en entier, les suivants en différentiel.
- Restauration : en **une étape** (la branche est remplacée, l'ancienne gardée sous `<branche> (old)`) ou en
  **plusieurs étapes** (création d'une nouvelle branche à inspecter, puis finalisation qui l'échange). Pour un
  test, on s'arrête **avant** la finalisation.
- Un instantané supprimé est irrécupérable.

### 3.4 Ce que Neon ne couvre pas

Suppression du projet ou du compte, compromission du compte Neon, panne prolongée du fournisseur, besoin de
conserver une copie au-delà de 30 à 35 jours, migration vers un autre hébergeur. D'où la copie logique hors
Neon (§ 4).

## 4. Copie logique chiffrée hors Neon (`pg_dump`)

### 4.1 Principe

- Format personnalisé `-Fc`, chaîne **directe**, client `pg_dump` de la **même version majeure** que le
  serveur Neon (Neon prend en charge PostgreSQL 14 à 17 ; vérifier la version du projet par `select version()`).
- Neon ne prend en charge ni `pg_dumpall` ni `pg_dump -C`. Les rôles ne sont donc pas sauvegardés : ils se
  recréent dans la console. `pg_dump` couvre une base à la fois (la base applicative, et non `postgres`).
- Le fichier est **chiffré avant de quitter le poste** qui l'a produit, avec une clé publique dont la clé
  privée n'est pas sur ce poste (proposition : `age`, outil libre ; ou GnuPG). Le fichier en clair est supprimé
  aussitôt.
- Empreinte SHA-256 du fichier chiffré notée dans le registre (§ 8).

### 4.2 Commandes (PowerShell, depuis le poste du propriétaire)

```powershell
# 1. Chaîne directe saisie localement, jamais écrite dans un fichier ni dans l'historique partagé
$env:PGURL = '<chaîne directe de la branche à sauvegarder>'
pg_dump -V                                   # même version majeure que le serveur
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
pg_dump -Fc -Z 1 --lock-wait-timeout=20s --no-owner -v -d $env:PGURL -f "qadr-$stamp.dump"

# 2. Chiffrement puis effacement du clair
age -r '<clé publique de sauvegarde>' -o "qadr-$stamp.dump.age" "qadr-$stamp.dump"
Remove-Item "qadr-$stamp.dump"
(Get-FileHash "qadr-$stamp.dump.age" -Algorithm SHA256).Hash
Remove-Item Env:PGURL
```

`--no-owner` est une option de `pg_dump` (format texte) et de `pg_restore` ; avec `-Fc`, c'est surtout à la
restauration qu'elle compte (§ 6.3). La liste exacte des options sera relue contre la documentation Neon et
PostgreSQL au premier essai.

### 4.3 Stockage

- Destination 1 : un **bucket R2 dédié aux sauvegardes**, distinct du bucket des fichiers applicatifs, avec un
  jeton d'écriture seule pour le dépôt et un jeton de lecture réservé au propriétaire. Les règles de
  verrouillage ou de rétention de R2 n'ont pas été vérifiées : à étudier avant de s'y fier.
- Destination 2 : copie hors ligne (disque chiffré du propriétaire, conservé hors du bureau), une fois par
  mois.
- **Jamais** dans le dépôt Git, ni sur Vercel, ni en pièce jointe d'e-mail ou de messagerie.

### 4.4 Automatisation

Pas de mécanisme existant. Une fonction Vercel ne convient pas (durée limitée, pas de binaire `pg_dump`). Au
lancement : procédure manuelle hebdomadaire. Ensuite : tâche planifiée hors Vercel (à choisir et à budgéter ;
Neon publie un guide « Automate pg_dump backups » qui n'a pas été lu pour ce document).

## 5. Politique proposée (à confirmer selon le plan)

| Mécanisme | Fréquence | Rétention | Objectif |
| --- | --- | --- | --- |
| Fenêtre d'historique (PITR) | continue | **7 jours minimum** (plan Launch au maximum) ; 14 à 30 jours si plan Scale | Erreur humaine ou bogue récent |
| Instantané planifié (plan payant) | quotidien à 2 h UTC (après le cron d'1 h UTC) | 35 jours | Retour à un jour précis au-delà de la fenêtre |
| Instantané planifié | mensuel, le 1er | 35 jours (maximum Neon) ; voir ligne suivante pour le long terme | Point mensuel |
| Instantané manuel | avant chaque migration de la branche principale, avant chaque opération de masse | jusqu'à validation + 30 jours | Retour arrière d'une migration |
| `pg_dump` chiffré hors Neon | hebdomadaire (dimanche) + mensuel | hebdomadaires : 8 semaines ; mensuels : 12 mois | Perte du projet ou du compte Neon, archivage |
| Test de restauration (§ 6) | mensuel, et après tout changement de plan ou de schéma important | compte rendu conservé | Prouver que la sauvegarde sert |

Objectifs indicatifs, à valider : **RPO** (perte maximale) de quelques minutes via la PITR ; une semaine dans
le pire cas (perte du projet Neon, reprise depuis `pg_dump`). **RTO** (délai de remise en service) : moins de
1 h via la PITR ; une journée depuis `pg_dump`. Ces chiffres ne sont **pas mesurés** : le premier test (§ 6)
les mesurera.

Coût : dépend du volume réel (inconnu, aucune donnée en production). Postes : historique (0,20 $/Go-mois),
instantanés (0,09 $/Go-mois), branches au-delà du forfait, stockage R2. Le propriétaire active une alerte de
consommation Neon (`docs/production-setup-guide.md` § 5).

## 6. Test de restauration : uniquement sur une branche dédiée

Interdits pendant un test :
- lancer *Restore* (PITR) ou une restauration d'instantané **en une étape** sur la branche principale ;
- **finaliser** une restauration en plusieurs étapes ;
- utiliser `pg_restore` avec une chaîne de la branche principale ou de staging ;
- brancher Vercel (Production ou Preview) sur la branche de test.

Nommage : `restore-test-AAAAMMJJ`. Durée de vie : supprimée après le compte rendu (sauf branches `_old_`
non supprimables, voir § 3.1).

### 6.1 Variante A : branche à un instant passé (teste la PITR sans rien écraser)

1. Lire l'heure du serveur : console Neon, ou `select now();` sur la branche principale. Choisir un instant
   cible `T` dans la fenêtre d'historique et le noter en UTC.
2. Avec *Time Travel Assist*, lancer à `T` les requêtes de référence du § 6.4 sur la branche principale
   (lecture seule) et garder les résultats.
3. Créer la branche `restore-test-AAAAMMJJ` **à partir de la branche principale, à l'instant `T`** (console :
   *Branches → New branch*, option de point dans le passé).
4. Récupérer la chaîne **directe** de cette branche seulement.
5. Lancer les vérifications du § 6.4 sur la branche de test et comparer aux résultats de l'étape 2 :
   ils doivent être identiques.
6. Noter la durée de chaque étape (mesure du RTO).

### 6.2 Variante B : instantané restauré en plusieurs étapes

1. Choisir un instantané (planifié ou manuel).
2. Restauration **en plusieurs étapes** : Neon crée une nouvelle branche à partir de l'instantané. Lui donner
   le nom `restore-test-AAAAMMJJ` si possible.
3. Vérifications du § 6.4 sur cette branche.
4. **Ne pas finaliser.** Supprimer la branche de test après le compte rendu.

### 6.3 Variante C : `pg_dump` chiffré vers une cible vide

Cible : une branche Neon dédiée **vide** (ou un projet Neon de test distinct), jamais une branche contenant
des données.

```powershell
age -d -i '<chemin de la clé privée>' -o restore.dump 'qadr-<date>.dump.age'
$env:PGURL_TEST = '<chaîne directe de restore-test-AAAAMMJJ>'
# La base cible doit exister et porter le même nom que la base source.
pg_restore -v --no-owner --single-transaction -d $env:PGURL_TEST restore.dump
Remove-Item restore.dump; Remove-Item Env:PGURL_TEST
```

Avec `--single-transaction`, un échec n'en laisse aucune trace partielle. Le rôle qui restaure devient
propriétaire des objets ; un rôle Neon n'est pas un vrai superutilisateur, d'où `--no-owner`. Si la branche
cible n'est pas vide (elle hérite de son parent), il faut une branche créée **sans données** ou un projet de
test vide : ne jamais restaurer par-dessus des données. Puis vérifications du § 6.4, en comparant aux
résultats relevés sur la source au moment du `pg_dump`.

### 6.4 Vérifications après restauration

Toutes en **lecture seule**, sur la branche de test. Les mêmes requêtes sont lancées sur la source au même
instant (Time Travel Assist pour A, juste avant le `pg_dump` pour C) ; les résultats doivent être identiques.

**a. Migrations**

```sql
select count(*) from drizzle."__drizzle_migrations";            -- attendu : 25 au 2026-11-09
select hash, created_at from drizzle."__drizzle_migrations" order by created_at desc limit 3;
```

Puis, depuis `apps/web`, `npx drizzle-kit check` (sans base) pour s'assurer que le dépôt et ses migrations
sont cohérents. **Ne pas** lancer `npm run db:migrate` sur la branche de test sans raison : une restauration
ne doit rien migrer.

**b. Structure**

```sql
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';   -- attendu : 63 au 2026-11-09
select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
 join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal;             -- identique à la source
select count(*) from pg_constraint where contype = 'f'
 and connamespace = 'public'::regnamespace;                     -- identique à la source
```

Les déclencheurs comptent : journal d'audit en ajout seul (migration 0010), session de caisse clôturée
figée (migration 0011).

**c. Nombre de lignes par table** (comptes exacts, identiques à la source)

```sql
select 'business_profile' t, count(*) from business_profile union all
select 'user', count(*) from "user" union all
select 'member', count(*) from member union all
select 'product_variant', count(*) from product_variant union all
select 'sale', count(*) from sale union all
select 'sale_line', count(*) from sale_line union all
select 'payment', count(*) from payment union all
select 'stock_movement', count(*) from stock_movement union all
select 'cash_session', count(*) from cash_session union all
select 'expense', count(*) from expense union all
select 'subscription_invoice', count(*) from subscription_invoice union all
select 'audit_event', count(*) from audit_event;
```

À étendre aux 63 tables (requête générée à partir de `information_schema.tables`).

**d. Intégrité métier** (empreintes à comparer à la source, par commerce)

```sql
-- Ventes : somme des totaux et des lignes
select s.business_id, count(*) ventes, sum(s.total_xof) total,
       (select sum(l.line_total_xof) from sale_line l where l.business_id = s.business_id) lignes
  from sale s group by s.business_id order by s.business_id;

-- Paiements confirmés par commerce
select business_id, method, sum(amount_xof) from payment
 where status = 'confirmed' group by business_id, method order by 1, 2;

-- Stock : quantité en main et somme des mouvements par commerce
select v.business_id, sum(v.on_hand) en_main,
       (select sum(m.quantity_delta) from stock_movement m where m.business_id = v.business_id) mouvements
  from product_variant v group by v.business_id order by 1;

-- Dernier événement d'audit (doit précéder ou égaler l'instant restauré)
select max(occurred_at) from audit_event;
```

Un écart entre `en_main` et `mouvements` n'est pas forcément une anomalie (règles de stock détaillées dans
`docs/stock-initial.md`) : ce qui compte est l'**égalité avec la source**. Toute différence avec la source
fait échouer le test.

**e. Application (facultatif, à décider)** : démarrer l'application **en local** contre la branche de test
(jamais via Vercel), se connecter avec un compte de test, ouvrir un rapport. Ne lancer aucune écriture.

### 6.5 Compte rendu

Date, opérateur, variante, instant ou instantané, durée de chaque étape, résultats a–d, écarts, décision.
Classé dans le registre (§ 8). Ensuite : suppression de la branche de test et de tout fichier déchiffré.

## 7. Objets hors base

### 7.1 Fichiers R2

- Seul usage branché : originaux des imports de catalogue (`docs/storage-r2.md`) ; R2 n'a jamais été contacté
  en réel. La base référence chaque objet dans `stored_file` (clé, SHA-256, statut).
- Une restauration de la base **ne restaure pas R2**, et inversement : après une PITR, des lignes
  `stored_file` peuvent pointer vers des objets déjà purgés, ou l'inverse. Le téléchargement échoue alors
  proprement (introuvable) ; l'import lui-même reste dans la base.
- Proposition : réplication périodique du bucket vers un second bucket (autre compte ou autre juridiction), à
  évaluer (coût, outil). Ces fichiers sont des copies de documents des commerçants, à durée de conservation
  limitée : leur perte est moins grave que celle de la base.

### 7.2 Secrets et configuration Vercel

Une base restaurée est inutilisable sans ses secrets. Le propriétaire conserve, dans un coffre de mots de
passe (jamais en clair dans le dépôt ni par messagerie), la liste et les valeurs des variables de production,
avec la date de dernière rotation :

- **critiques pour lire les données restaurées** : `BETTER_AUTH_SECRET` (sessions, et **chiffrement du secret
  TOTP et des codes de secours du propriétaire** : sans lui, `scripts/platform-owner.ts reset-2fa` est
  nécessaire), `DATABASE_URL`, `DATABASE_URL_UNPOOLED` ;
- **à reconfigurer sinon** : `BETTER_AUTH_URL`, `NEXT_PUBLIC_AUTH_URL`, `CRON_SECRET`,
  `NOTIFICATIONS_CRON_SECRET`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (sans la même paire,
  les abonnements push existants deviennent inutilisables), `R2_*`, `GENIUSPAY_*`, `TURNSTILE_SECRET_KEY` /
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `RESEND_*`, `SENTRY_*`, `NEXT_PUBLIC_POSTHOG_*`, `GOOGLE_*`, `APPLE_*`.

Également à noter : réglages Vercel (région des fonctions, crons de `apps/web/vercel.json`, domaines),
Cloudflare (DNS, WAF, widgets Turnstile), Neon (plan, fenêtre d'historique, planification des instantanés).
Une exportation Vercel des variables doit être chiffrée comme une sauvegarde de base.

### 7.3 Code

Le dépôt n'a pas de dépôt distant. Les migrations nécessaires pour reconstruire le schéma ne sont donc
protégées que par le poste de développement : un dépôt distant privé est un prérequis de la reprise.

## 8. Accès et responsabilités

| Rôle | Personne | Droits |
| --- | --- | --- |
| Propriétaire (Qadr Agency) | à nommer | Seul administrateur Neon, Vercel, Cloudflare ; seul détenteur de la clé privée de déchiffrement ; décide toute restauration de la branche principale |
| Opérateur de sauvegarde | à nommer (peut être le propriétaire) | Lance `pg_dump`, dépose les fichiers chiffrés, mène les tests de restauration sur branches dédiées ; **pas** de droit de restauration sur la branche principale |
| Suppléant | à nommer | Accès d'urgence au coffre (procédure scellée), deuxième compte administrateur Neon avec double authentification |
| Agent de codage | — | Aucun accès aux sauvegardes, aux chaînes de connexion ni aux clés ; peut rédiger les procédures |

Règles : double authentification sur Neon, Vercel, Cloudflare et le coffre ; clé de déchiffrement conservée
en deux exemplaires (coffre + support hors ligne) ; registre des sauvegardes et tests (date, type, empreinte,
emplacement, résultat) tenu par l'opérateur ; revue trimestrielle des accès.

## 9. Plan de reprise

| Incident | Action | Mécanisme |
| --- | --- | --- |
| Erreur de données récente (suppression, mauvais import, bogue) | Identifier l'instant juste avant ; vérifier sur une branche (§ 6.1) ; si la perte est limitée à un commerce, **préférer une réparation ciblée** depuis la branche de test plutôt qu'une restauration globale | Branche à un instant passé |
| Corruption étendue dans la fenêtre d'historique | Mise en maintenance ; accord écrit du propriétaire ; *Restore* de la branche principale à l'instant choisi ; vérifications § 6.4 ; réouverture | PITR (branche `_old_` gardée) |
| Migration ratée sur la branche principale | Restauration de l'instantané manuel pris juste avant (§ 5), ou PITR | Instantané / PITR |
| Erreur découverte hors fenêtre | Instantané planifié le plus proche ; extraction ciblée | Instantanés |
| Perte du projet ou du compte Neon, compromission | Nouveau projet Neon (ou autre PostgreSQL) ; `pg_restore` du dernier `pg_dump` ; secrets du coffre ; bascule de `DATABASE_URL` dans Vercel ; tests ; information des commerçants | `pg_dump` hors Neon |
| Fuite d'une sauvegarde | Rotation de `BETTER_AUTH_SECRET` (déconnexion générale), des clés concernées ; évaluation et notification selon les obligations applicables (`docs/privacy/register-of-processing.md`) | — |

Écritures perdues : une restauration à l'instant `T` efface tout ce qui a été écrit après `T` (ventes,
paiements, abonnements payés). Avant toute restauration de la branche principale, extraire depuis la branche
`_old_` les opérations postérieures à `T` pour les présenter aux commerces concernés ; ne jamais les réinjecter
automatiquement. Les paiements GeniusPay confirmés après `T` sont rapprochés par le cron
(`/api/cron/subscriptions`), qui relit le prestataire.

## 10. Export complet par commerce : un complément, pas une sauvegarde

`GET /api/business/data-export` (`docs/privacy/data-export.md`) produit une archive ZIP (JSON + CSV) de toutes
les données **d'un** commerce, pour son **propriétaire**. Il sert la portabilité et la confiance du
commerçant. Ce n'est **pas** une sauvegarde de la plateforme :
- un commerce à la fois, à la demande du propriétaire du commerce ;
- colonnes secrètes retirées, tables techniques exclues, comptes et sessions absents ;
- refus au-delà de 100 000 lignes par table ou 4 Mo d'archive ;
- aucun outil de réimportation n'existe.

## 11. Prérequis et points ouverts

1. Vérifier le plan Neon souscrit, puis régler la fenêtre d'historique et les sauvegardes planifiées (§ 5).
2. Créer la paire de clés de chiffrement des sauvegardes ; ranger la clé privée (coffre + hors ligne).
3. Créer le bucket R2 de sauvegarde et ses jetons séparés.
4. Installer `pg_dump`/`pg_restore` de la version majeure du serveur sur le poste de l'opérateur.
5. Premier essai complet **sur la branche de staging** : `pg_dump` (§ 4), puis test variante C (§ 6.3) vers
   une branche vide, et variante A (§ 6.1) depuis staging si c'est une branche racine (sinon, attendre la
   branche principale).
6. Avant la première migration de la branche principale : instantané manuel, puis test variante A dès que des
   données réelles existent.
7. Nommer les personnes du § 8 ; créer le registre.
8. Dépôt Git distant privé (§ 7.3).
9. Mettre à jour les valeurs attendues du § 6.4 (25 migrations, 63 tables) à chaque nouvelle migration.

## 12. Sources consultées (2026-11-09)

- Neon, *Instant restore* : https://neon.com/docs/introduction/branch-restore
- Neon, *Backup & restore* (instantanés, planifications, restauration en une ou plusieurs étapes) :
  https://neon.com/docs/guides/backup-restore
- Neon, *History window* (fenêtres par plan, facturation) : https://neon.com/docs/introduction/history-window
- Neon, *Plans* (fenêtres, instantanés, branches incluses) : https://neon.com/docs/introduction/plans
- Neon, *Manage projects* (réglage de la fenêtre) : https://neon.com/docs/manage/projects
- Neon, *Backups with pg_dump* : https://neon.com/docs/manage/backup-pg-dump
- Neon, *Migrate from Postgres* (options `pg_dump` / `pg_restore`) : https://neon.com/docs/import/migrate-from-postgres
- Neon, *Branching* : https://neon.com/docs/guides/branching-intro

Les tarifs, plafonds et noms de plans changent : les revérifier sur ces pages au moment de souscrire ou de
modifier la configuration, et noter la date.
