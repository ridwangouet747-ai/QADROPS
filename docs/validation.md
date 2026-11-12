# Campagne de validation (mission 11, phase 7)

Date : 2026-11-03. Périmètre : l'application `apps/web`. Le MVP historique à la racine n'est pas
concerné.

Ce document décrit :

- ce qui est vérifié **au niveau des routes HTTP** ;
- le parcours de bout en bout ;
- les tests de charge préparés ;
- ce qui reste bloqué.

Il ne remplace pas une vérification sur une préproduction réelle, qui n'existe pas encore
(B-1).

## 1. Méthode

### Harnais HTTP (`apps/web/src/test/http-harness.ts`)

- **Base :** une instance PGlite en mémoire, avec toutes les migrations de `apps/web/drizzle/`.
  Aucune base distante n'est contactée : `DATABASE_URL` pointe vers `harnais.invalid`, qui n'est
  jamais appelé.
- **Un seul simulacre :**
  ```ts
  vi.mock("@/lib/db/client", () => import("@/test/harness-database"))
  ```
  `getDatabase()` renvoie la base PGlite. Rien d'autre n'est simulé :
  - l'authentification Better Auth (`createQadrAuth` / `getAuth()`) ;
  - les cookies de session ;
  - `getBusinessContext` et `assertActiveMembership` ;
  - les permissions ;
  - `assertBusinessOperational` ;
  - `runIdempotent`.
- **Sessions réelles :** chaque acteur s'inscrit par la vraie route `/api/auth/sign-up/email`.
  Le cookie signé renvoyé est rejoué tel quel.
- **Appels :** les fonctions exportées `GET`/`POST`/`PATCH`/`PUT`/`DELETE` des fichiers
  `route.ts` sont appelées directement, avec un vrai `Request` et `params` sous forme de promesse.
  Le chemin est donc identique à celui de Next.js, à l'exception du routage.
- **Montée en données :** les commerces, membres (invitation puis acceptation), produits,
  ventes, etc. sont créés **par les routes**, jamais par insertion SQL. Il y a deux exceptions,
  documentées dans les tests :
  - l'attribution du droit Super Admin, qui n'existe que via `scripts/platform-admin.ts` ;
  - la mise en place d'états difficiles à atteindre par l'API : abonnement `expired`, essai échu,
    session restée active après une désactivation.
- **Environnement de test :**
  - `RESEND_*`, `TURNSTILE_*`, `VAPID_*`, `SENTRY_DSN` et PostHog sont retirés ;
  - aucun e-mail ni aucune notification push ne part ;
  - aucun secret réel n'est lu ni inventé.
- **PostgreSQL réel (mission 14, `src/test/postgres-harness.ts`)** : avec `QADR_TEST_POSTGRES_URL` (connexion
  directe, jamais `-pooler`) et `QADR_TEST_POSTGRES_TARGET=staging`, chaque fichier de test crée une base
  jetable `qadr_t_<hex>` sur ce serveur, y applique les 25 migrations, puis la supprime (`drop … with (force)`).
  Les bases `neondb` et `postgres` sont refusées. Usage prévu : la branche Neon de staging seulement, jamais
  la branche principale. Sans ces variables, PGlite en mémoire (comportement par défaut).
  **Horloges (mission 14.1).** Les décisions temporelles du code (échéances, sessions, expiration) utilisent
  l’horloge du serveur (`new Date()`) ; les colonnes `defaultNow()` utilisent celle de PostgreSQL. Avec PGlite
  c’est la même, avec Neon non : le 2026-11-09, le poste avait **3 624,2 s** de retard sur Neon (mesure par epoch
  UTC, dispersion 13 ms ; source Windows « Local CMOS Clock », jamais synchronisée). Règles qui en découlent :
  - toute échéance comparée par le code est **écrite par le code** (ex. `notification_outbox.next_attempt_at`
    dans `enqueueNotification`, sinon un serveur en retard laissait l’événement attendre la tâche planifiée) ;
  - un test qui fabrique une date à comparer par le code la calcule en JavaScript (`new Date(Date.now() - …)`),
    jamais avec `now()` SQL ; les marges d’un jour ou plus restent tolérées.
  La signature des webhooks GeniusPay (tolérance 300 s) exige en revanche une horloge du poste synchronisée.

### Écrire un test de route

