# Mission 16 : audit Neon, PostgreSQL et sauvegardes (2026-11-10)

> **Périmètre.** Lecture seule sur Neon (API et requêtes `select`), sauf les tests HTTP qui créent puis
> suppriment leurs propres bases jetables sur la branche de staging (`docs/validation.md`). Aucune branche,
> base, instantané ou souscription créés ; aucune migration de `main` ; aucune base supprimée. Aucune chaîne de
> connexion n'apparaît dans ce document ni dans les journaux cités.
>
> Suites : `neon-production-plan.md` (mise en production de la base), `backup-restore.md` (sauvegardes,
> mis à jour le même jour).

## 1. Migrations : dépôt et staging

| Contrôle | Résultat |
| --- | --- |
| Fichiers de migration du dépôt | 25 (`0000_young_galactus` à `0024_owner_two_factor_rate_limit`), journal `meta/_journal.json` à 25 entrées ; aucun changement non commité dans `apps/web/drizzle` |
| `drizzle."__drizzle_migrations"` de `qadr_staging` | 25 lignes (id 1 à 25) |
| Empreintes | Pour chacune des 25 lignes, `hash` = SHA-256 du fichier SQL correspondant, et `created_at` = `when` du journal : **identiques, dans l'ordre** |
| Dernière migration appliquée | `0024_owner_two_factor_rate_limit` (`90f5d57ac169d9e2…`) |
| Écart dépôt ↔ staging | **Aucun** |
| `npx drizzle-kit check` (depuis `apps/web`, sans base) | « Everything's fine », 63 s |
| `npx drizzle-kit generate` (sans base) | « No schema changes, nothing to migrate », 40 s ; aucun fichier créé |
| Branche `main`, base `neondb` | Schéma `public` vide, pas de schéma `drizzle` : **jamais migrée** (conforme à la règle). Schéma `neon_auth` de 9 tables créé par l'option *Managed Better Auth* de l'installation Vercel, inutilisé par l'application |

## 2. Structure : staging comparée à une installation neuve

Empreintes calculées par la même requête sur `qadr_staging` (Neon, PostgreSQL 18.6) et sur une base PGlite
(PostgreSQL 18.6 compilé en WebAssembly) migrée en mémoire depuis le dépôt (25 migrations en 28,5 s) :

| Mesure | Staging | PGlite neuve |
| --- | --- | --- |
| Tables `public` | 63 | 63 |
| Colonnes | 605 | 605 |
| Empreinte des colonnes (nom, type, nullabilité, défaut) | `53cfe55eb936069893c54bc8ed36cfa5` | identique |
| Index | 200 | 200 |
| Empreinte des définitions d'index | `52f27198861c1e7d4d2a0b2d43b6de57` | identique |
| Contraintes (y compris `NOT NULL`, enregistrées dans `pg_constraint` depuis PostgreSQL 18) | 825 | 825 |
| Empreinte des contraintes | `978a1317fe19205d9293e3c1cfa44853` | identique |
| Clés étrangères / dont composées | 158 / 70 | 158 / 70 |
| Déclencheurs | 3 | 3 |
| Empreinte des fonctions `public` | `e21427388beb57ef00597de077f5fcea` | identique |

