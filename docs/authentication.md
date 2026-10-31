# Authentification, commerces et équipe (missions 07, 07.1 et 07.2)

Ce document décrit l'état réel livré dans `apps/web` le 2026-10-31 (mission 07.1 : Resend et Turnstile ; mission 07.2 : durcissement et audit des dépendances). Tout repose sur **Better Auth 1.7.7** et son plugin Organization : aucun système d'authentification parallèle n'a été écrit. Une organisation Better Auth correspond à un commerce (`business_id`).

## 1. Parcours opérationnels

| Parcours | Écran | Mécanisme |
| --- | --- | --- |
| Inscription | `/register` | `authClient.signUp.email` (nom, e-mail, mot de passe 8 à 128 caractères) avec le jeton Turnstile, connexion automatique, puis `/onboarding` |
| Connexion | `/login` | `authClient.signIn.email` avec le jeton Turnstile, puis aiguillage `routeAfterSignIn` : invitation demandée → commerce actif → seul commerce utilisable → choix → création |
| Déconnexion | bouton dans l'en-tête du commerce, lien sur `/select-business` | `signOutAndResetAnalytics` (Better Auth + remise à zéro PostHog) |
| Création de commerce | `/onboarding` | `POST /api/account/businesses` → `auth.api.createOrganization` ; les hooks créent le profil (activité, téléphone, adresse) et les réglages de reçu ; le créateur devient `owner` et le commerce devient actif |
| Choix / changement de commerce | `/select-business`, pastille du commerce dans l'en-tête | `POST /api/account/active-business` : appartenance et accès vérifiés côté serveur avant `setActiveOrganization` |
| Équipe | `/business/team` (menu « Plus ») | liste, invitation, rôle, désactivation, matrice des permissions |
| Invitation | `/invitations/{id}` | lecture réservée au compte dont l'e-mail correspond ; acceptation via `auth.api.acceptInvitation`, puis le commerce devient actif |
| Mot de passe oublié | `/forgot-password`, `/reset-password` | `requestPasswordReset` (jeton Turnstile) puis e-mail Resend ; `resetPassword` avec le jeton à usage unique. **Indisponible sans Resend configuré** (l'écran le dit) |

Le logo choisi à la création est réduit à 256 px dans le navigateur, envoyé en data URL (200 Ko au plus) et vérifié côté serveur par ses octets de signature (PNG, JPEG, WebP). Il est stocké dans `organization.logo` et utilisé par les reçus existants.

## 2. Configuration Better Auth (`src/lib/auth/server.ts`)

`createQadrAuth({ db, secret, baseURL, isProduction, emailTransport?, emailDelivery?, backgroundTask?, turnstile? })` construit l'instance ; `getAuth()` la crée une seule fois par processus, avec le transport Resend et `runAfterResponse` comme exécuteur des envois.

| Réglage | Valeur | Raison |
| --- | --- | --- |
| Durée de session | 7 jours, renouvelée au plus une fois par jour | appareils de boutique utilisés tous les jours ; une session inactive 7 jours expire |
| Mot de passe | 8 à 128 caractères, haché par Better Auth | pas de règle de complexité qui bloquerait des utilisateurs peu habitués |
| Réinitialisation | lien valable 1 h, usage unique, toutes les sessions révoquées après changement | |
| Invitations | 7 jours ; réinviter la même adresse renouvelle l'invitation existante et renvoie un e-mail | délai réaliste pour un employé sans e-mail consulté chaque jour |
| Vérification d'adresse | envoi possible (lien valable 24 h), **non imposée** | voir § 5.4 |
| Commerces par compte | 20 au plus | limite anti-abus |
| Turnstile | sur `/sign-up/email`, `/sign-in/email`, `/request-password-reset` | voir § 6 |

En mode aperçu (`npm run preview`), Better Auth tourne réellement sur la base PGlite en mémoire avec un secret de développement. Sans session, l'aperçu garde l'identité de démonstration des missions précédentes ; avec une session, ce sont les vraies règles qui s'appliquent.

## 3. Rôles et permissions

Les rôles existants sont conservés sans ajout : `owner`, `admin`, `member` (lecture seule), `cashier`, `stock_manager`, `accountant`. Les permissions restent centralisées dans `src/lib/auth/permissions.ts` ; la matrice affichée sur la page Équipe en est dérivée (`roleMatrix()`), elle ne la duplique pas.

Règles appliquées côté serveur (`src/lib/domain/account.ts`) :
- inviter, changer un rôle ou désactiver un accès exige la permission `member`/`invitation` du rôle courant ;
- seul un `owner` peut inviter ou nommer un autre `owner`, ou modifier un `owner` ;
- personne ne modifie son propre rôle ni son propre accès ;
- le dernier `owner` actif ne peut être ni rétrogradé ni désactivé ;
- inviter une personne déjà membre renvoie 409 ;
- chaque action écrit un `audit_event` (`team.invitation_created`, `team.invitation_canceled`, `team.role_changed`, `team.access_disabled`, `team.access_enabled`).

### Désactivation sans suppression

Un membre n'est jamais supprimé : ses ventes et mouvements y font référence. La table `business_member_access` (migration `0009_member_access.sql`, clé `(business_id, user_id)` liée à `member`) enregistre `disabled_at` et l'auteur. `assertActiveMembership` est appelé par `getBusinessContext` à **chaque** requête métier : un membre désactivé reçoit 403 immédiatement, et sa session perd son commerce actif. Le réactiver efface `disabled_at`.

## 4. Contrôles multi-tenant

- Le commerce actif vient de la session Better Auth (`activeOrganizationId`), jamais du corps ni de l'URL.
- `setActiveBusiness` vérifie l'appartenance et l'accès avant de changer le commerce actif ; un `businessId` étranger renvoie 403.
- Les routes d'équipe filtrent invitations et membres par le commerce de la session : annuler l'invitation ou modifier le membre d'un autre commerce renvoie 404.
- `src/proxy.ts` redirige sans cookie de session vers `/login?next=…` (`/business`, `/platform`, `/onboarding`, `/select-business`, `/invitations`). Ce n'est qu'un confort : la vraie vérification reste dans chaque route serveur.
- `next` n'est suivi que s'il désigne un chemin interne (`src/lib/client/redirect.ts`, testé contre `//domaine`, `/\domaine`, `javascript:` et les caractères de contrôle).

## 5. E-mails transactionnels (Resend)

### 5.1 Architecture

- `src/lib/auth/email.ts` est le seul point d'entrée : types, transport Resend (`createResendTransport`), envoi avec réessais (`deliverEmail`) et `resolveEmailTransport()`. Le SDK officiel `resend` (6.33.0, version figée publiée le 2026-10-14) n'est importé que là, côté serveur. Les bundles navigateur ne contiennent ni le SDK, ni le nom des variables secrètes (vérifié sur `.next/static` après `npm run build`).
- `src/lib/auth/email-templates.ts` et `email-messages.ts` : modèles invitation, réinitialisation et vérification, en français, anglais et arabe, HTML + texte brut.
- `src/lib/auth/server.ts` branche `sendInvitationEmail`, `sendResetPassword` et `emailVerification.sendVerificationEmail` de Better Auth sur ces modèles.
- Sans `RESEND_API_KEY` + `RESEND_FROM_EMAIL`, `resolveEmailTransport()` renvoie `null` : rien n'est simulé, la récupération de mot de passe est déclarée indisponible et la page Équipe invite à copier le lien.

### 5.2 Fiabilité des envois

| Point | Comportement |
| --- | --- |
| Travail après réponse | `advanced.backgroundTasks.handler` de Better Auth reçoit `runAfterResponse`, qui confie la promesse à `after()` de Next.js (prolongation de l'invocation, `waitUntil` sur Vercel). La réinitialisation répond donc sans attendre Resend : même délai qu'un compte existe ou non. Hors requête (script), la promesse continue sans garantie de durée. |
| Invitation | La personne qui invite est authentifiée : le service attend l'issue (`emailRequestScope`, AsyncLocalStorage) et renvoie `emailStatus` = `sent` (accepté par Resend, pas forcément lu), `failed` ou `not_configured`. L'écran ne dit jamais « remis au destinataire ». Le lien à copier reste toujours affiché. |
| Réessais | 3 essais au plus pour `rate_limit_exceeded`, erreurs 5xx, `concurrent_idempotent_requests`, panne réseau ou délai de 10 s ; attente 0,8 s puis 2,4 s, ou la valeur `retry-after` (5 s au plus). Erreurs définitives (validation, clé invalide, quota) : pas de réessai. |
| Idempotence | Clé Resend stable pour une même tentative (réessais compris) : `invitation/{id}/{échéance}` ; `password-reset/` ou `email-verification/` + empreinte SHA-256 du jeton (le jeton lui-même n'est jamais transmis comme clé). Un nouvel envoi volontaire (nouvelle demande, invitation renouvelée) produit une nouvelle clé. Resend ne conserve ces clés que 24 h : ce n'est pas un historique. |
| Journal | Une ligne JSON `email.delivery` : type, issue, nombre d'essais, code d'erreur. Jamais de destinataire, lien, jeton, clé d'idempotence ni clé API (tests à l'appui). |

### 5.3 Langues et mise en page

- Réinitialisation et vérification : langue de l'interface du demandeur (cookie `qadr-locale`), français par défaut.
- Invitation : le destinataire n'a pas encore de préférence ; la personne qui invite choisit la langue de l'e-mail (français par défaut).
- HTML en tableaux et styles en ligne, polices système, aucune image ni ressource externe ; bouton violet très visible, en-tête bleu nuit, fond clair ; adaptation mobile. L'arabe a `lang="ar"` et `dir="rtl"` au niveau du document ; noms de commerces et de personnes isolés (`<bdi>`), non traduits ; lien affiché de gauche à droite.
- Les noms saisis sont échappés (HTML) et nettoyés des caractères de contrôle (pas d'injection d'en-tête dans l'objet). Aucune donnée commerciale (montant, stock, client) dans ces e-mails.

### 5.4 Adresse vérifiée exigée pour accepter une invitation (mission 07.2)

`requireEmailVerificationOnInvitation` (plugin Organization de Better Auth 1.7.7) est activé par `invitationRequiresVerifiedEmail(isProduction, hasEmailTransport)` : **toujours en production**, et partout où Resend est configuré. Better Auth vérifie alors, à l'acceptation comme au refus d'une invitation, dans cet ordre : invitation en attente et non expirée, adresse du compte égale à l'adresse invitée, puis adresse vérifiée.

- **Effet recherché** : un lien transféré ne suffit plus. Un tiers qui crée un compte avec l'adresse invitée ne peut pas la confirmer, donc ne peut pas rejoindre le commerce.
- **Ce qui ne change pas** : l'inscription n'exige pas d'adresse vérifiée (`requireEmailVerification: false`), aucun e-mail n'est envoyé à l'inscription, les six rôles et les autres parcours sont inchangés.
- **Écran** : `/invitations/{id}` explique l'étape, propose « Recevoir l'e-mail de confirmation » (lien valable 24 h qui ramène sur l'invitation) puis « J'ai confirmé mon adresse ». Sans Resend en production, l'écran dit que la confirmation est indisponible.
- **Envoi de la vérification** : réservé au titulaire connecté. Sans session, `/api/auth/send-verification-email` est refusé (401), sinon n'importe qui pourrait déclencher des envois vers une adresse non vérifiée.
- **Développement sans Resend** : la vérification serait impossible, l'exigence est donc levée (`NODE_ENV` ≠ production et aucun transport).
- **Limite connue** : si un tiers s'inscrit le premier avec l'adresse invitée, la vraie personne ne peut pas créer un second compte ; elle récupère le compte par « Mot de passe oublié » (le lien arrive dans sa boîte), ce qui ferme les sessions du tiers.

### 5.5 Activer Resend (aucune ressource payante créée)

1. Créer ou utiliser le compte Resend de Qadr Agency (l'offre gratuite suffit pour les essais ; vérifier ses quotas et conditions avant la production).
2. Générer une clé API à droits « Sending access », limitée au domaine d'envoi.
3. Ajouter le domaine d'envoi (par exemple un sous-domaine dédié aux e-mails).
4. Créer chez le registrar les enregistrements DNS demandés par Resend (SPF/MX du sous-domaine, DKIM, DMARC recommandé).
5. Attendre que Resend affiche le domaine « Verified ».
6. Choisir l'adresse d'expédition sur ce domaine, par exemple `QADR OPS <no-reply@…>`, et éventuellement une adresse de réponse.
7. Renseigner `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (et `RESEND_REPLY_TO`) dans les variables d'environnement de l'hébergeur ou dans `apps/web/.env.local` (non versionné). **Jamais dans le code ni dans Git.** Les liens utilisent `BETTER_AUTH_URL`.
8. Test d'envoi : `/forgot-password` vers une adresse de l'équipe, puis une invitation depuis `/business/team` ; vérifier la réception, l'affichage (Gmail, Outlook, mobile, arabe) et le journal `email.delivery`.

Tant que ces étapes ne sont pas faites et vérifiées, **aucun e-mail réel n'a été envoyé** : les tests utilisent un faux transport et un faux client Resend.

## 6. Cloudflare Turnstile

### 6.1 Navigateur

`src/components/auth/turnstile-widget.tsx` charge le script officiel une seule fois, en rendu explicite (`render=explicit`), avec l'action du formulaire (`login`, `register`, `password-reset`), la langue de l'interface (fr/en/ar) et le thème clair. Il renvoie le jeton au formulaire, le relance après expiration, délai ou envoi (un jeton ne sert qu'une fois), affiche le chargement et une erreur avec « Réessayer ». Le bouton d'envoi reste inactif sans jeton. Le jeton part dans l'en-tête `x-turnstile-token` ; il n'est jamais stocké (ni localStorage, ni IndexedDB). Sans `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, le widget ne s'affiche pas (développement local uniquement).

### 6.2 Serveur

Le hook `before` de Better Auth appelle `verifyTurnstile` (`src/lib/auth/turnstile.ts`) pour les trois routes protégées. Siteverify est toujours appelé ; sont refusés : jeton absent ou trop long, jeton invalide, expiré ou déjà utilisé (`timeout-or-duplicate`), nom d'hôte différent de celui de `BETTER_AUTH_URL`, action différente de la route, panne de Cloudflare (un second essai avec la même `idempotency_key`, délai de 8 s), clé manquante en production, **clés de test Cloudflare en production**. Le refus renvoie 400 `TURNSTILE_FAILED` ; le journal ne contient que l'action et la raison.

`/reset-password` (choix du nouveau mot de passe) n'est pas protégé par Turnstile : il exige déjà un jeton Better Auth à usage unique, valable 1 h, envoyé par e-mail.

### 6.3 Clés

- Local et tests : clés de test officielles (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`), qui renvoient le jeton factice `XXXX.DUMMY.TOKEN.XXXX`. La configuration d'aperçu `qadr-web-preview-turnstile-test` (`.claude/launch.json`) les utilise.
- Production : widget créé dans le tableau de bord Cloudflare, domaine de `BETTER_AUTH_URL` seul autorisé (pas de `localhost`). `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (publique) et `TURNSTILE_SECRET_KEY` (serveur uniquement) vont ensemble, sinon l'application refuse de démarrer.
- Une préproduction sur un autre nom d'hôte doit avoir son propre `BETTER_AUTH_URL` (le contrôle du nom d'hôte en dépend).

Mise en service de Turnstile (aucun compte connecté par l'agent, aucune clé à coller dans le terminal ni dans le dépôt) :

1. Dans le tableau de bord Cloudflare du propriétaire, section Turnstile, créer un widget en mode « Managed ».
2. Domaines autorisés : uniquement le nom d'hôte de `BETTER_AUTH_URL` (et celui de la préproduction dans un widget séparé). Pas de `localhost`.
3. Copier la clé publique dans `NEXT_PUBLIC_TURNSTILE_SITE_KEY` et la clé secrète dans `TURNSTILE_SECRET_KEY`, directement dans les variables d'environnement de l'hébergeur (environnement Production). Ne jamais réutiliser les clés de test : elles sont refusées en production.
4. Redéployer (la clé publique est intégrée au moment du build).
5. Vérifier : connexion, inscription et « Mot de passe oublié » avec un vrai navigateur ; une requête sans jeton doit répondre 400 `TURNSTILE_FAILED` ; le journal `turnstile.rejected` ne contient que l'action et la raison ; l'analytique Turnstile du tableau de bord montre les validations.

## 7. Prérequis avant toute mise en production

| Élément | Statut |
| --- | --- |
| `DATABASE_URL` (Neon) | non contacté ; migrations 0000–0009 jamais appliquées à Neon |
| `BETTER_AUTH_SECRET` (32 caractères au moins) | `getAuth()` refuse de démarrer sans lui |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_AUTH_URL` | URL publique exacte (cookies, origine de confiance, liens des e-mails, contrôle Turnstile) |
| Resend | code prêt et testé avec un faux client ; **domaine, clé et envoi réel non vérifiés** (§ 5.5) |
| Turnstile | widget et validation serveur en place, testés avec les clés de test et un faux Siteverify ; **clés de production non créées ni vérifiées** |
| Vérification d'adresse pour les invitations | exigée en production (§ 5.4) |
| Limitation de débit | Better Auth en production : 3 requêtes / 10 s sur connexion et inscription, 3 / 60 s sur `request-password-reset` et `send-verification-email`, par adresse IP, **en mémoire de chaque instance** : insuffisant avec plusieurs instances serverless. Proposition : `rateLimit.storage: "database"` (nouvelle table, migration locale à valider) ou stockage secondaire. |
| Dépendances | voir § 10 : plus aucune vulnérabilité critique ni haute ; 20 modérées documentées (outils de développement et de build) |

**L'authentification n'est pas déclarée prête pour la production** tant que le domaine Resend et les clés Turnstile réelles n'ont pas été vérifiés de bout en bout.

## 7 bis. Tests

- Mission 07.2, `auth-delivery.integration.test.ts` : invitation envoyée à Moussa, refusée tant que son adresse n'est pas vérifiée puis acceptée (rôle caissier) ; autre adresse, même vérifiée, refusée ; lien transféré à un tiers qui s'inscrit avec l'adresse invitée refusé, aucun membre créé ; invitation expirée, révoquée et déjà acceptée refusées même avec une adresse vérifiée ; envoi de vérification sans session refusé (401).

- `src/lib/domain/account.integration.test.ts` (PGlite) : inscription et connexion (aucun mot de passe en clair en base), mot de passe trop court, déconnexion, session expirée, création de commerce, activité invalide et faux logo refusés, deux commerces et refus du changement vers un commerce étranger, invitation puis acceptation (refusée à un autre compte), invitation expirée et annulée, règles de rôles, désactivation/réactivation, réinitialisation sans énumération avec révocation des sessions et jeton à usage unique.
- `src/lib/auth/auth-delivery.integration.test.ts` (Better Auth réel sur PGlite, appels par son gestionnaire HTTP, configuration de production, faux Siteverify, faux transport) : inscription sans jeton refusée et aucun compte créé, jeton invalide, jeton déjà utilisé, jeton d'une autre action, réinitialisation protégée ; réinitialisation envoyée **après** la réponse, en arabe, avec le lien de Better Auth ; réponse identique pour une adresse inconnue ; invitation dans la langue choisie, au bon destinataire, avec le lien d'acceptation ; renvoi avec nouvelle clé ; échec du fournisseur signalé (`failed`) sans perdre l'invitation ; vérification sur demande ; aucun jeton, lien, destinataire ni secret dans les journaux.
- `src/lib/auth/email.test.ts`, `email-templates.test.ts`, `turnstile.test.ts` : réessais et idempotence, classement des erreurs Resend, délai, configuration incomplète, modèles fr/en/ar et RTL, échappement, absence de ressource externe, parité des langues, et tous les cas Siteverify (valide, invalide, expiré/déjà utilisé, domaine ou action différents, clé absente, panne, clés de test locales, clés de test refusées en production).
- `src/lib/client/redirect.test.ts` : redirections externes refusées.

**À valider sur un vrai PostgreSQL** : Pool `neon-serverless` (transactions de `setMemberAccess`), deux acceptations simultanées, latence des vérifications d'appartenance, cookies `Secure` derrière le proxy HTTPS. **À valider en conditions réelles** : délivrabilité Resend (spam, rendu Outlook/Gmail, RTL), `after()` sur l'hébergeur retenu, widget Turnstile avec une vraie clé.

## 8. Appareils partagés et hors ligne (conception seulement, rien n'est implémenté)

Aucun fonctionnement hors ligne n'existe. Principes retenus pour plus tard :
- **appareil autorisé** : un propriétaire enregistre un appareil de boutique (identifiant d'appareil, commerce, date d'expiration, révocable depuis la page Équipe) ;
- **utilisateur sur l'appareil** : chaque employé déverrouille avec un code court propre à l'appareil, vérifié contre une empreinte dérivée côté serveur ; **jamais de mot de passe dans IndexedDB ni ailleurs dans le navigateur** ;
- **session hors ligne ≠ toutes les opérations** : seules des ventes en espèces mises en file, idempotentes, seraient permises ; ni changement de prix, ni gestion d'équipe, ni ajustement de stock ;
- **verrouillage** après inactivité et à chaque changement d'employé ;
- la file locale est chiffrée, rattachée au commerce et à l'utilisateur, et rejetée si l'accès a été désactivé entre-temps.

## 9. Captures

`docs/captures/mission-07-1/` : widget Turnstile (clés de test) sur l'inscription (fr, ordinateur) et la connexion (ar, téléphone), e-mails d'invitation (fr, ar), de réinitialisation (en) et de vérification (ar).

`docs/captures/mission-07/` : connexion, inscription, mot de passe oublié et réinitialisation, création de commerce, choix du commerce, invitation et équipe, sur ordinateur (1440 px) et téléphone (390 px), en français, anglais et arabe (RTL). Elles proviennent de l'aperçu local (PGlite en mémoire) avec des comptes de test `@demo.test`.

## 10. Audit des dépendances (mission 07.2, 2026-10-31)

`npm audit` avant : 25 vulnérabilités (2 critiques, 1 haute, 22 modérées). Après : **20 modérées, 0 haute, 0 critique**. Mises à jour appliquées, toutes dans la même version majeure, versions figées :

| Paquet | Type | Avant | Après | Avis corrigés |
| --- | --- | --- | --- | --- |
| `@sentry/nextjs` | direct | 10.73.0 | 10.78.0 (2026-10-28) | critique GHSA-mchm-gjx6-7h55 (contournement du middleware via la route tunnel, < 10.75.2). Non exploitable ici : `withSentryConfig`/`tunnelRoute` ne sont pas utilisés, mais la version est corrigée. |
| `vitest` (+ `@vitest/mocker`) | direct, développement | 4.0.15 | 4.1.12 (2026-10-15) | critique GHSA-5xrq-8626-4rwp (UI Vitest), GHSA-82fw-gwwq-j7x9 et GHSA-qxg6-89mg-rqv8 (mocker) |
| `zod` | direct | 4.1.12 | 4.6.7 (2026-10-12) | haute GHSA-mrhx-c7xc-m3w5 (épuisement mémoire sur collections contraintes surdimensionnées) ; c'est aussi la version déjà utilisée par Better Auth |
| `fast-uri` | indirect (`@sentry/nextjs` → `@sentry/webpack-plugin` → `webpack` → `schema-utils`/`ajv`) | 3.1.8 | 3.1.9 (2026-10-19) | GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp ; mis à jour par `npm update fast-uri` dans la plage existante |

`npm audit fix --force` n'a pas été lancé : il propose des retours en arrière (`@sentry/nextjs` 10.76.1, qui réintroduirait la faille critique ; `eslint` 4.0.0 ; `drizzle-kit` 0.18.1 ; `@eslint/js` 9 ; `@next/eslint-plugin-next` 16.2).

Vulnérabilités modérées restantes et réduction du risque :

| Chaîne | Avis | Pourquoi non corrigé | Exposition et mesure |
| --- | --- | --- | --- |
| `drizzle-kit` 0.31.11 → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` 3.3.2 → `esbuild` 0.18.20 | GHSA-67mh-4wv8-2f99 (serveur de développement esbuild lisible par un autre site, ≤ 0.24.2) | `drizzle-kit` 0.31.11 est la dernière version stable ; `@esbuild-kit` n'est plus maintenu (dernière version 2023) ; forcer esbuild 0.25 dans ce chargeur serait un changement majeur non testé | Développement seulement. drizzle-kit n'utilise esbuild que pour lire `drizzle.config.ts` et ne lance jamais le serveur esbuild. Ne lancer `drizzle-kit` que localement ; réévaluer au passage à drizzle-kit 1.x stable. |
| `eslint` 10.11.0, `typescript-eslint` 8.56.0, `@eslint/js`, `@next/eslint-plugin-next`, `@eslint-community/eslint-utils`, `@eslint/config-array` → `minimatch` 10.2.6 / 9.0.9 | GHSA-g3hv-75wg-m249 (déni de service sur motifs « globparts », < 11.0.1) | correction seulement dans `minimatch` 11 (majeure), que ces outils n'acceptent pas encore | Développement seulement ; les motifs viennent de notre configuration, pas d'un utilisateur. Mettre à jour dès qu'ESLint publie une version compatible. |
| `@sentry/nextjs` 10.78.0 → `@sentry/bundler-plugins` / `@sentry/webpack-plugin` → `glob` 13.0.6 | GHSA-3g3m-2fjr-6pw4 (annulation par AbortSignal ignorée, ≤ 14.0.1) | correction dans `glob` 14.0.2 (majeure), non acceptée par les plugins Sentry | Build seulement, et ces plugins ne s'exécutent qu'avec `withSentryConfig`, non utilisé. Mettre à jour Sentry quand ses plugins passeront à glob 14. |