```ts
vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
import * as salesRoute from "@/app/api/business/sales/route";
import { startHttpHarness, newKey, type HttpHarness } from "./http-harness";

let h: HttpHarness;
beforeAll(async () => { h = await startHttpHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

it("…", async () => {
  const owner = await h.signUp("Awa", "awa@exemple.test");
  await h.createBusiness(owner, "Quincaillerie Awa", "hardware");
  const r = await h.call(salesRoute.POST, { path: "/api/business/sales", actor: owner,
    body: { idempotencyKey: newKey("vente"), lines: [], payments: [] } });
  expect(r.status).toBe(400);
});
```

### Règles d'assertion

- **Identifiant d'un autre commerce :**
  - la réponse doit être **identique** (statut et corps) à celle obtenue avec un identifiant
    inexistant (`expectSameAsUnknown`) ;
  - la route ne doit donc pas servir d'oracle d'existence.
- **Aucune fuite :** aucune réponse, y compris d'erreur, ne contient le nom d'un article ou d'un
  client de B, ni son téléphone (`expectNoLeak`).
- **État inchangé :** toutes les tables qui portent `business_id`, plus `organization`, `member`,
  `invitation`, les sessions et les appareils push de B, sont photographiées avant les
  attaques. L'état de B doit être **strictement identique** après.

## 2. Résultats

### Fichiers de test ajoutés

| Fichier | Tests | Objet |
| --- | --- | --- |
| `src/test/tenant-isolation.http.test.ts` | 19 | Commerce A contre commerce B, sur tous les domaines |
| `src/test/roles-and-status.http.test.ts` | 8 | Sans session, caissier, gérant, membre désactivé, commerce suspendu, expiré, essai échu |
| `src/test/merchant-journey.http.test.ts` | 11 | Parcours complet d'un commerçant, totaux vérifiés à chaque étape |
| `src/test/platform-and-system.http.test.ts` | 5 | Console Super Admin, tâches planifiées, routes publiques |
| `src/test/load-test-guard.test.ts` | 2 | Garde-fou des scripts k6 |

**Total : 45 tests réussis.** L'écart E-1, d'abord documenté par un `it.fails`, est corrigé (voir E-1).

### Commandes exécutées

Toutes les commandes ont été lancées depuis `apps/web`, le 2026-11-03 :

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | Types générés, `tsc --noEmit` sans erreur |
| `npm run lint` | Sans erreur ni avertissement |
| `npx vitest run src/test` | 5 fichiers réussis. Tests : 44 réussis et 1 échec attendu (45), en 128 s |
| `npx vitest run src/components src/lib/{analytics,auth,client,exports,i18n,imports,notifications,onboarding,preview,printing,pwa,subscription} src/lib/*.test.ts` | 34 fichiers réussis. Tests : 256 réussis (256) |
| `npx vitest run src/lib/domain src/lib/db` | 21 fichiers réussis. Tests : 166 réussis (166) |

**Vitest complet, en trois groupes :** 60 fichiers, 466 tests réussis et 1 échec attendu.

### Ce qui est prouvé

- **Isolation des commerces.** A ne peut ni lire, ni modifier, ni archiver, ni exporter, ni
  imprimer, ni valider quoi que ce soit chez B, même en remplaçant les identifiants. Cela vaut
  pour toutes les routes `[id]` et pour tous les identifiants « étrangers » glissés dans un
  corps :
  - variante dans une vente ;
  - client dans un règlement ;
  - fournisseur dans un achat ;
  - catégorie dans un inventaire ;
  - variante dans un rapprochement d'import ;
  - imprimante dans un ticket ;
  - vente dans une réimpression.

  Les compléments :
  - Les réponses sont identiques à celles d'un identifiant inexistant (404), y compris pour un
    client de B dans une vente depuis la correction de E-1.
  - Un `businessId` de B passé dans le corps, l'URL ou un en-tête est ignoré.
  - Les listes, le tableau de bord, les rapports et les exports CSV, XLSX et PDF de A ne
    contiennent aucune donnée de B.
  - Sélectionner B comme commerce actif répond 403, exactement comme un commerce inexistant.
  - Les routes HTTP `/api/auth/organization/*` de Better Auth répondent 404 :
    `set-active`, `update`, `remove-member` et `get-full-organization` avec l'identifiant de B.
  - Un code promotionnel réservé à B répond à A comme un code inconnu.
  - Les notifications, appareils push et préférences d'un autre compte ne sont ni lus ni
    modifiés. Un `userId` glissé dans la requête est ignoré.
  - L'état complet de B est inchangé après toutes les tentatives.