Requête utilisée (lecture seule ; à relancer à l'identique pour toute comparaison future) :

```sql
select
 (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
 (select count(*) from information_schema.columns where table_schema='public') as colonnes,
 (select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), '|' order by table_name, column_name)) from information_schema.columns where table_schema='public') as empreinte_colonnes,
 (select count(*) from pg_indexes where schemaname='public') as index,
 (select md5(string_agg(indexdef, '|' order by indexname)) from pg_indexes where schemaname='public') as empreinte_index,
 (select count(*) from pg_constraint where connamespace='public'::regnamespace) as contraintes,
 (select md5(string_agg(conname||':'||pg_get_constraintdef(oid), '|' order by conname)) from pg_constraint where connamespace='public'::regnamespace) as empreinte_contraintes,
 (select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f') as fk,
 (select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f' and array_length(conkey,1)>1) as fk_composees,
 (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) as declencheurs,
 (select md5(string_agg(p.proname||':'||md5(p.prosrc), '|' order by p.proname)) from pg_proc p where p.pronamespace='public'::regnamespace) as empreinte_fonctions;
```

**Installation neuve sans opération manuelle : prouvée pour le schéma.** `pglite-migrations.integration.test.ts`
(3 tests, lancé localement, réussi : application des 25 migrations, types PostgreSQL et clés de commerce
attendus, aucune réapplication au second passage) et l'égalité des empreintes ci-dessus montrent que les
migrations seules reconstruisent exactement le schéma de staging. Chaque fichier de test HTTP sur Neon refait
d'ailleurs cette installation neuve dans une base jetable (§ 4). Restent hors migration, à faire à la main en
production : création du compte propriétaire (`scripts/platform-owner.ts`) et réglages Neon/Vercel.

Clés de commerce, constatées sur staging :
- toutes les tables métier portent `business_id` avec une clé étrangère vers `business_profile` ;
- les relations entre tables métier passent par des clés composées `(business_id, …)` (70), y compris
  `product → product_category`, qui a **aussi** une clé simple `category_id` (redondante, sans risque) ;
- **une seule relation entre tables métier sans clé composée** : `notification.outbox_id →
  notification_outbox.id`. Les deux `business_id` sont nullables (notifications de plateforme), ce qui empêche
  une clé composée simple. Les lignes sont écrites uniquement par le serveur (`enqueueNotification`) : risque
  faible, signalé pour décision (contrôle `check` ou déclencheur si l'on veut le garantir en base).

Déclencheurs présents : `audit_event_no_update_delete` (0010), `cash_movement_append_only` et
`cash_session_immutable_after_close` (0011).

## 3. Bases jetables orphelines sur la branche de staging

Les bases `qadr_t_<hex>` sont créées par `openPostgresHarness` (`src/test/postgres-harness.ts`) au début de
chaque fichier de test HTTP lancé sur Neon, et supprimées par `close()` (`drop database … with (force)`).
Elles restent si le processus est interrompu (délai dépassé, arrêt manuel) avant `close()`, ou si
`migrate()` échoue : le code n'a pas de `try/finally` autour de la migration, donc la base créée n'est alors
jamais supprimée.

État relevé le 2026-11-10 vers 06:05 UTC (lecture seule), **aucune n'a été supprimée** :

| Base | Créée (UTC) | Taille | Connexions | Contenu | Origine probable |
| --- | --- | --- | --- | --- | --- |
| `qadr_t_2daf7bad4b7c` | 2026-11-09 00:03 | 7,7 Mo (base vide) | 0 | Schéma `drizzle` et table `__drizzle_migrations` **vide** ; 0 table `public` | Lancement de la mission 14 avec 11 fichiers **en parallèle** (journal `m14-neon-http.log`, même minute) : la migration, transactionnelle, a échoué (connexion WebSocket dégradée) et a été annulée ; la base n'a pas été supprimée faute de `try/finally` |
| `qadr_t_26b71d2dd995` | 2026-11-09 07:00 | 16,3 Mo | 0 | 25 migrations, 63 tables ; ≈ 12 040 lignes dont 12 000 événements d'audit `test.volume`, 5 `business.data_exported`, 2 commerces de test | Fichier `business-data-export.http.test.ts` (test de volume) interrompu avant `close()` |
| `qadr_t_71046c3dca94` | 2026-11-09 08:46 | 11,9 Mo | 0 | 25 migrations, 63 tables ; ≈ 44 lignes : 2 campagnes, 2 factures d'abonnement (`paid`, `open`), 2 commerces de test | Fichier `campaign-invoice-discount.http.test.ts` interrompu avant `close()` |

Uniquement des données de test (comptes fictifs, mots de passe hachés de test, sessions expirées). Poids total
≈ 36 Mo sur une branche de 82 Mo logiques, limite Free de 1 Go par branche : sans urgence.

Actions proposées, **à autoriser par le propriétaire** :
1. suppression des trois bases, depuis la console Neon (*Branches → mission-14-staging → Databases*) ou par
   `drop database qadr_t_… with (force);` sur la branche de staging uniquement ;
2. correctif du harnais : `try { migrate } catch { drop database; throw }`, et nettoyage dans `close()` même si
   `connection.end()` échoue ;
3. éventuellement, au démarrage d'une campagne, la liste des `qadr_t_*` de plus de 24 h affichée (jamais
   supprimée automatiquement).

## 4. Revalidation de la connexion staging

Conditions : script `neon16.sh` (copie de `neon15.sh`, journaux dans le dossier `neon16/` du bloc-notes de
session), variables `QADR_TEST_POSTGRES_URL` (chaîne **directe** de `qadr_staging`, lue dans un fichier local
jamais affiché) et `QADR_TEST_POSTGRES_TARGET=staging` ; **un fichier à la fois**, `--maxWorkers=1
--no-file-parallelism`, délai de 2 400 s par fichier. Horloge : écart mesuré de 1,08 s (poste en retard),
dispersion 44 ms, RTT médian 211 ms.

**Résultats (2026-11-10, branche `mission-14-staging`, base `qadr_staging`).**

| Fichier | Passe `neon16` (06:21–08:39 UTC) | Relance | Durée |
| --- | --- | --- | --- |
| `postgres-harness.test.ts` | 4/4 | — | 48 s |
| `merchant-journey.http.test.ts` | 11/11 | `neon16c` : 11/11 | 317 s / 290 s |
| `rate-limit.http.test.ts` | 9/9 | `neon16c` : 9/9 | 284 s / 259 s |
| `platform-owner-login.http.test.ts` | 16/16 | — | 503 s |
| `subscription-billing.http.test.ts` | 32/32 | — | 880 s |
| `tenant-isolation.http.test.ts` | 21/21 | `neon16c` : 21/21 | 560 s / 492 s |
| `roles-and-status.http.test.ts` | 8/8 | `neon16c` : 8/8 | 299 s / 306 s |
| `business-data-export.http.test.ts` | 9/9 | — | 295 s |
| `campaign-invoice-discount.http.test.ts` | **échec** (1 test sur 6) | `neon16b` : 6/6 | 265 s / 279 s |
| `platform-and-system.http.test.ts` | **échec** (1 test sur 5, 4 126 s) | `neon16b` : 5/5 | 4 126 s / 152 s |
| `public-campaigns.http.test.ts` | 11/11 | — | 312 s |
| `push-device-isolation.http.test.ts` | 6/6 | — | 178 s |
| `stored-files.http.test.ts` | 5/5 | — | 176 s |

- **Les deux échecs** de la première passe ont la même cause : la connexion WebSocket vers Neon a été fermée
  (`TypeError` levée par `onSocketClose` d'undici, `readyState: 3`). Ce n'est pas une assertion métier en
  échec. Relancés seuls à 11:14 UTC (`neon16b`), les deux fichiers passent. Aucun délai d'attente n'a été
  modifié.
- **`neon16c`** (11:23–11:45 UTC) relance les quatre fichiers qui couvrent le contrôle d'origine et les
  routes `/api/account/*` du lot C, car la première passe a pu les exécuter avant ces changements. Les
  quatre passent.
- **Bases jetables** : liste relue par l'API Neon après la dernière campagne. Ce sont toujours les trois
  orphelines du § 3 (`qadr_t_26b71d2dd995`, `qadr_t_2daf7bad4b7c`, `qadr_t_71046c3dca94`) ; aucune nouvelle,
  même après les deux coupures. Aucune n'a été supprimée.
- `pglite-migrations.integration.test.ts` (3/3) tourne sur PGlite : il ne prouve rien sur Neon et figure
  dans la régression locale.
- **Non couvert** : les autres fichiers HTTP n'ont été exécutés que sur PGlite. Aucune mesure de charge n'a
  été faite (B-1).

## 5. Pools et transactions

- Application : `getDatabase()` garde **un pool par URL et par processus** (`Map`), attaché par
  `attachDatabasePool` (Vercel Fluid Compute) ; `idleTimeoutMillis` 10 s, `connectionTimeoutMillis` 5 s. Aucun
  pool par requête. Les routes sans contexte de commerce passent par `getRuntimeDatabase()`.
- Transactions interactives via le Pool WebSocket de `@neondatabase/serverless` : compatibles avec la chaîne
  *pooled* (PgBouncer en mode transaction), car le code n'utilise ni `SET` de session, ni verrou consultatif de
  session, ni `LISTEN`. L'export complet utilise `repeatable read` en lecture seule dans une transaction :
  compatible.
- Verrous : `SELECT … FOR UPDATE` trié par identifiant (`docs/performance.md`), validé sur Neon par les tests
  de caisse, d'achats et d'inventaire du parcours marchand.
- Serveur de staging : `max_connections` = 112 à 0,25 CU.
- **Migrations** : `scripts/migrate.ts` utilise le migrateur `neon-http`, **non transactionnel** (une
  instruction par requête HTTP, journal écrit à la fin), et n'accepte que `QADR_DB_TARGET=development`. Le
  harnais, lui, utilise `neon-serverless`, transactionnel. Voir `neon-production-plan.md` § 2.3 : correctif à
  autoriser avant toute migration de production.

## 6. Sauvegardes : constat

- Offre Free gérée par Vercel ; historique 6 h ; **0 instantané** ; **aucune planification** (API, branche
  `main`).
- Aucun outil `pg_dump`/`pg_restore`/`psql`/`age` sur le poste ; `gpg` et Docker disponibles.
- Aucun test de restauration exécuté. Procédure prête sans nouvelle branche : `backup-restore.md` § 6.3 bis
  (base vide `qadr_restore_test` sur la branche de staging, à autoriser). Requête de sommes de contrôle par
  table vérifiée en lecture seule sur `qadr_staging` (63 requêtes générées, toutes les tables ont une clé
  primaire) : `backup-restore.md` § 6.4 e.

## 7. Actions du propriétaire

1. Décider la région et l'option (branche `main` du projet actuel ou projet dédié) : `neon-production-plan.md`
   § 3 et § 4, avec l'avis du juriste.
2. Décider l'offre payante (depuis Vercel) avant toute donnée réelle : dépense.
3. Autoriser le correctif de `scripts/migrate.ts` (migration transactionnelle, cible de production) et celui du
   harnais.
4. Autoriser la suppression des 3 bases orphelines.
5. Installer `pg_dump` 18 (ou autoriser l'image Docker `postgres:18`), créer la clé de chiffrement des
   sauvegardes, puis autoriser le premier test de restauration (§ 6.3 bis).
6. Décider du sort du schéma `neon_auth` (option *Managed Better Auth* inutilisée) : le laisser, ou le
   désactiver depuis Vercel ; ne pas le supprimer à la main.
