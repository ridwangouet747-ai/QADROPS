# Audit de sécurité avant production — mission 18

> Date : 2026-11-12. Branche locale `feat/mission-13-reprise`, rien de poussé ni déployé.
> Périmètre : application `apps/web` (Next.js 16.4, Better Auth 1.7.7, Drizzle + Neon, R2, GeniusPay, Resend, Turnstile).
> Le MVP historique de la racine n'est pas destiné à la production et n'est pas audité ici.

Ce document est un **état des contrôles**, pas une attestation. Il ne déclare ni conformité réglementaire ni sécurité absolue.
Chaque contrôle porte l'un des statuts suivants :

| Statut | Sens |
| --- | --- |
| **VALIDÉ** | Contrôle en place **et** vérifié par un test automatisé ou une inspection reproductible décrite ici. |
| **PARTIEL** | En place sur une partie du périmètre, ou vérifié seulement en local (PGlite), pas sur l'infrastructure réelle. |
| **À CORRIGER** | Écart constaté, correctif à écrire. |
| **BLOQUÉ** | Ne peut pas avancer sans décision, accès ou dépense du propriétaire. |
| **NON APPLICABLE** | Le contrôle ne concerne pas Qadr Ops dans son état actuel. |

« Vérifié en local » signifie : base PGlite migrée (PostgreSQL 17 embarqué), sessions Better Auth réelles, routes appelées par le harnais HTTP (`src/test/http-harness.ts`). Ce n'est **pas** Neon (PostgreSQL 18) ni Vercel.

---

## 1. Architecture de sécurité

```
Navigateur ──HTTPS──> Cloudflare (DNS, WAF, Turnstile ; nuage gris au lancement)
                         │
                         ▼
                      Vercel (Next.js, Node 24, fonctions Fluid)
                         │  proxy.ts → en-têtes de sécurité (next.config.ts)
                         │  getBusinessContext / getAccountContext / getPlatformContext
                         │     ├─ assertTrustedOrigin (403 invalid_origin)
                         │     ├─ session Better Auth (cookie HttpOnly)
                         │     ├─ assertActiveMembership + permission (permissions.ts)
                         │     └─ services métier : transaction, assertBusinessOperational, runIdempotent, audit
                         ▼
                      Neon PostgreSQL (pool partagé par URL)  ── RLS de secours (rôle qadr_tenant, mission 18)
                      Cloudflare R2 (privé, URL signées 5 min)
                      GeniusPay (abonnements, webhook signé + relecture API)
                      Resend (e-mails, non opérationnel en production)
```

Lignes de défense, de l'extérieur vers la donnée :

1. **Réseau** : HTTPS, HSTS en production, Turnstile sur les formulaires publics.
2. **Requête** : contrôle d'origine, limitation des tentatives partagée en base, corps limités.
3. **Identité** : session Better Auth, second facteur facultatif pour le propriétaire de la plateforme.
4. **Autorisation applicative** : le commerce actif vient de la session, jamais du client ; permission vérifiée par route ; toute requête métier filtre par `business_id`.
5. **Base** : clés étrangères composées `(business_id, id)` ; **nouveau** : RLS PostgreSQL appliquée au rôle `qadr_tenant` (section 4).
6. **Traçabilité** : `audit_event` en ajout seul (déclencheur), Sentry pour les 500.

---

## 2. Inventaire des secrets (sans valeurs)

Méthode : lecture de `apps/web/.env.example`, de `src/lib/env.ts` et recherche de motifs (clés `sk_`, `whsec_`, `re_`, URL `postgres://` avec mot de passe, blocs `PRIVATE KEY`) dans l'arbre **et** dans tout l'historique Git (`git rev-list --all | xargs git grep`). Aucune valeur n'a été copiée dans ce rapport.