- **Rôles.**
  - **Sans session ou avec un cookie forgé :** 401 `Authentification requise.`.
  - **Caissier :** il vend, crée un client et ouvre sa caisse. Il reçoit 403, sans écriture, sur
    26 actions de propriétaire ou de gérant :
    - catalogue et catégories ;
    - rapports, tableau de bord et exports XLSX et CSV ;
    - réglages, équipe (lecture, invitation, rôle, désactivation du propriétaire) ;
    - dépenses, fournisseurs, achats ;
    - stock de départ, inventaire, import de catalogue ;
    - impression, code d'abonnement ;
    - lecture, clôture et validation de la caisse d'une autre personne.

    Sur la console plateforme (27e tentative), il reçoit 404. Seul l'audit attendu
    `subscription.promotion_rejected` est écrit.
  - **Gérant :** il ne peut ni inviter un propriétaire, ni rétrograder ou désactiver le
    propriétaire, ni se désactiver lui-même.
- **Membre désactivé.**
  - Il est refusé à la requête suivante, y compris avec une session restée active sur le
    commerce.
  - Il ne peut pas resélectionner le commerce.
  - Il retrouve l'accès après réactivation.
- **Commerce bloqué.** Qu'il soit suspendu par la console, en abonnement `expired` ou en essai
  échu, le commerce est traité ainsi :
  - 9 écritures représentatives répondent 403, sans audit ni effet :
    - création et modification d'un produit ;
    - vente et création d'un client ;
    - achat et dépense ;
    - ouverture de caisse, inventaire et ticket d'impression ;
  - les lectures et exports restent permis ;
  - les écritures reprennent après réactivation.
- **Console plateforme :**
  - Les 24 handlers répondent 404 avec le même message à un commerçant et à un compte sans
    commerce, sans aucune écriture.
  - Sans session, ils répondent 401.
- **Tâches planifiées :**
  - sans `CRON_SECRET`, elles répondent 404 ;
  - avec un mauvais secret, 401 ;
  - `/api/internal/notifications/process` refuse tout appel sans secret.
- **Parcours du commerçant (`merchant-journey`).** Le scénario enchaîne :
  1. inscription et création du commerce ;
  2. ajout d'un gérant et d'une caissière ;
  3. création de deux articles ;
  4. stock de départ (mouvement d'ouverture, aucun achat créé), rejoué ;
  5. ouverture de caisse ;
  6. vente en espèces rejouée deux fois : une seule vente, un seul paiement, un seul déstockage ;
     la même clé avec un autre contenu répond 409 ;
  7. vente à crédit, règlement partiel rejoué, dépassement refusé (409), solde par Wave ;
  8. achat fournisseur partiellement payé ;
  9. dépense ;
  10. inventaire avec écart justifié, validé par une autre personne que l'auteur ;
  11. clôture de caisse sans écart, puis validation. Espèces attendues : 29 500, soit le fonds
      de caisse (10 000), la vente comptant (16 500), l'acompte en espèces de la vente à crédit
      (2 000) et le règlement en espèces (1 000) ;
  12. rapport du jour : chiffre d'affaires 21 500, encaissements 21 500, marge brute 3 100,
      résultat estimé 100 ;
  13. exports CSV et XLSX cohérents avec le rapport.

  Tous les champs `…Xof` sont des chaînes d'entiers. Les coûts unitaires moyens sont des chaînes
  décimales à 12 chiffres, par conception. Aucun montant n'est un `number`.

### 403 et 404

Le comportement est cohérent :

| Situation | Statut |
| --- | --- |
| Ressource d'un autre commerce | 404 |
| Commerce non autorisé à la sélection | 403, comme un commerce inconnu |
| Rôle insuffisant | 403 |
| Commerce bloqué | 403 avec un `code` stable |
| Console plateforme sans droit | 404, pour ne pas révéler son existence |
| Sans session | 401 |

Seule incohérence trouvée : E-1, corrigée depuis.

## 3. Écarts constatés

| Code | Constat | Gravité | Suite |
| --- | --- | --- | --- |
| E-1 | `POST /api/business/sales` avec le `customerId` d'un **autre commerce** répond **500 « Erreur interne. »** au lieu de 404. `createSale` (`apps/web/src/lib/domain/commercial.ts`, l. 148-192) n'y vérifie pas le client avant l'insertion. La clé étrangère composite `(business_id, customer_id)` refuse bien la ligne (23503), mais l'erreur remonte en 500 et part vers Sentry. | Faible : **aucune fuite ni écriture**, la contrainte protège. La réponse est identique à celle d'un client inexistant (500 aussi), donc pas d'oracle d'existence. Mais c'est une erreur 500 évitable, qui pollue Sentry et n'aide pas l'utilisateur. | Test `it.fails` dans `tenant-isolation.http.test.ts`. Correctif proposé : lire le client `(business_id, id)` dans la transaction et lever `CommercialError(…, 404, "not_found")`. **Corrigé après la fusion des phases 6 et 7** : `createSale` lit le client dans la transaction et répond 404 « Client introuvable dans ce commerce. » ; le test est passé de `it.fails` à `it` et compare la réponse à celle d'un client inconnu. |
| O-1 | `addPrintDevice` et `updatePrintDevice` (`apps/web/src/lib/domain/printing.ts`, l. 73-97) n'appellent pas `assertBusinessOperational`. Un commerce suspendu peut donc encore déclarer ou régler une imprimante. Les tickets, eux, sont bloqués. | Observation : ce n'est pas une écriture financière ni une écriture de stock. | **Corrigé (mission 15)** : `updatePrinterSettings`, `addPrintDevice`, `updatePrintDevice` et `archivePrintDevice` appellent `assertBusinessOperational`, comme les réglages du commerce ; ajoutés à `operation-integrity.integration.test.ts`. |
Aucune faille d'isolation entre commerces n'a été trouvée. Aucun code de production n'a été
modifié pendant cette phase.

## 4. Couverture route par route

Inventaire : `find src/app/api -name route.ts` donne **81 fichiers**. Légende des tests :

| Abréviation | Fichier ou rôle |
| --- | --- |
| **TI** | `tenant-isolation` |
| **RS** | `roles-and-status` |
| **MJ** | `merchant-journey` |
| **PS** | `platform-and-system` |
| **H** | Utilisée par le harnais pour monter les données (chemin nominal seulement) |

### Compte (`/api/account`)

| Route | Méthodes | Couverture |
| --- | --- | --- |
| `account/active-business` | POST | TI (B refusé comme inconnu), RS (membre désactivé) |
| `account/businesses` | POST | H, MJ (création du commerce). Pas d'attaque possible : crée un commerce neuf |
| `account/capabilities` | GET | PS |
| `account/invitations/[invitationId]` | GET, POST | TI (invitation d'une autre personne), H (acceptation) |
| `account/me` | GET | MJ, TI |
| `auth/[...all]` (Better Auth) | GET, POST | H (inscription, connexion). TI : `organization/*` répond 404. **Non couvert ici :** réinitialisation du mot de passe, vérification d'e-mail et limitation de débit (couverts par `src/lib/auth/*.test.ts`) |

### Commerce (`/api/business`)

| Route | Méthodes | Couverture |
| --- | --- | --- |
| `business/cash` | GET, POST | TI, RS, MJ |
| `business/cash/[sessionId]` | GET | TI, RS, MJ |
| `business/cash/[sessionId]/close` | POST | TI, RS, MJ |
| `business/cash/[sessionId]/movements` | POST | TI |
| `business/cash/[sessionId]/validate` | POST | TI, RS, MJ |
| `business/categories` | GET, POST | TI, RS |
| `business/customers` | GET, POST | TI, RS, MJ |
| `business/customers/payments` | POST | TI, MJ |
| `business/dashboard` | GET | TI, RS |
| `business/expenses` | GET, POST | TI, RS, MJ |
| `business/imports` | GET, POST | TI, RS |
| `business/imports/[importId]` | GET, PATCH | TI |
| `business/imports/[importId]/apply` | POST | TI |
| `business/imports/[importId]/discard` | POST | TI |
| `business/imports/[importId]/rows/[rowId]` | PATCH | TI |
| `business/inventories` | GET, POST | TI, RS, MJ |
| `business/inventories/[sessionId]` | GET | TI |
| `business/inventories/[sessionId]/counts` | POST | TI, MJ |
| `business/inventories/[sessionId]/submit` | POST | TI, MJ |
| `business/inventories/[sessionId]/validate` | POST | TI, MJ |
| `business/opening-balances` | GET, POST | TI |
| `business/opening-balances/[balanceId]/payments` | POST | TI |
| `business/printing` | GET, PUT | TI, RS |
| `business/printing/devices` | POST | TI, RS |
| `business/printing/devices/[deviceId]` | PATCH, DELETE | TI |
| `business/printing/jobs` | GET, POST | TI, RS |
| `business/printing/jobs/[jobId]` | POST | TI |
| `business/products` | GET, POST | TI, RS, MJ |
| `business/products/[productId]` | PATCH, DELETE | TI, RS |
| `business/purchases` | GET, POST | TI, RS, MJ |
| `business/reports` | GET | TI, RS, MJ |
| `business/reports/export` | GET | TI (CSV, XLSX, PDF), RS, MJ (CSV, XLSX) |
| `business/sales` | GET, POST | TI, RS, MJ |
| `business/sales/[saleId]` | GET | TI, MJ |
| `business/settings` | GET, PATCH | TI, RS |
| `business/stock` | GET | TI, MJ |
| `business/stock/movements` | GET | TI |
| `business/stock/opening` | GET, POST | TI, RS, MJ |
| `business/subscription` | GET | TI |
| `business/subscription/promotion` | POST | TI, RS |
| `business/suppliers` | GET, POST | TI, RS, MJ |
| `business/team` | GET | TI, RS |
| `business/team/invitations` | POST | TI, RS, H |
| `business/team/invitations/[invitationId]` | DELETE | TI |
| `business/team/members/[memberId]` | PATCH | TI, RS |
| `business/team/members/[memberId]/access` | POST | TI, RS |

### Notifications

| Route | Méthodes | Couverture |
| --- | --- | --- |
| `notifications` | GET | TI |
| `notifications/preferences` | GET, PUT | TI |
| `notifications/push-config` | GET | PS |
| `notifications/push-subscriptions` | POST, DELETE | TI |
| `notifications/push-subscriptions/[subscriptionId]` | DELETE | TI |
| `notifications/read` | POST | TI |
| `notifications/unread-count` | GET | TI |

### Système

| Route | Méthodes | Couverture |
| --- | --- | --- |
| `cron/subscriptions` | GET | PS (sans secret, mauvais secret, bon secret de test) |
| `internal/notifications/process` | GET, POST | PS (refus sans secret). **Le chemin autorisé n'est pas couvert ici** ; il l'est par les tests de `lib/domain/notifications` |
| `observability/sentry-test` | POST | PS (404 hors développement) |

### Plateforme (`/api/platform`)

Toutes ces routes sont couvertes par PS : 404 pour un commerçant ou un compte sans commerce, 401
sans session, 200 pour le Super Admin sur les lectures. TI et RS testent en plus la suspension.

| Route | Méthodes | Couverture |
| --- | --- | --- |
| `platform/audit` | GET | PS |
| `platform/businesses` | GET | PS |
| `platform/businesses/[businessId]` | GET, PATCH | PS, TI, RS (suspension et reprise) |
| `platform/dashboard` | GET | PS |
| `platform/notifications/activity` | GET, POST | PS |
| `platform/notifications/campaigns` | POST | PS |
| `platform/notifications/campaigns/[campaignId]` | POST | PS |
| `platform/notifications/templates` | GET, POST | PS |
| `platform/notifications/templates/test` | POST | PS |
| `platform/overview` | GET | PS |
| `platform/plans` | GET, POST | PS |
| `platform/plans/[planId]` | PATCH | PS |
| `platform/promotions` | GET, POST | PS, TI (code réservé) |
| `platform/promotions/[promotionId]` | PATCH | PS |
| `platform/promotions/[promotionId]/status` | POST | PS |
| `platform/promotions/batch` | POST | PS |
| `platform/settings` | GET | PS |
| `platform/subscriptions` | GET | PS |
| `platform/subscriptions/[subscriptionId]` | PATCH | PS |

### Bilan

- Les 81 fichiers de route sont tous appelés au moins une fois par un test HTTP.
- Chaque méthode exportée l'est aussi.
- Restent **non couverts au niveau HTTP** :
  - les parcours de Better Auth autres que l'inscription, la connexion et `organization/*` ;
  - le chemin autorisé de `internal/notifications/process` ;
  - les écritures **réussies** de la console plateforme : seul le refus est testé ici, le
    contenu métier relevant de `lib/domain/platform*.integration.test.ts`.

## 5. Tests de charge (préparés, non exécutés)

- **Emplacement :** `apps/web/load-tests/`, mode d'emploi dans
  `apps/web/load-tests/README.md`.
- **`smoke.js` :** 2 utilisateurs virtuels pendant 1 min, lectures seules.
- **`pos-peak.js` :** montée de 0 à 100, 250, 500 puis 1 000 utilisateurs virtuels, avec un
  palier de 5 min au pic.
  - Chaque utilisateur virtuel recherche un article.
  - Si `QADR_LOAD_WRITE=true`, il crée aussi une vente en espèces avec une clé d'idempotence, en
    rejoue environ 2 % (une seule vente attendue), puis la relit.
- **Seuils :**
  - erreurs `< 1 %`, avec arrêt automatique à 5 % ;
  - p95 `< 800 ms` en lecture ;
  - p95 `< 1 500 ms` et p99 `< 3 000 ms` à la création de vente ;
  - `checks > 99 %`.
- **Garde-fou :** `load-tests/lib/target.js` refuse toute URL sans marqueur de préproduction.
  - Marqueurs acceptés : `localhost`, `*.test`, ou un segment d'hôte `staging`, `preview`,
    `preprod`, `qa`, `sandbox`, `test` ou `dev`.
  - Il exige HTTPS à distance et refuse les identifiants dans l'URL.
  - Il n'offre aucune option pour passer outre.
  - Il est testé par `src/test/load-test-guard.test.ts`.
- **Exécution :** k6 n'est pas installé. Ces scripts **n'ont jamais été exécutés**, ni en local,
  ni à distance.

## 6. Ce qui reste bloqué ou non vérifié

- **B-1, préproduction Neon et Vercel.** Restent bloqués :
  - les tests de charge ;
  - le parcours de bout en bout sur la vraie pile : Neon, `neon-serverless` Pool, fonctions
    Vercel, Cloudflare devant ;
  - la vérification des sauvegardes et de la restauration.

  Le harnais tourne sur PGlite. Les verrous, l'isolation transactionnelle et les performances de
  Neon sous concurrence réelle **ne sont donc pas mesurés**.
- **B-2, imprimantes physiques.** Les tests prouvent l'isolation des tâches d'impression, pas une
  sortie papier. Aucun ticket n'est réputé imprimé.
- **Navigateur.** Il n'existe aucun test de bout en bout dans un navigateur : Playwright n'est
  pas installé, par décision. Ne sont donc pas testés de bout en bout dans l'interface :
  - le rendu des écrans en arabe (RTL) ;
  - le service worker ;
  - Turnstile ;
  - les e-mails Resend.
- **Concurrence.** Les rejeux d'idempotence du harnais sont séquentiels. Deux envois simultanés
  de la même clé ne sont couverts que pour une dépense, au niveau du service
  (`operation-integrity.integration.test.ts`), et sur PGlite, qui sérialise les connexions.

## 7. Mission 18 : RLS et cookies (2026-11-12)

| Fichier | Tests | Objet |
| --- | --- | --- |
| `src/test/tenant-rls.http.test.ts` | 8 | Refus **par PostgreSQL** sous le rôle `qadr_tenant` : catalogue des politiques, lectures et écritures croisées, absence de contexte, tables globales, contexte limité à la transaction |
| `src/test/session-cookies.http.test.ts` | 3 | Cookie de session (dev et production `__Secure-`), durée de 7 jours, révocation à la déconnexion |

Écrire un test qui doit prouver un refus de PostgreSQL : Drizzle enveloppe l'erreur (« Failed query… »), le message
de PostgreSQL est dans `error.cause.message` (voir `refusedByPostgres` dans `tenant-rls.http.test.ts`).

Ces tests tournent sur PGlite. Leur exécution sur Neon staging (`QADR_TEST_POSTGRES_URL` +
`QADR_TEST_POSTGRES_TARGET=staging`) exige d'abord d'appliquer la migration 0025 sur `qadr_staging`, ce qui n'est pas
fait (autorisation du propriétaire requise). Statuts détaillés : `docs/security/production-security-audit.md`.