| Contrôle | Statut | Constat |
| --- | --- | --- |
| Aucun secret dans le code suivi | **VALIDÉ** | Aucune correspondance dans l'arbre ni dans l'historique (motifs ci-dessus). |
| Aucun fichier `.env*` suivi | **VALIDÉ** | `git ls-files` ne renvoie que `.env.example` ; `.gitignore` (racine et `apps/web`) exclut `.env*`. |
| `.env.example` sans valeur réelle | **VALIDÉ** | Valeurs vides ou exemples manifestes. |
| Variables `NEXT_PUBLIC_*` sans secret | **VALIDÉ** | Six variables publiques : `NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Toutes sont publiques par conception (clé de site, DSN d'ingestion, clé projet PostHog). |
| Séparation des secrets par environnement Vercel | **PARTIEL** | Documentée dans `docs/engineering/vercel-environments.md` ; clé GeniusPay live refusée hors `NODE_ENV=production` + `VERCEL_ENV=production` (testé). Le contenu réel des variables Vercel n'a pas été relu (lecture des valeurs volontairement évitée). |
| Rotation des secrets | **BLOQUÉ** | Aucune procédure de rotation exécutée ; à planifier par le propriétaire (section 18). |

Secrets serveur recensés (noms seulement) :

- **Base** : `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.
- **Sessions** : `BETTER_AUTH_SECRET` ; `BETTER_AUTH_URL` n'est pas un secret.
- **Crons** : `CRON_SECRET`, `NOTIFICATIONS_CRON_SECRET`.
- **GeniusPay** : `GENIUSPAY_API_KEY`, `GENIUSPAY_API_SECRET`, `GENIUSPAY_WEBHOOK_SECRET`.
- **R2** : `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- **E-mail et anti-robot** : `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`.
- **Push** : `VAPID_PRIVATE_KEY`.
- **Compte de départ du propriétaire** : `QADR_OWNER_PASSWORD`, ignoré dès qu'un propriétaire existe.
- **Fournisseurs sociaux abandonnés** :
  - `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_SECRET`, `APPLE_PRIVATE_KEY_PATH` ;
  - Google et Apple ne doivent pas être configurés en production.
- **Tests uniquement** :
  - `QADR_TEST_POSTGRES_URL` ;
  - `QADR_TEST_R2_ACCESS_KEY_ID`, `QADR_TEST_R2_SECRET_ACCESS_KEY` ;
  - ces variables ne doivent jamais être définies sur Vercel.

---

## 3. Authentification

| Contrôle | Statut | Preuve / constat |
| --- | --- | --- |
| Hachage des mots de passe | **VALIDÉ** | Better Auth : scrypt avec sel ; aucun mot de passe ni empreinte dans les réponses (`session-cookies.http.test.ts`, test 1). |
| Longueur minimale | **VALIDÉ** | 8 caractères (`minPasswordLength`, `server.ts`) ; refus `PASSWORD_TOO_SHORT` testé sur la réinitialisation (`auth-security.http.test.ts`). |
| Erreur de connexion générique | **VALIDÉ** | Adresse inconnue et mauvais mot de passe : même 401 `INVALID_EMAIL_OR_PASSWORD`, sans cookie (`auth-security.http.test.ts`, 2026-11-12). |
| Énumération à l'inscription | **PARTIEL** | Mission 16 : `422 SIGN_UP_FAILED` identique et durée comparable. Un attaquant peut encore déduire l'existence d'une adresse en tentant une inscription (réponse d'échec vs succès) ; borné par Turnstile + 30 inscriptions/h/IP. |
| Énumération à la réinitialisation | **VALIDÉ** | Réponse identique ; jeton stocké en empreinte ; aucun lien pour un compte à second facteur (mission 16). |
| Limitation distribuée connexion / inscription / réinitialisation | **VALIDÉ** | `rate_limit_bucket` (compteurs atomiques, clés HMAC), par IP **et** par compte (`rate-limit.http.test.ts`). |
| Turnstile obligatoire en production | **VALIDÉ** | Sans jeton, l'inscription de production renvoie 400 sans cookie (`session-cookies.http.test.ts`, test 2) ; clés de test refusées en production. |
| Vérification d'adresse e-mail | **BLOQUÉ** | Non exigée à l'inscription (décision du propriétaire) ; exigée pour accepter une invitation dès que Resend est configuré. Resend n'est pas opérationnel en production (domaine non vérifié) : **aucune vérification n'est simulée**. |
| Propriétaire de la plateforme | **VALIDÉ** | Connexion par nom d'utilisateur, session `platform_session` de 8 h, second facteur facultatif (D-05), limites client + global (`platform-owner-login.http.test.ts`, `platform-owner-account.http.test.ts`). |
| Route Better Auth `/change-password` ouverte au propriétaire | **VALIDÉ** | F-5 : pour un `platform_admin` actif, `/change-password`, `/change-email`, `/delete-user`, `/link-social` et `/unlink-account` répondent 404, quelle que soit la session ; empreinte et sessions inchangées (`password-change.http.test.ts`). |
| Changement de mot de passe d'un commerçant | **VALIDÉ** | F-6 : compte toujours issu de la session ; `revokeOtherSessions` imposé (toutes les sessions remplacées, commerce actif à rechoisir) ; limites 5/15 min par compte et 20/15 min par IP (`password-change.http.test.ts`, 10 tests). |
| Session ordinaire du propriétaire sans second facteur | **VALIDÉ** (2026-11-12) | `/sign-in/email` refuse tout propriétaire actif, avec ou sans second facteur, exactement comme un mauvais mot de passe (401 `INVALID_EMAIL_OR_PASSWORD`, même corps, aucun cookie, mot de passe haché) ; seconde barrière `databaseHooks` : aucune session créée pour lui par une requête HTTP de Better Auth (sociale comprise), aucun fournisseur social rattaché. Console inchangée avec et sans second facteur. Une session ordinaire antérieure n'ouvre pas `/api/platform/*` (401 `platform_reauth_required`, écritures refusées) mais n'est pas fermée : `reset-password` avant lancement si besoin. Preuve : `platform-owner-login.http.test.ts` (19 tests), `password-change.http.test.ts`. |
| Connexion sociale Google / Apple | **NON APPLICABLE** | Abandonnée ; aucun bouton. Le serveur ne l'active que si les identifiants existent : ne pas les définir en production. |

---

## 4. RLS PostgreSQL

### 4.1 Contrainte propre à Neon

Le rôle applicatif de Neon est membre de `neon_superuser`, qui possède **BYPASSRLS** (documentation Neon). Activer RLS sur les tables ne protège donc rien tant que l'application se connecte avec ce rôle. Il faut, pour chaque transaction métier, **changer de rôle** vers un rôle sans BYPASSRLS.

### 4.2 Ce qui est livré (correctif F-3)

- **Migration `drizzle/0025_tenant_row_level_security.sql`** :
  - crée le rôle `qadr_tenant` : `NOLOGIN NOINHERIT NOBYPASSRLS`, accordé au rôle courant avec l'option `SET` ;
  - crée la fonction `qadr_current_business_id()`, qui lit le réglage de transaction `qadr.business_id` ;
  - sur les **44 tables** qui portent `business_id` :
    - `ENABLE ROW LEVEL SECURITY` ;
    - politique `qadr_tenant_isolation` `FOR ALL TO qadr_tenant`, avec `USING` et `WITH CHECK` sur `business_id = qadr_current_business_id()`.
  - Droits accordés à `qadr_tenant` :
    - `SELECT, INSERT, UPDATE, DELETE` sur les tables métier ;
    - **lecture seule** sur les tables de facturation et de promotion : `business_subscription`, `subscription_invoice`, `subscription_payment`, `payment_provider_event`, `promotion_redemption`, `promotion_eligible_business`.
  - **Aucun droit** sur les 19 tables globales : comptes, sessions, plateforme, plans, codes, compteurs, push, notifications globales.
  - **Pas de `FORCE ROW LEVEL SECURITY`** : le rôle propriétaire (migrations, crons, webhooks, console plateforme) garde son comportement actuel. C'est voulu : la RLS est une **seconde barrière** pour le code métier, pas un remplacement des filtres applicatifs.
- **`src/lib/db/tenant-scope.ts`** :
  - `enterTenantScope(tx, businessId)` exécute `SET LOCAL ROLE qadr_tenant` et `set_config('qadr.business_id', id, true)`, puis relit les deux valeurs et lève `TenantScopeError` si elles ne tiennent pas (par exemple hors transaction) ;
  - `withTenantScope(db, businessId, work)` ouvre la transaction et applique `enterTenantScope`.
  - Comme tout est `LOCAL`, rien ne survit à la transaction : c'est sûr avec un pool de connexions.
- **Pilote** : l'export complet des données (`data-export.ts`) lit désormais toutes les tables sous `qadr_tenant`. Une erreur de filtre dans l'export ne peut plus faire sortir une ligne d'un autre commerce.

### 4.3 Statut des contrôles

| Contrôle | Statut | Preuve |
| --- | --- | --- |
| Classement tables métier / globales | **VALIDÉ** | Test catalogue : toute table ayant `business_id` a RLS, la politique et le droit de lecture ; le rôle n'a ni BYPASSRLS, ni LOGIN, ni superutilisateur (`tenant-rls.http.test.ts`, test 1). Toute nouvelle table métier oubliée fait échouer ce test. |
| Lecture croisée refusée par PostgreSQL | **VALIDÉ (local)** | Sous le contexte A, 0 ligne de B sur chaque table ; lectures ciblées des identifiants de B vides : produit, vente, ligne de vente, client, dette initiale, fournisseur, dépense, fichier (tests 2 et 3). |
| Écritures croisées refusées | **VALIDÉ (local)** | `INSERT` au nom de B refusé (« row-level security ») ; `UPDATE`/`DELETE` de lignes de B = 0 ligne ; déplacer une ligne vers B refusé par `WITH CHECK` (test 4). |
| Sans contexte | **VALIDÉ (local)** | Aucune ligne visible, insertion refusée (test 5). |
| Tables globales et facturation | **VALIDÉ (local)** | « permission denied » ; mise à jour d'un abonnement refusée (test 6). |
| Contexte limité à la transaction (pool) | **VALIDÉ (local)** | Le rôle et le réglage disparaissent après validation **et** après erreur (test 7). |
| Utilisation hors transaction ou identifiant invalide | **VALIDÉ** | `TenantScopeError` (test 8). |
| Routes métier sous RLS | **PARTIEL** | Seul l'export complet est branché. Ventes, stock, clients, achats, dépenses, imports, rapports et fichiers restent protégés par les filtres applicatifs et les tests d'isolation HTTP, pas encore par la RLS. Inventaire du 2026-11-12 et plan d'extension : § 4.4. |
| Comportement sur Neon (PostgreSQL 18, rôle `neon_superuser`) | **VALIDÉ (staging)** | Mandat de release, 2026-11-12 : 0025 appliquée sur `qadr_staging` (branche `mission-14-staging`) en une transaction, ligne du migrateur Drizzle comprise ; le rôle de connexion a pu créer `qadr_tenant` et le recevoir avec l'option `SET`. Catalogue conforme (44/44 tables couvertes, 0 droit sur les tables globales) et **24 essais de comportement sur 24 réussis**, données de test annulées : `docs/security/neon-rls-validation.md`. Non prouvé sur Neon : la remise à zéro après `COMMIT` sur une connexion poolée réutilisée (test 7, PGlite seulement). **Branche principale : non appliquée.** |

### 4.4 Inventaire des routes et plan d'extension (2026-11-12)

Inventaire en lecture seule des 96 fichiers `route.ts` et des services de `lib/domain/` :

- **63 tables** : 38 en lecture-écriture pour `qadr_tenant`, 6 en lecture seule, 19 globales.
- **68 méthodes `business/**`**, classées selon ce qu'elles touchent sous la portée :
  - **A (44)** : uniquement des tables du commerce ;
  - **B (11)** : lisent aussi une table globale (`member`, `organization`, `user`, `invitation`, `subscription_plan`) ;
  - **C (5)** : écrivent une table globale (`organization` dans `updateBusinessSettings`, `session` dans `setMemberAccess`) ;
  - **D (8)** : écrivent dans une table en lecture seule pour `qadr_tenant` (facturation GeniusPay).
- Les routes plateforme, compte, cron, webhook, publiques et la boîte d'envoi des notifications sont multi-commerces ou sans commerce : elles **ne passent jamais** sous `withTenantScope`.

Obstacles constatés avant d'étendre la RLS :

1. Presque tous les services ouvrent leur propre `db.transaction`, `runIdempotent` aussi. La portée doit donc être posée par `enterTenantScope` **dans** chaque transaction ; envelopper la route ne suffit pas.
2. Plusieurs services lisent `member` (table globale) dans leurs transactions : `commercial.ts`, `inventory.ts`, `account.ts`, `platform.ts`. Sous la portée, ces lectures échoueraient.
3. Les lignes à `business_id` nul (`audit_event`, `notification`, `notification_outbox` : notifications personnelles et annonces) deviennent invisibles et impossibles à insérer sous la portée.
4. Le compte des utilisations d'un code (`promotion_redemption`, `platform.ts`) doit rester global : sous la RLS, il ne compterait que le commerce courant, et la limite d'usage d'un code deviendrait contournable sans erreur visible.

Plan proposé, sans changement de schéma pour la première étape :

1. Les lectures de classe A sans `member` dans la transaction (listes de clients, ventes, stock, dépenses, rapports), une par une, avec un test d'isolation HTTP inchangé et une mesure de latence sur staging.
2. Droits `SELECT` minimaux, chacun avec sa politique bornée au commerce courant, pour les lectures B : `member` (organisation, utilisateur, rôle), `organization` (identifiant, nom, logo). Jamais `user` ni `promotion_code`.
3. Les classes C et D restent sur le rôle propriétaire.

Corrections faites le même jour (défense en profondeur, sans changement de comportement) : cinq requêtes sur des tables du commerce n'avaient pas de filtre `business_id` alors que l'identifiant venait d'être vérifié dans la même transaction. Elles en ont désormais un : `inventory.ts` (mise à jour d'une ligne d'inventaire, soumission, validation), `imports.ts` (relecture du résumé d'un lot appliqué), `subscription-billing.ts` (relecture d'une tentative de paiement).

Constats ouverts relevés par l'inventaire :

- `GET /api/business/subscription/payments/[attemptId]` relisait le paiement chez GeniusPay et **écrivait** le résultat (4 tables), contrairement à la règle « une route GET n'écrit jamais » (mission 11, phase 6). **VALIDÉ (local), corrigé le 2026-11-12** : le `GET` ne fait plus que lire l'état enregistré (`verification: stored | final`, ni appel à GeniusPay ni écriture) ; la relecture et l'application passent par `POST` sur la même adresse (`refreshSubscriptionPayment` : propriétaire seulement, contrôle d'origine avec la méthode, relecture au plus toutes les 5 s par tentative, `verifyAttempt` idempotent, sans `assertBusinessOperational` pour qu'un commerce expiré puisse reprendre). La page de retour appelle le `POST` avec un nombre borné de relances (environ 2 min 40), puis s'arrête. Preuves (`subscription-billing.http.test.ts`, harnais PGlite, GeniusPay simulé) : trois `GET` successifs sur un paiement que GeniusPay a confirmé laissent `subscription_payment`, `subscription_invoice`, `business_subscription`, `business_profile`, `audit_event` et `payment_provider_event` identiques et n'envoient aucune relecture ; deux `POST` successifs → une seule relecture, un seul abonnement, un seul audit `subscription.payment_activated` ; paiement en attente, montant différent ou échec chez GeniusPay → rien n'est activé ; origine étrangère → 403 `invalid_origin` sans relecture ; A ne lit ni ne relance la tentative de B (réponse identique à un identifiant inconnu, aussi dans `tenant-isolation.http.test.ts`, instantané final de B inchangé). Non vérifié dans un navigateur réel ni en sandbox GeniusPay après ce changement.
- `reportPrintResult` (`printing.ts`) écrit hors transaction et sans `assertBusinessOperational`. Le filtre `business_id` est bien présent. **À CORRIGER**, faible gravité.
- Les routes d'équipe n'appellent pas `assertBusinessOperational`. Un commerce suspendu peut encore gérer son équipe. Ce comportement est à confirmer comme voulu.

---

## 5. Matrice des permissions

Source unique : `apps/web/src/lib/auth/permissions.ts` (vérifiée côté serveur par `hasBusinessPermission`, jamais dans un composant seul).

| Ressource | owner | admin | stock_manager | cashier | accountant | member |
| --- | --- | --- | --- | --- | --- | --- |
| product | tout | tout | tout | lecture | lecture | lecture |
| sale | create, read, refund | idem | read | create, read | read | read |
| customer | create, read, update | idem | read | create, read | read | read |
| payment | read, record, refund | idem | — | record | read | read |
| inventory | read, count, validate, adjust | idem | idem | read | read | read |
| report | read | read | read | — | read | — |
| expense | create, read, update | idem | — | — | create, read, update | — |
| supplier / purchase | tout | tout | tout | — | lecture | lecture |
| cash | tout | tout | — | open, close, read (sa session) | audit, validate | — |
| printer | configure, print | idem | — | print | — | — |
| équipe / invitations | oui | oui | — | — | — | — |
| export complet des données | **propriétaire seul** | — | — | — | — | — |

| Contrôle | Statut | Preuve |
| --- | --- | --- |
| Permissions centralisées | **VALIDÉ** | Un seul fichier, tests de rôles (`permissions` + tests HTTP par route). |
| Membre désactivé refusé | **VALIDÉ** | `assertActiveMembership` à chaque requête (mission 07, tests). |
| Super Admin séparé des commerces | **VALIDÉ** | `platform_admin` sans accès aux données métier ; session `platform_session` distincte ; un seul propriétaire actif. |
| Accès exceptionnel du support aux données d'un client | **NON APPLICABLE** | N'existe pas : aucune fonction d'impersonation. |

---

## 6. Tests multi-tenant

| Contrôle | Statut | Preuve |
| --- | --- | --- |
| Attaques A→B par route `[id]` | **VALIDÉ (local)** | `tenant-isolation.http.test.ts` (21 cas) : réponse identique à un identifiant inconnu, instantané final de B inchangé. |
| Isolation au niveau PostgreSQL | **VALIDÉ (local)** | `tenant-rls.http.test.ts` (8 tests, deux commerces Alpha/Bêta, données créées par les vraies routes : produit, stock d'ouverture, client, fournisseur, session de caisse, vente, dépense, dette initiale, fichier). |
| Export, fichiers, imports, rapports | **VALIDÉ (local)** | Tests d'export complet (liste des tables figée), URL signées après contrôle du commerce, imports et rapports dans la suite d'isolation. |
| Tâches asynchrones (crons, notifications) | **PARTIEL** | Le cron porte le `business_id` de chaque ligne traitée ; pas de test dédié A→B sur la boîte d'envoi des notifications. |
| Mêmes tests sur Neon staging | **BLOQUÉ** | Voir 4.3 ; la mission 14 a déjà exécuté une partie de la suite sur staging, pas les nouveaux tests RLS. |
| Mêmes tests sur un déploiement Preview Vercel | **BLOQUÉ** | Aucun déploiement Preview n'existe. |

---

## 7. API

| Contrôle | Statut | Constat |
| --- | --- | --- |
| Autorisation serveur sur chaque route métier | **VALIDÉ** | Toutes les routes `/api/business/*` passent par `getBusinessContext` (session + appartenance + permission) ; le `business_id` vient de la session. |
| Routes sans session | **VALIDÉ** | Crons : `CRON_SECRET` comparé en temps constant. Webhook GeniusPay : signature. Routes publiques : Turnstile + limites. |
| Validation des entrées | **VALIDÉ** | Zod sur les corps et paramètres, `parseJsonRequest` borné, montants en `bigint`, quantités en `numeric` (jamais en flottant). |
| Idempotence des écritures financières et de stock | **VALIDÉ** | `runIdempotent` + contrainte `idempotency_operation_check` ; liste des écritures bloquées dans `operation-integrity.integration.test.ts`. |
| Routes Organization de Better Auth | **VALIDÉ** | `/api/auth/organization/*` → 404 ; actions d'équipe par `account.ts`. |
| Limitation distribuée sur la vérification publique de campagne | **VALIDÉ** | Correctif F-2 : compteur partagé en base `public.campaign_check.ip` (20 / 10 min), compté après Turnstile ; test « la limite tient sur plusieurs instances » (`public-campaigns.http.test.ts`). |
| Échange de codes promotionnels privés | **PARTIEL** | Limite par commerce ; un utilisateur peut créer jusqu'à 20 commerces et multiplier ses essais. Entropie des codes élevée (génération serveur), le risque reste faible. Ajouter une règle par compte si les campagnes se multiplient. |
| Statut d'abonnement pending / sans abonnement | **BLOQUÉ** | Politique non tranchée : un commerce `pending` n'est pas bloqué (décision du propriétaire). |

---

## 8. Fichiers et stockage R2

| Contrôle | Statut | Constat |
| --- | --- | --- |
| Type réel contrôlé (pas l'extension) | **VALIDÉ** | `detectFileType` (signatures, refus du binaire dans un CSV) ; tests `file-type.test.ts`. |
| Limites de taille et de contenu | **VALIDÉ** | Imports : 2 Mo, lignes, colonnes et caractères bornés, archive XLSX bornée après décompression (bombe ZIP) ; tests `spreadsheet.test.ts`. |
| Macros jamais exécutées | **VALIDÉ** | Lecture XML pure, aucune évaluation. |
| Injection de formules dans les exports | **VALIDÉ** | `csvCell`/`csvDocument` ; aucune formule dans une cellule texte XLSX. |
| Bucket privé, URL signées courtes | **VALIDÉ (code)** | Adaptateur SigV4 maison, `DOWNLOAD_URL_TTL_SECONDS = 300`, clé d'objet aléatoire, contrôle du commerce avant signature. Le caractère privé du bucket de production n'a pas été revérifié sur Cloudflare (aucun accès écrit utilisé) ; **ne jamais le rendre public**. |
| Rétention et purge | **VALIDÉ** | `retention_until` + purge par le cron des abonnements. |
| PDF / photos (OCR) | **NON APPLICABLE** | Désactivé (D-03). |

---

## 9. HTTPS, cookies et sessions

| Contrôle | Statut | Preuve |
| --- | --- | --- |
| Cookie de session HttpOnly, SameSite=Lax, Path=/, sans Domain | **VALIDÉ** | `session-cookies.http.test.ts`, test 1 (correctif F-4). |
| Cookie `__Secure-` + `Secure` en production | **VALIDÉ** | Même fichier, test 2 (Better Auth en mode production, URL HTTPS). |
| `BETTER_AUTH_URL` en HTTPS exigé en production | **VALIDÉ** | Contrôle au démarrage (audit du 2026-11-01). |
| HSTS | **VALIDÉ (code)** | `max-age=63072000; includeSubDomains`, production seulement. Pas de `preload` : à décider une fois le domaine définitif stable. |
| Durée de session | **PARTIEL** | 7 jours, rafraîchie chaque jour ; **aucune expiration d'inactivité**. Vérifié par le test 3. Pour un poste de caisse partagé, une durée plus courte serait préférable (décision produit). |
| Révocation à la déconnexion | **VALIDÉ** | Test 3 : la ligne `session` est supprimée, le cookie rejoué n'ouvre plus rien. |
| Invalidation après changement de mot de passe | **PARTIEL** | Propriétaire de la plateforme : ses autres sessions sont supprimées (`changeOwnerPassword`). Comptes des commerces : réinitialisation par e-mail → Better Auth révoque les sessions ; le changement depuis le compte dépend de l'option `revokeOtherSessions` côté client, non imposée côté serveur. À imposer. |

---

## 10. CORS et CSRF

| Contrôle | Statut | Constat |
| --- | --- | --- |
| CORS | **VALIDÉ** | Aucun en-tête `Access-Control-Allow-Origin` émis par l'application : les navigateurs refusent les lectures depuis une autre origine. |
| CSRF sur les routes métier | **VALIDÉ** | `assertTrustedOrigin` (403 `invalid_origin`) dans les trois contextes et les routes `/api/account/*` ; SameSite=Lax ; tests mission 16. |
| CSRF Better Auth | **VALIDÉ** | Contrôle d'origine natif conservé en test (`disableOriginCheck: false`). |

---

## 11. Webhooks (GeniusPay)

| Contrôle | Statut | Constat |
| --- | --- | --- |
| Signature sur le corps brut | **VALIDÉ** | HMAC-SHA256 de `timestamp.corps`, comparaison en temps constant (`geniuspay.ts`). |
| Rejeu | **VALIDÉ** | Horodatage obligatoire et fenêtre bornée ; événement unique par `(provider, event_id)` (`onConflictDoNothing`). |
| Taille du corps | **VALIDÉ** | 64 Kio max (413). |
| Montant, devise, référence | **VALIDÉ** | Le webhook ne suffit jamais : relecture `GET /payments/{reference}`, refus `amount_mismatch`, `currency_mismatch`, `reference_mismatch`. |
| Activation sur simple redirection | **VALIDÉ** | Interdite : seule la relecture serveur active un abonnement. |
| Essai de bout en bout en sandbox réel | **PARTIEL** | Scénarios testés en local (mission 16, lot D) ; aucun paiement réel effectué ni à effectuer. |

---

## 12. Dépendances

Commande : `npm audit --omit=dev` puis `npm audit` depuis `apps/web` (2026-11-12).

| Contrôle | Statut | Constat |
| --- | --- | --- |
| `@vercel/functions` | **VALIDÉ** | Correctif F-1 : 3.10.1 → 3.11.1 (entraîne `@vercel/oidc` 4.0.8). Changement ciblé, lockfile mis à jour volontairement. |
| 4 alertes élevées en production via `@opennextjs/cloudflare` | **VALIDÉ** | F-7 (2026-11-12) : paquet déplacé en dépendance de développement (même version 1.20.15) ; il n'est importé que par `open-next.config.ts` (préparation Workers inutilisée, D-01) et n'entre dans aucune fonction Vercel. `npm audit --omit=dev` : **0 élevée**, 9 modérées (avant : 4 élevées, 8 modérées). Les alertes restent visibles dans `npm audit` complet ; le retrait définitif des scripts `cf:*` est une décision du propriétaire. |
| `@sentry/nextjs` (modérée) | **À CORRIGER** | Correctif seulement dans une version majeure : mise à niveau à planifier et tester, pas de montée aveugle. |
| Outils de développement (modérées) | **PARTIEL** | Documentées (`docs/authentication.md` § 10) ; non embarquées en production. |

---

## 13. Journaux et erreurs

| Contrôle | Statut | Constat |
| --- | --- | --- |
| Pas de pile d'appels ni d'erreur SQL renvoyée au client | **VALIDÉ** | `errorResponse` : 500 générique, détail vers Sentry seulement. |
| Données sensibles hors de Sentry / PostHog | **PARTIEL** | PostHog après consentement, catalogue d'événements fermé ; Sentry sans `sendDefaultPii`. Les corps de requête ne sont pas envoyés, mais les messages d'erreur capturés n'ont pas fait l'objet d'une revue exhaustive. |
| Journaux structurés sans secret | **VALIDÉ** | Événements JSON courts (`turnstile.rejected`, etc.) ; adresses IP et e-mails des compteurs stockés en HMAC. |
| Audit des actions financières et de stock | **VALIDÉ** | `audit_event` en ajout seul (déclencheur, migration 0010). |

---

## 14. Sauvegardes et restauration

État relevé en lecture seule sur Neon le 2026-11-12, projet `qadr-data-base` :

- PostgreSQL 18 ;
- historique de restauration de 6 h (`history_retention_seconds` = 21600) ;
- branches `main` (production Vercel, suppression interdite par Vercel) et `mission-14-staging` ;
- **aucune sauvegarde instantanée** (snapshot) ;
- **aucun calendrier de sauvegarde automatique**.

| Contrôle | Statut | Constat |
| --- | --- | --- |
| RPO / RTO définis | **BLOQUÉ** | Proposition : RPO 24 h, RTO 4 h au lancement. Le propriétaire doit les valider. Avec l'offre actuelle, le RPO réel au-delà de 6 h n'est pas couvert. |
| Sauvegardes planifiées | **BLOQUÉ** | Aucune ; exige une offre Neon payante (snapshots planifiés) ou un `pg_dump` externe chiffré, ce qui est une dépense ou un stockage à décider. |
| Test de restauration | **PARTIEL** | 2026-11-12 : copie de la branche de staging vers une branche isolée (`restore-test-2026-11-12`) ; journal des migrations, 63 tables, 44 politiques, rôles, déclencheurs et empreinte de structure identiques à l'original (`docs/engineering/backup-restore.md` § 6.6). **Non testés** : retour à un instant passé (PITR), restauration d'un instantané, `pg_dump`/`pg_restore` hors Neon (aucun outil sur le poste). La reprise après perte du projet reste **non validée**. |
| Instantané avant migration de production | **BLOQUÉ** | L'offre Free n'en permet qu'un, et seulement sur une branche racine (`main`) ; il est réservé au point « avant première migration » (runbook § 5). |

---

## 15. Vulnérabilités relevées

| # | Gravité estimée | Description | Statut |
| --- | --- | --- | --- |
| V-1 | Élevée (défense en profondeur) | Neon : rôle applicatif BYPASSRLS ; sans changement de rôle, une seule erreur de filtre suffirait à une fuite entre commerces. | Socle livré (F-3) et **validé sur Neon staging** (24/24) ; **PARTIEL** : export seul sous RLS (§ 4.4) |
| V-2 | Moyenne | Vérification publique de campagne limitée seulement en mémoire (contournable par plusieurs instances). | **Corrigée** (F-2) |
| V-3 | Moyenne | Aucune sauvegarde au-delà de 6 h ; restauration testée seulement par copie de branche. | **BLOQUÉ** (offre Neon ou `pg_dump` : propriétaire) |
| V-4 | Moyenne | 4 alertes élevées via `@opennextjs/cloudflare` inutilisé. | **Corrigée** (F-7, hors production) |
| V-5 | Faible à moyenne | `/api/auth/change-password` ouverte au propriétaire hors audit et hors limite de la console. | **Corrigée** (F-5) |
| V-6 | Faible à moyenne | Changement de mot de passe d'un commerçant : révocation des autres sessions non imposée côté serveur. | **Corrigée** (F-6) |
| V-7 | Faible | CSP minimale (pas de `script-src`). | **PARTIEL** (F-8 : politique complète en Report-Only ; jamais observée dans un navigateur réel) |
| V-8 | Faible | Session de 7 jours sans expiration d'inactivité. | Décision produit |
| V-9 | Faible | Énumération d'adresse résiduelle à l'inscription. | Accepté, borné par Turnstile + limites |
| V-10 | Faible | Réinitialisation : limite par compte (3/h) utilisable pour empêcher un tiers de recevoir son lien pendant 1 h au plus. | Accepté |
| V-11 | Inconnue | Adresse client réelle derrière Cloudflare + Vercel non vérifiée : les limites par IP pourraient viser le nœud Cloudflare. | **BLOQUÉ** (nécessite un déploiement) |

---

## 16. Correctifs appliqués dans cette mission

| Réf. | Fichiers | Vérification |
| --- | --- | --- |
| **F-1** | `apps/web/package.json`, `package-lock.json` : `@vercel/functions` 3.11.1 | Suite complète, typecheck, build (section « Vérifications » du compte rendu). |
| **F-2** | `src/app/api/public/campaigns/check/route.ts`, `src/lib/security/rate-limit.ts` (`publicCampaignCheckIp`), `src/test/public-campaigns.http.test.ts` | 12 tests passent, dont le test multi-instances. |
| **F-3** | `drizzle/0025_tenant_row_level_security.sql` (+ `drizzle/meta`), `src/lib/db/tenant-scope.ts`, `src/lib/domain/data-export.ts`, `src/test/tenant-rls.http.test.ts`, `src/lib/db/pglite-migrations.integration.test.ts` (26 migrations) | 8 tests RLS + tests d'export et de migrations passent ; `drizzle-kit check` OK, `drizzle-kit generate` : « No schema changes ». |
| **F-4** | `src/test/session-cookies.http.test.ts` | 3 tests passent (cookies dev/prod, durée, révocation). |
| **F-5** | `src/lib/auth/server.ts` (`ownerClosedCredentialPaths`, hook `before`) | `password-change.http.test.ts` |
| **F-6** | `src/lib/auth/server.ts` (`revokeOtherSessions` imposé, `authRateChecks` avec le compte de la session), `src/lib/security/rate-limit.ts` (`passwordChangeIp`, `passwordChangeAccount`) | `password-change.http.test.ts` (10 tests) |
| **F-7** | `apps/web/package.json`, `package-lock.json` : `@opennextjs/cloudflare` en dépendance de développement | `npm audit --omit=dev` : 0 élevée |
| **F-8** | `src/lib/security-headers.ts` (`Content-Security-Policy-Report-Only`), `src/lib/security-headers.test.ts` | 6 tests ; CSP appliquée inchangée |
| **F-9** | `src/lib/domain/inventory.ts`, `imports.ts`, `subscription-billing.ts` : filtre `business_id` ajouté à 5 requêtes | suite complète (rapport de release) |

---

## 17. Risques résiduels

1. La RLS ne couvre que l'export tant que les autres routes ne sont pas migrées vers `withTenantScope`. La protection principale reste le filtrage applicatif, testé par route.
2. La migration 0025 est prouvée sur Neon staging (création du rôle, option `SET`, 24 essais) mais pas sur la branche principale, qui n'a reçu aucune migration.
3. Sans sauvegarde planifiée ni restauration testée, une erreur humaine découverte après 6 h est irrécupérable.
4. Resend et Turnstile de production ne sont ni créés ni vérifiés. Sans e-mails :
   - pas de réinitialisation de mot de passe ;
   - pas de vérification d'adresse.
5. Les limites par IP n'ont pas été vérifiées derrière le proxy réel. Elles peuvent être trop strictes (CGNAT) ou inopérantes (adresse du nœud).
6. Aucun test d'intrusion externe n'a été mené. Les contrôles ci-dessus sont des tests internes.

---

## 18. Actions du propriétaire

### 18.1 Bloquants de lancement

Ces points empêchent d'annoncer une mise en production sûre.

1. ~~Appliquer la migration 0025 sur `qadr_staging`~~ : fait le 2026-11-12 (mandat de release, `neon-rls-validation.md`). Reste : lancer `tenant-rls.http.test.ts` sur staging avec `QADR_TEST_POSTGRES_URL` (chaîne directe saisie par le propriétaire).
2. **Décider la sauvegarde** :
   - fixer le RPO et le RTO ;
   - choisir entre l'offre Neon avec snapshots planifiés et un `pg_dump` externe (coût à valider) ;
   - **autoriser un test de restauration** sur une branche isolée.
3. **Resend** : vérifier le domaine d'envoi et créer la clé de production. Sans cela, la réinitialisation de mot de passe ne fonctionne pas.
4. **Turnstile** : créer les clés de production pour le domaine définitif.
5. **Déploiement Preview Vercel** : l'autoriser, pour vérifier les points suivants dans les conditions réelles :
   - l'adresse IP client (V-11) ;
   - les en-têtes ;
   - les cookies ;
   - les crons.

### 18.2 Avant ou juste après le lancement

6. Retirer définitivement `@opennextjs/cloudflare`, `wrangler` et les scripts `cf:*`, si l'abandon de Workers est confirmé (V-4 est déjà neutralisée en production par F-7).
7. ~~V-5 et V-6~~ : corrigées (F-5, F-6). Décider si `/sign-in/email` doit aussi refuser le propriétaire sans second facteur.
8. Observer la CSP **Report-Only** (F-8) sur le Preview dans les outils de développement du navigateur, puis l'appliquer (V-7).
9. Trancher :
   - la durée de session des postes de caisse partagés (V-8) ;
   - la politique pour un abonnement `pending`.
10. Planifier la rotation des secrets :
    - `BETTER_AUTH_SECRET` ;
    - `CRON_SECRET` ;
    - les clés R2 ;
    - le secret du webhook GeniusPay.
11. Planifier la mise à niveau majeure de `@sentry/nextjs`, avec des tests.
