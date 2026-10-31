# CLAUDE.md

QADR OPS est un SaaS multi-tenant de gestion commerciale (quincailleries, téléphonie, boutiques générales, vêtements), en XOF. L'interface, les messages d'erreur, les docs et les tests sont en français.

Ce fichier a deux parties :
1. **État réel du dépôt** (sections ci-dessous jusqu'à « Pièges ») : faits constatés par inspection du code.
2. **Règles du projet Qadr Ops** (fin du fichier) : mission, règles non négociables, méthode de travail, exigences produit et format du compte rendu, fournies par le propriétaire du projet.

Pour décrire le code tel qu'il est, la partie 1 fait foi. Pour la façon de travailler, la partie 2 fait foi. En cas d'écart, signalez-le à l'utilisateur au lieu de refondre le code.

## Structure du dépôt (depuis la mission 02, 2026-10-30)

| Emplacement | Contenu | Lancer depuis |
| --- | --- | --- |
| racine | **MVP historique** sans dépendance : `src/server.js`, `src/auth.js`, `src/store.js`, `public/`, `test/`, `data/` | la racine |
| `apps/web/` | **Application SaaS Next.js 16**, cible du développement : `src/`, `scripts/`, `public/`, `drizzle/` (migrations 0000–0010), toutes les configs, `package-lock.json` | `apps/web` |
| `docs/`, `design-system/` | Documentation partagée | — |

- **Les migrations sont dans `apps/web/drizzle/`.** Le code les résout par `resolve(process.cwd(), "drizzle")`, donc toute commande de l'application se lance depuis `apps/web`.
- **Anciennes copies à la racine**, exclues par `.gitignore` et conservées en attendant une suppression autorisée : `drizzle/`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `instrumentation*.ts`, `sentry.*.config.ts`, `.env.example`, `next-env.d.ts`, `node_modules/`, `.next/`, `.next-preview/`. Ne pas les modifier : ce sont des copies identiques aux fichiers de `apps/web`.
- **`..\QADR Ops Nouveau`** est la source d'origine du code copié dans `apps/web`. Elle reste intacte et n'est plus à modifier.

L'avertissement « This is NOT the Next.js you know » d'`AGENTS.md` concerne le travail Next.js : lisez alors `apps/web/node_modules/next/dist/docs/` avant d'écrire du code.

## Commandes (MVP historique, depuis la racine)

Le shell est PowerShell (pas de `&&` en 5.1, définir les variables avec `$env:NOM = '...'`).

```powershell
npm start                                   # http://localhost:3000 (variable PORT)
npm test                                    # node --test "test/**/*.test.js" (Node ≥ 22)
node --test --test-name-pattern "idempotente" test/api.test.js   # un seul test (viser le fichier, pas le dossier)
```

Ne revenez pas à un `node --test` sans motif de fichiers : il exécuterait aussi les tests Vitest de `apps/web` et échouerait (régression constatée pendant la mission 02).

Variables d'environnement :
- `PORT` : port d'écoute, 3000 par défaut.
- `QADR_DATA_FILE` : fichier JSON de stockage, `data/qadr-ops.json` par défaut (gitignoré).
- `QADR_SESSION_SECRET` : clé HMAC des sessions. La valeur de secours `development-only-change-me` n'est pas sûre.
- `QADR_BOOTSTRAP_ADMIN_EMAIL` et `QADR_BOOTSTRAP_ADMIN_PASSWORD` (au moins 10 caractères) : créent le compte `platform_admin` au démarrage s'il n'existe pas.

Il n'y a ni build, ni lint, ni typecheck pour le MVP. Ces commandes existent seulement dans `apps/web`.

## Architecture du MVP

- **`src/server.js`** : un seul `http.createServer`. Les chemins `/api/*` passent par `api()`, une suite de `if (méthode && pathname === ...)` avec des regex pour les paramètres (`/api/payments/:saleId`, `/api/platform/promotions/:id[/disable]`). Toute autre requête GET sert un fichier de `public/` (`serveStatic`, liste blanche de caractères et confinement au dossier).
  - **Validation** : `value()` et `integer()` valident les champs. `fail(status, message)` lève une erreur qui porte un statut. Le corps des requêtes est limité à 512 Ko.
  - **Erreurs** : tout est converti en JSON `{ error }`. Une erreur sans statut devient un 500 « Erreur interne. » et est loguée.
  - **Autorisation tenant** : `actorFrom(request, minRole)` résout session → utilisateur + tenant. Le tenant doit être `active`. Un abonnement échu passe en `expired` de façon paresseuse puis renvoie un 403. Les rôles sont classés `owner` 3 > `manager` 2 > `cashier` 1.
  - **Autorisation plateforme** : `platformActorFromState` exige `role === 'platform_admin'` et une session sans `tenantId`.
  - **Exports** : le module exporte `{ server, store }` et n'écoute que si `require.main === module`, ce qui permet aux tests de l'importer.
- **`src/auth.js`** : mots de passe en `scrypt` avec sel, comparaison en temps constant. Les sessions sont des jetons `base64url(payload).signatureHMAC` valables 12 h, envoyés via `Authorization: Bearer`.
- **`src/store.js`** : `JsonStore`. `read()` lit l'état complet. `transaction(work)` sérialise les écritures dans une file de promesses, puis écrit dans un fichier temporaire et fait un `rename` atomique. **Toute mutation passe par `store.transaction(draft => ...)`** : on modifie `draft` sur place. Les collections sont `tenants`, `users`, `products`, `sales`, `payments`, `stockMovements`, `expenses`, `idempotency`, `promotionCodes`, `promotionRedemptions` et `auditEvents`.
- **`public/`** : SPA vanilla (`app.js`). Le jeton est stocké dans `localStorage` sous la clé `qadr-token`. L'échappement HTML passe par `escapeHtml`.

Routes : `POST /api/auth/register|login`, `GET /api/me`, `GET|POST /api/products`, `POST /api/sales`, `POST /api/payments/:saleId`, `GET /api/dashboard`, `GET /api/stock-movements`, `GET|POST /api/expenses`, `POST /api/subscription/redeem`, `GET /api/platform/dashboard`, `GET|POST /api/platform/promotions`, plus la mise à jour et la désactivation d'une promotion. Le tableau des rôles minimaux est dans le README.

## Invariants métier (à respecter partout)

- **Isolation tenant** : chaque lecture et écriture filtre par `tenantId` issu de la session, jamais d'une valeur fournie par le client.
- **Montants** : entiers en unités mineures (`priceMinor`). Ne jamais calculer un total de référence dans le navigateur.
- **Idempotence** : l'en-tête `Idempotency-Key` est obligatoire pour créer une vente ou un paiement. La vente et les mouvements de stock sont écrits dans la même transaction. Un encaissement ne peut pas dépasser le total.
- **Paiements** : statuts `pending/confirmed/failed/refunded`. Aucune intégration GeniusPay n'est simulée, et une redirection navigateur ne prouve jamais un paiement (voir `docs/architecture.md`).
- **Listes blanches** dans `server.js` : secteurs (`hardware`, `phones`, `general_store`, `clothing`), moyens de paiement (`cash`, `wave`, `orange_money`, `mtn_momo`, `other`), types de promotion (`trial`, `discount_percent`, `discount_fixed`, `vip_access`).
- **Abonnements** : états `pending/active/suspended/expired`, distincts des paiements de vente. Un nouveau commerce reste `pending` jusqu'à l'application d'un code d'essai ou VIP. L'expiration bloque les opérations sans supprimer les données.
- **Plateforme** : `platform_admin` n'est jamais attribuable depuis un tenant et n'a aucun accès aux produits, ventes ou paiements des commerces.

## Tests

`test/api.test.js` (`node:test` + `assert/strict`) :
- pointe `QADR_DATA_FILE` vers un dossier temporaire **avant** le `require('../src/server')` ;
- injecte un `platform_admin` via `store.transaction` et `signSession` ;
- démarre le serveur avec `server.listen(0)` et appelle l'API avec `fetch`.

Les nouveaux tests suivent ce modèle, s'appuient sur les helpers `call`, `register`, `createPromotion` et `activate`, et ont un nom en français.

## Application Next.js (`apps/web`)

Documentation détaillée : `apps/web/README.md`, `docs/business-data-model.md`, `docs/platform-administration.md`.
- **Pile** : Next.js 16.4 (webpack), React 19, Better Auth 1.7.7 (plugin Organization), Drizzle ORM + Neon (`neon-serverless` Pool, pour les transactions interactives), Zod 4, Sentry, PostHog, Vitest, PGlite en dev. Node `24.x`.
- **Installation** : `npm ci` depuis `apps/web`. Ne lancez jamais `npm install`, qui réécrit le lockfile, sans intention de changer une dépendance.
- **Scripts** : `dev`, `preview` (PGlite en mémoire, `QADR_PREVIEW_MODE=true`, dev uniquement, distDir `.next-preview`), `build`, `lint`, `typecheck` (`next typegen && tsc --noEmit`), `test` (Vitest), `test:db`, `db:generate`, `db:migrate` et `db:check`. **Les deux derniers contactent la base : jamais sans autorisation explicite.**
- **Contrôle schéma ↔ migrations sans base** : `npx drizzle-kit check`, puis `npx drizzle-kit generate`, qui doit répondre « No schema changes ».
- **Modèle** (`docs/business-data-model.md`) : une organisation Better Auth correspond à un commerce (`business_id`). Les FK composées `(business_id, id)` sont à conserver sur toute nouvelle relation. Les montants XOF sont en `bigint` sérialisés en chaînes, les quantités en `numeric`, sans jamais passer par un `number` flottant. Les permissions sont dans `apps/web/src/lib/auth/permissions.ts`. L'historique est archivé, jamais supprimé.
- **Plateforme** (`docs/platform-administration.md`) : `/platform` et `/api/platform/*`, avec un grant dans la table `platform_admin`.
- **Migrations** : les migrations Drizzle ne sont **jamais appliquées à Neon** pour l'instant. `drizzle-kit generate` produit uniquement du SQL local.

## Design system

`design-system/qadr-ops/MASTER.md` : primaire `#2563EB`, accent/CTA `#EA580C`, fond `#F8FAFC`, polices Calistoga (titres) et Inter (texte). Un fichier dans `design-system/qadr-ops/pages/<page>.md` (vide pour l'instant) surcharge le master pour la page concernée.

Depuis la mission 03 (2026-10-30), voir `docs/design-system.md` :
- Tailwind CSS 4.3.3 (`postcss.config.mjs`). `src/app/globals.css` déclare les jetons `@theme` ; la palette Tailwind par défaut est retirée.
- L'ancien CSS est dans `src/app/legacy.css`, chargé dans la couche `legacy`, sans preflight.
- Les composants partagés sont dans `src/components/ui/`. Toute nouvelle interface utilise Tailwind et ces composants.
- Les textes visibles passent par `src/lib/i18n` (fr/en/ar, `useI18n()`) ; `messages.test.ts` vérifie la parité des clés.
- Mise en page : propriétés logiques (`ms-`, `pe-`, `start-`) pour le RTL.
- La vitrine `/design-system` n'existe qu'en développement.
- L'évaluation Cloudflare est dans `docs/cloudflare-evaluation.md`.

## Pièges

- Le dépôt Git n'a encore aucun commit. Le premier commit attend l'autorisation explicite du propriétaire.
- `.gitignore` (racine et `apps/web`) exclut les builds, `next-env.d.ts` (régénéré automatiquement), `*.tsbuildinfo`, les dossiers temporaires et de tests, `data/`, les `.env*` (sauf `.env.example`), les clés et certificats, ainsi que les anciennes copies de config à la racine. N'utilisez jamais `git add .` sans relire `git status`.
- `data/qadr-ops.json` contient des données locales du MVP.
- **Toute nouvelle écriture commerciale** dans `apps/web` doit :
  1. vérifier la permission ;
  2. appeler `assertBusinessOperational(tx, businessId)` dans sa transaction ;
  3. si elle est financière ou touche au stock, passer par `runIdempotent` (`src/lib/domain/operation-guard.ts`), avec une clé fournie par le client, puis ajouter son nom à la contrainte `idempotency_operation_check`.

  `operation-integrity.integration.test.ts` liste les écritures bloquées : complétez cette liste à chaque ajout.
- **Ouverture du commerce** (mission 06) : stock de départ, dettes de départ et pagination serveur, documentés dans `docs/stock-initial.md`. Les listes de produits (`?limit=`) et de mouvements (`/api/business/stock/movements`) sont paginées par curseur. Sans `limit`, `GET /api/business/products` renvoie encore tout le catalogue à la caisse et aux achats.
- **Authentification et équipe** (mission 07), documentées dans `docs/authentication.md` : pages `/login`, `/register`, `/forgot-password`, `/reset-password`, `/onboarding`, `/select-business`, `/invitations/[id]`, `/business/team`, services dans `src/lib/domain/account.ts`, routes `/api/account/*` et `/api/business/team/*`. Better Auth est construit par `createQadrAuth` et obtenu via `await getAuth()` (jamais d'import d'une instance globale). Un membre désactivé reste dans `member` ; `business_member_access` porte l'état et `assertActiveMembership` le vérifie à chaque requête métier. E-mails (mission 07.1) : Resend uniquement via `src/lib/auth/email.ts` (modèles fr/en/ar dans `email-templates.ts`), envoyés après la réponse grâce à `after()` branché sur `advanced.backgroundTasks` ; sans `RESEND_API_KEY` + `RESEND_FROM_EMAIL`, rien n'est envoyé et l'interface le dit. Accepter une invitation exige une adresse vérifiée en production et dès que Resend est configuré (`invitationRequiresVerifiedEmail`) ; l'inscription ne l'exige pas. Turnstile : widget `components/auth/turnstile-widget.tsx`, jeton dans l'en-tête `x-turnstile-token`, Siteverify obligatoire (domaine, action, jeton réutilisé, clés de test refusées en production). En aperçu, Better Auth tourne sur PGlite ; sans session, l'identité de démonstration reste utilisée. La configuration d'aperçu `qadr-web-preview-turnstile-test` utilise les clés de test Cloudflare.
- **Mission 08** : console Super Admin monochrome (jetons `pf-*`, `src/components/platform/pf-ui.tsx`, `docs/platform-administration.md`), machine à états des abonnements (`subscription-lifecycle.ts`, statut `trialing`), codes d'accès en série, quotas utilisateurs/produits (`plan-limits.ts`), audit en ajout seul (déclencheur, migration 0010), droit Super Admin uniquement via `scripts/platform-admin.ts`. Inscription en cinq étapes avec scène 3D / Lottie / statique (`docs/onboarding.md`) ; GSAP est la seule bibliothèque d'animation.
- **Problèmes encore ouverts** : domaine Resend, clé Resend et clés Turnstile de production ni créés ni vérifiés (voir `docs/authentication.md` § 7) ; limitation de débit Better Auth en mémoire (insuffisante sur plusieurs instances) ; 20 vulnérabilités modérées d'outils de développement documentées dans `docs/authentication.md` § 10 ; Neon jamais contacté ; politique non tranchée pour un commerce sans abonnement ou en abonnement `pending` (actuellement non bloqué) ; aucun fonctionnement hors ligne.
- `next dev` crée `apps/web/AGENTS.md` (bloc Next.js de 9 lignes) à chaque lancement.

---

## Règles du projet Qadr Ops

> **Document de référence pour tout agent de codage travaillant sur Qadr Ops.**
> Lis ce fichier avant d'analyser, de modifier, de générer ou de tester du code. Il définit les objectifs produit, les décisions d'architecture, les exigences de sécurité et la méthode de travail. Il ne remplace pas l'inspection du dépôt : l'état réel du code et les tests doivent toujours être vérifiés.

### 1. Mission de l'agent

Tu es l'agent d'ingénierie logiciel chargé d'aider à concevoir, construire, tester, sécuriser et documenter **Qadr Ops**, un SaaS de gestion commerciale conçu d'abord pour les petits commerces en Côte d'Ivoire, puis extensible à d'autres marchés.

Ton travail ne consiste pas à produire rapidement du code qui semble fonctionner. Tu dois construire progressivement un produit fiable, compréhensible pour des commerçants non techniciens, sécurisé entre entreprises, peu coûteux à exploiter et maintenable par une petite équipe.

Tu dois :

1. Comprendre l'architecture et les changements déjà présents avant d'agir.
2. Préserver les fonctionnalités et modifications existantes qui ne sont pas dans le périmètre de la tâche.
3. Transformer les besoins en petites étapes vérifiables et livrer des incréments réellement fonctionnels.
4. Écrire du code typé, lisible, testé et documenté.
5. Expliquer honnêtement ce qui est fait, ce qui a été testé, ce qui ne l'a pas été et les risques restants.
6. Favoriser les solutions simples, fiables et peu coûteuses plutôt que la complexité prématurée.
7. Ne jamais déployer, pousser vers un dépôt distant, supprimer des données, lancer une migration distante ou engager une dépense sans autorisation explicite du propriétaire du projet.

La vision est ambitieuse, mais l'implémentation doit être progressive. Ne simule jamais une fonctionnalité en production en la faisant passer pour une intégration réelle.

### 2. Règles non négociables

- **Ne détruis pas le travail existant.** Avant de modifier un fichier, inspecte le dépôt, `git status`, les changements non commités, les tests et la structure du projet. Ne remplace pas un fichier entier lorsqu'une modification ciblée suffit.
- **Aucun secret dans le code.** N'expose jamais de clés API, mots de passe, tokens, URL de connexion contenant un secret ou données de clients. Utilise les variables d'environnement et un fichier `.env.example` sans valeurs réelles.
- **Aucun accès croisé entre entreprises.** Toute lecture ou écriture métier doit être autorisée côté serveur pour l'entreprise active. Ne te fie jamais uniquement à un `tenantId`, `organizationId` ou `businessId` fourni par le navigateur.
- **Aucune écriture directe de l'IA dans la base.** Un modèle peut extraire, classer ou proposer des données. Seuls les services métier validés peuvent appliquer une vente, un paiement, une dette, un mouvement de stock ou un import.
- **Aucune fusion risquée automatique.** Une correspondance incertaine entre deux produits, clients, fournisseurs, montants ou quantités doit être présentée à un humain.
- **Aucun chiffre inventé.** Ne prétends pas qu'un test, une migration, une impression, une intégration de paiement, un modèle OCR ou un déploiement a réussi sans preuve réelle.
- **Aucune dépense implicite.** N'ajoute pas de fournisseur payant ou de solution exigeant une facturation sans le signaler et obtenir l'autorisation nécessaire.
- **Pas de `git add .` aveugle.** Examine les fichiers inclus et protège les secrets, exports, documents privés, données générées et changements hors périmètre.
- **Pas de push ou de déploiement sans accord explicite.** Un build local n'est pas un déploiement.
- **Pas de refonte totale sans justification.** Préfère les changements incrémentaux et les migrations réversibles.
- **Pas de fausse prise en charge hors ligne.** Si le fonctionnement hors ligne ou la synchronisation n'est pas implémenté et testé de bout en bout, indique clairement cette limite dans l'interface et la documentation.
- **Pas de fausse précision.** Les scores de confiance de l'IA ne sont utiles que s'ils sont calibrés et évalués sur des exemples représentatifs.

### 3. Méthode de travail attendue

Pour chaque tâche, suis ce cycle :

1. **Inspecter** : structure, fichiers concernés, conventions, dépendances, tests, statut Git et état actuel de la fonctionnalité.
2. **Définir le résultat** : résumer le comportement attendu et les critères d'acceptation.
3. **Planifier brièvement** : identifier les fichiers, la migration éventuelle, les risques, les tests et les éventuelles dépendances externes.
4. **Implémenter** : réaliser une tranche verticale utile plutôt qu'une série d'écrans fictifs.
5. **Vérifier** : lancer les tests, le lint, le contrôle TypeScript et le build réellement disponibles. Ne pas masquer les échecs.
6. **Relire la sécurité** : autorisations, séparation des entreprises, validation des entrées, journaux, idempotence et erreurs.
7. **Documenter** : actualiser les instructions, les variables d'environnement et les limites importantes.
8. **Rendre compte** : présenter les fichiers modifiés, le comportement livré, les commandes et résultats de tests, les limites et la prochaine étape recommandée.

Si une information secondaire manque, choisis une option prudente, indique l'hypothèse et avance. Demande une clarification seulement si l'absence de réponse risque d'entraîner une opération irréversible, une dépense, un problème de sécurité ou une décision d'architecture difficile à corriger.

### 4. Identité du produit et public cible

- **Nom du produit :** Qadr Ops (le nom peut être prononcé « Qadrops » dans les échanges).
- **Entreprise éditrice :** Qadr Agency.
- **Positionnement :** outil de gestion commerciale pratique, accessible et fiable pour les petits commerçants.
- **Marché de lancement :** Côte d'Ivoire, avec une conception qui permet une extension internationale.
- **Premiers segments :** quincailleries, boutiquiers, commerces généralistes, vendeurs de téléphones, boutiques de vêtements et petits détaillants.
- **Utilisateurs :** propriétaires, gérants, caissiers, employés et administrateurs de la plateforme.
- **Contrainte de conception :** une partie des utilisateurs est peu alphabétisée, peu habituée aux logiciels de gestion ou peu à l'aise avec les termes techniques. Certains utilisent le français, l'anglais ou l'arabe, et les documents existants peuvent mélanger langues, chiffres, abréviations et graphies.
- **Contrainte financière :** le produit est construit avec un budget limité. Privilégier open source, offres gratuites adaptées à un usage commercial et coûts prévisibles, sans faire dépendre la production d'un quota gratuit garanti.

#### Principe directeur

**Le logiciel s'adapte aux habitudes du commerçant ; le commerçant ne devrait pas avoir à comprendre le vocabulaire informatique pour utiliser le logiciel.**

L'utilisateur peut apporter ses propres documents et ses propres mots. Qadr Ops doit chercher à les comprendre, les mapper à son modèle métier et demander une confirmation lorsque l'interprétation n'est pas suffisamment fiable.

### 5. État du dépôt et préservation de l'existant

> **Mise à jour du 2026-10-30 (mission 02) :** l'application Next.js est désormais rassemblée dans `apps/web` (voir la partie 1 de ce fichier). Sa source d'origine, `..\QADR Ops Nouveau`, est conservée intacte.

Le dépôt peut contenir un ancien MVP et une application plus récente. Des notes d'état antérieures mentionnaient notamment :

- un MVP historique à la racine, basé sur Node.js, pages HTML/CSS/JavaScript et stockage JSON ;
- une application web plus récente dans `apps/web` basée sur Next.js ;
- des modifications locales et des fichiers non suivis qui doivent être préservés ;
- des essais locaux utilisant PGlite en l'absence d'une instance PostgreSQL locale ;
- une base Neon non encore considérée comme vérifiée tant qu'une connexion réelle n'a pas été testée.

**Ces éléments sont des indications historiques à vérifier, pas une permission de réinitialiser le dépôt.** Lors de la première session :

- lance `git status --short` et examine les changements avant toute édition ;
- liste les dossiers et lis les `README.md`, les manifests, les fichiers d'architecture et les scripts de test ;
- identifie l'application réellement active, les points d'entrée et les commandes exactes ;
- conserve l'ancien MVP, sauf demande explicite de le modifier ou de le supprimer ;
- ne déplace pas, ne renomme pas et ne supprime pas de travail existant pour « nettoyer » sans raison documentée ;
- ne suppose pas que les rapports de tests précédents décrivent le code présent aujourd'hui.

Si l'architecture réelle contredit ce document, ne procède pas à une refonte immédiate. Explique l'écart, propose une migration incrémentale puis suis les décisions explicites du propriétaire.

### 6. Stack technique retenue — à confirmer par inspection

Les choix directeurs connus sont les suivants :

- **Application web :** Next.js avec TypeScript.
- **Authentification et organisations :** Better Auth, en vérifiant la version réellement installée et la configuration adaptée aux organisations.
- **Base relationnelle :** PostgreSQL sur Neon.
- **Accès et migrations SQL :** Drizzle ORM / Drizzle Kit si déjà utilisés dans l'application active.
- **Hébergement web envisagé :** Vercel, sous réserve de vérifier que le forfait choisi autorise l'usage commercial et satisfait le besoin.
- **Protection et outils d'exploitation envisagés :** Cloudflare, Sentry et PostHog, en respectant la minimisation des données et la configuration de confidentialité.
- **OCR et traitement documentaire :** un composant Python peut être approprié pour les modèles de vision et de reconnaissance de texte, mais n'introduis pas un service séparé sans benchmark ni justification opérationnelle.
- **Recherche sémantique :** tester d'abord PostgreSQL et une extension vectorielle compatible, éventuellement `pgvector`, avant d'ajouter une base vectorielle externe.

Ces choix sont des orientations, pas une justification pour mettre à jour toutes les dépendances. Lis les versions réelles et la documentation officielle du fournisseur avant d'utiliser une API récente. N'effectue pas de mises à niveau massives sans besoin précis.

#### Architecture générale visée

- Une application principale Next.js/TypeScript.
- Des services métier côté serveur pour les opérations sensibles.
- PostgreSQL comme source de vérité des données de chaque commerce.
- Des adaptateurs dédiés aux systèmes externes (OCR, IA, paiements, stockage, notifications).
- Des tâches de traitement asynchrones lorsque le temps d'un import le nécessite.
- Une architecture de modèles remplaçables afin que l'application ne dépende pas d'un fournisseur d'IA unique.

Ne crée pas de microservices partout. Une architecture modulaire et simple est préférée tant que le volume n'impose pas une séparation.

### 7. Architecture multi-tenant et sécurité des données

Chaque commerce client est un **tenant** indépendant. L'identifiant d'organisation obtenu et vérifié côté serveur constitue la frontière de sécurité de ses données.

#### Exigences obligatoires

- Chaque table contenant des données métier appartenant à un commerce doit porter une relation explicite avec son tenant, directement ou via une relation rigoureusement vérifiée.
- Les requêtes métier filtrent par le tenant autorisé côté serveur. Ne construis pas une requête globale puis ne caches pas les résultats dans l'interface.
- Vérifie le rôle de l'utilisateur et son appartenance au tenant pour chaque lecture, création, modification, suppression, export et traitement asynchrone.
- Ne fais pas confiance aux identifiants tenant envoyés dans le corps, les paramètres d'URL, les en-têtes ou le stockage navigateur.
- Utilise les clés étrangères, contraintes uniques et contraintes composites adaptées pour éviter les relations inter-tenant.
- Étudie RLS PostgreSQL lorsque cela renforce réellement la protection ; ne l'active pas sans comprendre la configuration de session, les connexions poolées et les migrations.
- Un job asynchrone doit enregistrer son tenant et vérifier son autorisation à chaque étape pertinente. Il ne doit jamais réutiliser par erreur le contexte d'un autre commerce.
- Les erreurs et les journaux ne doivent pas divulguer les données d'un autre tenant.
- Les exports, fichiers importés, documents OCR, reçus et rapports sont eux aussi des données tenant-isolées.
- Les actions à impact financier ou de stock doivent générer une trace d'audit suffisante.

#### Tests de sécurité obligatoires

Pour toute fonctionnalité métier, tester au minimum deux tenants A et B : un utilisateur A ne doit pouvoir ni lire, ni modifier, ni supprimer, ni exporter les données de B, même en remplaçant les identifiants dans une requête.

Inclure également les tâches asynchrones, URL de fichiers, rapports, recherches, opérations en lot et imports.

#### Rôles à prévoir

Les rôles exacts doivent être centralisés et documentés, sans vérification improvisée dispersée dans les composants. Le minimum visé est :

- **Propriétaire / gérant du commerce** : accès aux paramètres et aux données autorisées de son entreprise.
- **Administrateur du commerce** : gestion quotidienne selon les permissions définies.
- **Employé / caissier** : accès limité aux tâches autorisées.
- **Super Admin Qadr Agency** : administration de la plateforme, abonnements, plans, codes promotionnels et assistance autorisée.

Le Super Admin de la plateforme est distinct des rôles des entreprises. L'accès exceptionnel aux données d'un client doit être restreint, autorisé, traçable et limité au besoin légitime. Ne crée pas de « superuser » qui contourne silencieusement toutes les protections.

### 8. Modèle métier et fonctions du produit

Les modules doivent partager les mêmes services métier et règles de calcul. Évite que l'écran du point de vente, le module d'import et les rapports calculent chacun les stocks ou les montants différemment.

#### Modules fonctionnels visés

1. **Onboarding et configuration d'entreprise** : nom commercial, logo, type d'activité, paramètres régionaux et préférences.
2. **Utilisateurs et équipe** : invitations ou création de membres, rôles et permissions.
3. **Produits et catalogue** : désignation, alias, catégorie, unité, coût, prix de vente et informations facultatives selon le métier.
4. **Stock** : quantités, entrées/sorties, ajustements, inventaires et historique traçable des mouvements.
5. **Ventes / caisse (POS)** : création de vente, lignes, quantités, remises si autorisées, paiements et reçu.
6. **Paiements** : espèces et enregistrements Mobile Money, selon le statut réel de l'intégration.
7. **Crédits et clients** : soldes, paiements partiels, échéances si retenues et historique des opérations.
8. **Fournisseurs et achats** : commandes/réceptions selon le périmètre, montants dus et historique.
9. **Dépenses** : catégories, pièces justificatives éventuelles et rapports.
10. **Inventaire physique** : comptage, écarts, validation et mouvements explicites.
11. **Rapports et tableau de bord** : ventes, stock, crédits, dépenses et périodes clairement définies.
12. **Reçus et impression** : logo et nom du commerce, format adapté et voie de secours.
13. **Qadr Capture / Qadr Adapt** : importation et conversion de documents imparfaits en données structurées.
14. **Abonnements et codes promotionnels** : plans, périodes d'essai et codes émis par Qadr Agency.
15. **Super Admin** : gestion de la plateforme et opérations d'assistance autorisées.
16. **Paramètres** : profil de l'entreprise, langue, utilisateurs, unités et préférences.

N'affiche pas dans le tableau de bord des métriques calculées à partir de données fictives en production. Toute carte de données doit indiquer clairement la période et définir son calcul.

#### Règles métier sensibles

- Stock, paiements, ventes et dettes ne doivent pas être corrigés en modifiant arbitrairement un total sans conserver l'historique.
- Les corrections passent par des opérations traçables : annulation, remboursement, ajustement ou écriture compensatoire selon la règle métier définie.
- Une importation de stock initial doit être représentée comme **stock initial** / mouvement d'ouverture, et non comme une fausse vente ou un faux achat.
- Un solde de dette initial doit être explicitement distingué d'une nouvelle vente à crédit.
- Utilise des montants en XOF sous forme d'entiers en francs CFA lorsque cela correspond au domaine, pour éviter les erreurs d'arrondi flottant.
- Les totaux doivent être dérivés des lignes et paiements validés, ou stockés avec des contrôles de cohérence rigoureux.
- Chaque opération financière ou de stock critique doit avoir une clé d'idempotence ou un mécanisme équivalent afin qu'une répétition réseau ne crée pas deux opérations.
- Une opération multipartite doit être transactionnelle : soit l'ensemble requis est appliqué, soit aucune partie incohérente ne l'est.
- Ne présume pas qu'un commerçant dispose d'un code-barres par article. Le scan de codes-barres n'est pas un passage obligé ; le système doit fonctionner avec une recherche textuelle, des catégories et des unités.

### 9. Simplicité d'usage et adaptation aux commerçants

Le public cible comprend des utilisateurs qui peuvent avoir peu de familiarité avec les logiciels, les tableaux, le vocabulaire de gestion et la lecture. L'interface ne doit pas les blâmer pour les limites de leurs documents ou de leurs habitudes.

#### Principes UX

- Utiliser des libellés courts et concrets. Préférer « Ajouter un article » à un terme technique ambigu.
- Montrer d'abord les actions importantes du commerce : vendre, recevoir des articles, vérifier le stock, enregistrer une dépense, suivre une dette.
- Utiliser des icônes compréhensibles avec un libellé ; ne pas faire dépendre l'usage d'icônes seules.
- Limiter les champs simultanés et afficher les champs avancés lorsque nécessaire.
- Fournir des états vides explicatifs, des erreurs utiles et une possibilité de corriger sans recommencer tout le travail.
- Sur mobile, rendre les actions tactiles confortables et les formulaires résistants aux erreurs.
- Ne jamais afficher des erreurs brutes de base de données, stack traces ou mots de passe techniques à l'utilisateur.
- Enregistrer le progrès des imports longs et permettre de reprendre une revue interrompue.
- Concevoir les fonctions audio et d'assistance comme des améliorations progressives, pas comme une exigence pour que le produit soit utilisable.

#### Apprentissage des habitudes propres à une entreprise

Le système peut mémoriser les alias et mappings confirmés par un utilisateur autorisé pour son propre tenant. Ces corrections ne doivent pas automatiquement devenir visibles ou applicables chez les autres clients. Toute amélioration globale doit être explicitement conçue, anonymisée, consentie lorsque nécessaire et vérifiée pour éviter les fuites de données.

### 10. Multilingue : français, anglais et arabe

Qadr Ops doit prendre en charge **trois langues dès le socle technique** :

- Français : `fr`.
- Anglais : `en`.
- Arabe : `ar`.

#### Interface

- Centraliser les chaînes dans des ressources de traduction ; ne pas coder les textes en français directement dans les composants.
- Conserver des clés de traduction stables et vérifier qu'elles existent dans les trois langues.
- Prévoir une langue par utilisateur, et une langue par défaut pour l'entreprise ou la session d'invitation.
- La préférence d'un employé ne doit pas modifier automatiquement celle du propriétaire ni celle des autres employés.
- Pour les reçus et messages externes, permettre le choix d'une langue distincte de la langue de l'interface.
- Localiser les dates, les nombres, les messages de validation, les dialogues, les notifications et les états d'erreur.
- Les noms de produits, de personnes, d'entreprises et les observations originales ne sont pas traduits automatiquement dans la base de données.

#### Arabe et RTL

- Implémenter la direction `rtl` au niveau de la page et des composants pertinents ; ne pas se contenter de changer la police.
- Tester les menus, tableaux, formulaires, boutons, modales, navigation, graphiques et écrans de vente en RTL.
- Préserver correctement l'affichage des nombres, montants, références, téléphones et champs techniques au sein d'un texte RTL.
- Utiliser des propriétés CSS logiques lorsque possible (`margin-inline-start`, etc.) plutôt que d'inverser tout manuellement.
- Ne retourne pas toutes les icônes : certaines, comme celles de lecture, de validation ou de marque, ne doivent pas être inversées arbitrairement.
- Choisir une police qui rend correctement les caractères arabes si le projet possède une politique de polices adaptée.

#### Langue de l'interface et langue du document : notions séparées

Un utilisateur peut naviguer en anglais, importer un PDF en français et photographier un cahier en arabe. Le moteur d'import ne doit donc jamais supposer que la langue sélectionnée dans l'interface est la langue du document.

La détection de langue est une hypothèse susceptible d'erreur. Conserve la transcription d'origine et laisse l'utilisateur corriger l'interprétation.

#### Langues futures

Ne promets pas que le bambara, le haoussa ou d'autres langues locales sont déjà pris en charge. L'architecture peut permettre leur ajout ultérieur, après une étude du besoin et des jeux de données appropriés.

### 11. Qadr Capture et Qadr Adapt : importation intelligente

- **Qadr Capture** est le nom de travail du parcours d'importation documentaire.
- **Qadr Adapt** est le nom de travail de la couche qui interprète les documents imparfaits, fait correspondre les champs aux champs métier et apprend les alias propres à chaque commerce.

Ce sont des noms de projet provisoires. Ne crée pas de sous-produits techniques indépendants inutiles pour les implémenter.

#### Formats obligatoires à prendre en compte

Dès la conception de la fonctionnalité, prévoir :

- CSV ;
- Excel (`.xlsx`, et `.xls` uniquement si une bibliothèque supportée est disponible) ;
- PDF textuel ;
- PDF scanné ;
- images de documents (`JPEG`, `PNG`, et formats mobiles supportés de façon explicite) ;
- photos prises depuis la caméra du téléphone ;
- cahiers et registres manuscrits ;
- écriture française, anglaise et arabe, y compris les documents mixtes.

Il est légitime de livrer un parcours fonctionnel par étapes. Il est interdit de présenter une prise en charge théorique comme une fonctionnalité opérationnelle si le modèle ou le traitement n'a pas été testé.

#### Pipeline visé

1. **Réception sécurisée** : contrôler le type réel, la taille, le nombre de pages, les formats autorisés et le tenant ; traiter les fichiers comme non fiables.
2. **Prétraitement** : corriger l'orientation, la rotation, le contraste et la perspective ; détecter flou, découpe incorrecte et pages manquantes ; avertir lorsque la qualité est insuffisante.
3. **Extraction adaptée** : parser les tableurs ; extraire le texte d'un PDF natif ; appliquer l'OCR aux PDF scannés et aux photos ; utiliser des modèles dédiés pour l'écriture manuscrite lorsque les tests les justifient.
4. **Préservation de la provenance** : garder le fichier original de manière sécurisée pendant la durée nécessaire ; conserver page, zone/ligne source, texte reconnu et informations de confiance utiles.
5. **Normalisation** : gérer espaces, casse, accents, variations d'écriture, graphies arabes pertinentes, chiffres, unités et abréviations sans détruire l'original.
6. **Classification** : proposer le type de document ou d'opération : catalogue, stock initial, liste de dettes, achats, dépenses, etc.
7. **Mapping** : associer les colonnes et expressions aux champs métier normalisés.
8. **Rapprochement** : chercher les produits, clients ou fournisseurs candidats dans le seul tenant concerné.
9. **Revue humaine** : montrer côte à côte le document et les valeurs extraites ; permettre de corriger, rejeter, ignorer ou confirmer une ligne.
10. **Prévisualisation et validation** : expliquer les doublons possibles, les champs manquants, les unités, les prix et les quantités ambigus.
11. **Importation métier** : utiliser les services métier existants, avec transaction, idempotence, audit et contrôle tenant.
12. **Compte rendu** : nombre de lignes importées, ignorées et à corriger, sans perdre les raisons des rejets.
13. **Suppression** : permettre d'effacer les documents temporaires selon les règles de rétention, les besoins d'audit et les obligations applicables.

#### Documents mal documentés

Ne rejette pas un fichier uniquement parce que ses colonnes n'ont pas de titres, que les lignes sont dans un ordre inhabituel ou que les noms contiennent des erreurs. Essaie de déduire la structure à partir des valeurs, du voisinage, des unités, des formats numériques, du contexte du commerce et des correspondances précédemment confirmées.

Cependant :

- ne déduis pas automatiquement qu'une valeur est un prix d'achat ou de vente si le document ne permet pas de le savoir ;
- ne suppose pas qu'une quantité est un stock actuel plutôt qu'une quantité vendue ou achetée ;
- ne considère pas une similarité de noms comme une preuve d'identité ;
- ne fabrique pas une valeur absente ;
- ne transforme pas un solde initial en historique de transactions fictif.

Quand une interprétation reste ambiguë, afficher une question claire plutôt qu'une erreur technique.

#### Revue humaine

L'écran de revue doit permettre, autant que possible :

- aperçu de la source et de la transcription ;
- correction d'une ligne sans tout recommencer ;
- sélection parmi des produits candidats ;
- création d'un nouveau produit après vérification ;
- indication de l'unité et du type de prix ;
- traitement par lots des lignes similaires ;
- saut ou mise en attente d'une ligne ;
- sauvegarde de la progression et reprise ultérieure ;
- résumé final avec erreurs et éléments incertains.

#### Sécurité des fichiers

- Valider les types et les contenus, pas uniquement l'extension.
- Limiter les tailles, pages et dimensions selon une configuration documentée.
- Ne jamais exécuter les macros d'un classeur.
- Prévenir l'injection de formules dans les exports CSV/Excel en échappant les cellules dangereuses.
- Utiliser du stockage privé et des URL temporaires si un stockage objet est nécessaire.
- Prévoir un délai de rétention explicite et une suppression contrôlée.
- Ne pas envoyer des documents sensibles à un service tiers sans vérifier ses règles de conservation, d'entraînement, de localisation et de traitement.
- Ne pas journaliser le contenu complet de documents, prix, dettes, téléphones ou données personnelles par défaut.

### 12. OCR, IA, embeddings et fournisseur Jev

#### Principes

- Aucun modèle ne doit être choisi uniquement parce qu'il est gratuit, populaire ou récent.
- Benchmarker les candidats sur des exemples représentatifs et anonymisés des documents des commerçants ciblés.
- Commencer par des solutions open source/locales lorsque leur qualité, leur licence, leurs besoins matériels et les conditions commerciales conviennent.
- Distinguer OCR imprimé, OCR manuscrit, mise en page de tableaux, compréhension de document, embeddings et génération de réponses. Ce sont des fonctions différentes.
- Vérifier les licences exactes des poids, dépendances et bibliothèques avant une utilisation commerciale.
- N'envoyer aucun document privé vers une API par défaut sans une décision documentée.
- Ne jamais promettre de précision avant évaluation sur des cahiers représentatifs.

#### Pistes à évaluer, pas des choix présumés validés

- PaddleOCR ou une solution équivalente pour le texte imprimé et la structure des documents ;
- des modèles spécialisés de reconnaissance manuscrite française et arabe, évalués séparément ;
- un modèle d'embeddings multilingue pouvant rapprocher français et arabe ;
- un moteur de recherche textuelle/fuzzy et vectorielle ;
- un modèle de décision externe comme **Jev**, uniquement si l'API actuelle, la qualité, les prix, la licence et la confidentialité sont vérifiés.

Vérifie toujours les informations actuelles dans la documentation officielle du modèle ou fournisseur avant d'intégrer son API. N'invente pas son schéma d'appel, son prix, ses quotas ni sa capacité à comprendre des images.

#### Architecture par adaptateurs

Utilise des interfaces claires permettant de remplacer un fournisseur. Par exemple :

- `DocumentTextExtractor` ;
- `HandwritingRecognizer` ;
- `EmbeddingProvider` ;
- `CandidateMatcher` ;
- `DecisionProvider`.

Les noms ci-dessus sont indicatifs : adapte-les aux conventions du dépôt. Les modules métier ne doivent pas dépendre directement de la SDK d'un fournisseur.

#### Comportement lorsque l'IA est indisponible

Si un quota est épuisé, un fournisseur est indisponible ou une clé manque :

- utiliser les règles locales et l'extraction déterministe lorsque possible ;
- préserver le document et la progression ;
- proposer une revue manuelle ;
- expliquer la limitation sans exposer de détail confidentiel ;
- ne jamais basculer silencieusement vers une API payante.

#### Évaluation de la qualité

Mesurer, au minimum :

- taux de lignes correctement reconnues ;
- exactitude des prix, quantités, unités et signes ;
- qualité du rapprochement produit ;
- taux de faux positifs, notamment les fusions erronées ;
- proportion des lignes acceptées sans correction ;
- temps de correction humaine par page ;
- coût estimé par page et par document ;
- différences entre français, anglais, arabe et documents mixtes.

Les données d'évaluation doivent être anonymisées, autorisées et conservées sous contrôle. Documente la taille et les limites de chaque jeu d'essai.

### 13. Recherche de produits, aliases et embeddings

Les embeddings sont une aide à la recherche, pas une autorité métier. Le système doit combiner :

1. correspondance exacte après normalisation ;
2. alias validés propres à l'entreprise ;
3. similarité textuelle approximative ;
4. recherche vectorielle multilingue lorsque disponible ;
5. contraintes métier comme catégorie, marque, poids, dimensions, conditionnement et unité.

Conserve le nom original écrit par le commerçant. Toute normalisation ou traduction doit être stockée à part.

Un résultat de recherche ne doit jamais provoquer une fusion ou un écrasement irréversible. Si plusieurs candidats sont proches, demande une sélection. Si le catalogue est petit, ne rajoute pas de base vectorielle séparée sans preuve de besoin ; teste d'abord une architecture avec PostgreSQL et une solution vectorielle compatible.

Les vecteurs et métadonnées de recherche doivent respecter la séparation tenant. Les résultats et caches ne doivent pas mélanger les catalogues de différentes entreprises.

### 14. Offline, réseau instable et synchronisation

Les conditions réseau peuvent être irrégulières. Concevoir des opérations résistantes aux coupures est important, notamment pour la caisse et les imports.

Toute fonction réellement hors ligne doit définir :

- quelles données sont mises en cache localement ;
- quelles opérations sont autorisées hors ligne ;
- comment les opérations en attente sont chiffrées et synchronisées ;
- comment les conflits sont détectés et résolus ;
- comment éviter les doublons par idempotence ;
- ce qui arrive lorsque le stock ou le solde a changé sur le serveur ;
- comment l'utilisateur sait qu'une opération est locale, synchronisée ou en échec.

Ne conserve pas inutilement des données sensibles dans le navigateur. Ne prétends pas qu'une synchronisation fiable existe avant d'avoir testé la perte de réseau, les répétitions, la reprise, les conflits et plusieurs appareils.

Livrer d'abord une conception explicite et un périmètre limité plutôt qu'un mécanisme de synchronisation implicite et dangereux.

### 15. Paiements, Mobile Money et limites d'intégration

- Distinguer un enregistrement manuel d'un paiement et une confirmation électronique provenant d'un prestataire.
- Un paiement marqué « payé » par un utilisateur n'est pas la même chose qu'un paiement confirmé par webhook.
- Les webhooks doivent être authentifiés selon les exigences du fournisseur, idempotents, journalisés et vérifiés contre les événements dupliqués ou dans le désordre.
- Ne stocke pas de données de carte bancaire sensibles.
- N'annonce aucune intégration Wave, Orange Money, MTN Money ou GeniusPay comme active tant que credentials, webhooks, erreurs, statuts et tests de bout en bout n'ont pas été vérifiés.
- Les paiements en espèces et les Mobile Money saisis manuellement peuvent être pris en charge indépendamment d'une intégration automatique.
- Avant d'ajouter un agrégateur, vérifier le contrat, les tarifs, les conditions d'exploitation en Côte d'Ivoire et le processus de mise en production.

### 16. Reçus et imprimantes thermiques

Le produit doit utiliser le nom et le logo du commerce client sur les reçus. La marque Qadr Ops ne doit pas remplacer l'identité du client ; un texte discret « Propulsé par Qadr Ops » peut être facultatif si configuré.

- Prévoir des reçus adaptés aux largeurs papier thermiques courantes, notamment 58 mm et 80 mm, et un aperçu avant impression.
- Un `window.print()`/dialogue du navigateur ne prouve pas que l'impression est automatique.
- Tester au moins les navigateurs, les marges, la coupure, les caractères français/arabe, les montants et les longs noms de produits.
- Distinguer impression navigateur, enregistrement PDF et impression directe ESC/POS ; ne prétends pas que l'un remplace automatiquement les autres.
- Ne pas développer une couche d'impression universelle complexe avant de connaître les imprimantes pilotes ciblées et les appareils des commerçants.

### 17. Abonnements, essais et codes promotionnels

Qadr Agency doit pouvoir administrer les offres commerciales et, si retenu par le propriétaire, créer des codes de réduction ou d'accès d'essai configurables, par exemple 1 semaine, 3 semaines, 1 mois ou 3 mois.

Exigences :

- code généré côté serveur avec entropie suffisante ;
- période de validité, limite d'utilisation et états contrôlés ;
- règles explicites de cumul, expiration, réutilisation et rattachement au tenant ;
- vérification serveur, audit et gestion des tentatives abusives ;
- pas de possibilité pour un client de s'octroyer lui-même des jours d'abonnement en modifiant la requête ;
- affichage clair de la date de fin et des conséquences de l'expiration.

N'implémente pas de paiement d'abonnement réel sans accord concernant le prestataire, les prix et le processus de confirmation.

### 18. Données, confidentialité et journalisation

- Collecter le minimum nécessaire au fonctionnement.
- Définir des périodes de conservation pour les documents importés, fichiers temporaires, événements techniques et journaux.
- Ne pas inclure par défaut le texte complet des cahiers, les noms de clients, les montants de dette, les téléphones ou autres informations sensibles dans Sentry, PostHog ou les journaux.
- Masquer ou réduire les valeurs sensibles dans les erreurs.
- Prévoir suppression, export et correction des données selon le modèle produit et les obligations applicables.
- Documenter les prestataires tiers, les données partagées et les paramètres de confidentialité.
- Ne pas utiliser les documents privés des clients pour entraîner un modèle global sans base légitime, transparence et autorisation appropriée.
- Respecter les règles applicables à la Côte d'Ivoire et aux autres juridictions ciblées, après vérification juridique adaptée ; ne prétends pas que le logiciel est conforme à une réglementation sans audit.

### 19. Qualité du code et conventions

- Utiliser TypeScript strictement lorsque le projet TypeScript le permet ; éviter `any` sans justification.
- Valider les entrées côté serveur avec un schéma partagé lorsque pertinent.
- Garder les composants d'interface séparés des services métier et de l'accès à la base.
- Réutiliser les règles de calcul au lieu de les recopier dans plusieurs écrans.
- Concevoir des migrations petites, explicites et testables ; ne pas réécrire le schéma complet sans nécessité.
- Ajouter des index pour les requêtes réelles et tenant-aware, pas au hasard.
- Gérer les erreurs de façon cohérente, avec identifiant de corrélation sans exposer les secrets.
- Utiliser les tests de régression pour toute correction de bug.
- Documenter les décisions difficiles à deviner et les raisons de choix ; éviter les commentaires qui répètent simplement le code.
- Éviter les dépendances lourdes qui ne sont pas nécessaires et vérifier les licences des bibliothèques utilisées commercialement.
- Mettre à jour les fichiers lock lorsque les dépendances changent intentionnellement.

### 20. Tests et définition de « terminé »

Une fonctionnalité n'est pas terminée simplement parce que l'écran existe.

#### Tests généraux

- unitaires pour les calculs et règles métier ;
- tests d'intégration des services et accès aux données ;
- tests d'autorisation et d'isolation multi-tenant ;
- tests de validation des entrées et erreurs ;
- tests de doublons et d'idempotence ;
- tests des cas limites et retours arrière ;
- tests de localisation en français, anglais et arabe/RTL ;
- tests d'accessibilité et de comportement mobile pertinents ;
- tests du chemin principal depuis l'interface jusqu'à la persistance réelle, lorsque l'environnement le permet.

#### Tests des imports

Inclure des fichiers valides, vides, mal formés, très volumineux, des colonnes sans nom, des lignes dupliquées, des chiffres ambigus, des prix illisibles, des documents mixtes arabe/français, un même fichier envoyé deux fois, un dépassement de quota IA, une panne de fournisseur et une tentative d'accès au fichier d'un autre tenant.

#### Commandes de vérification

Découvre les scripts réels dans `package.json`, les fichiers de configuration et la documentation. Lancer les contrôles disponibles, par exemple :

- tests automatisés ;
- lint ;
- vérification TypeScript ;
- validation du schéma/migrations ;
- build de production.

Ne copie pas des commandes génériques si elles ne correspondent pas au dépôt. Note les commandes effectivement exécutées et leurs résultats. Si un test ne peut pas être lancé à cause d'un service indisponible, décris précisément le blocage et n'annonce pas le test comme réussi.

#### Définition de terminé

Une tâche est terminée quand :

- son comportement répond aux critères d'acceptation ;
- les erreurs et cas limites utiles sont traités ;
- les permissions sont vérifiées côté serveur ;
- les données sont validées et les écritures critiques idempotentes ;
- les tests appropriés passent ou les blocages sont explicitement documentés ;
- la documentation et les variables d'environnement sont à jour ;
- aucune donnée fictive ne peut être confondue avec des données réelles en production ;
- le compte rendu distingue faits, hypothèses et éléments non testés.

### 21. Coûts et dépendances externes

Le coût d'exploitation doit rester maîtrisé. Pour toute nouvelle technologie ou intégration, indiquer :

- coût initial éventuel ;
- coût mensuel minimal et hypothèses ;
- quotas et limites gratuites ;
- conditions d'utilisation commerciale ;
- coûts variables selon usage ;
- dépendance à un fournisseur et stratégie de sortie ;
- implications de confidentialité et de localisation des données ;
- comportement en cas de quota épuisé ou de panne.

Les offres gratuites, prix et quotas peuvent changer. Avant une décision financière, consulter la source officielle actuelle et noter la date de vérification. Ne bâtis pas une promesse commerciale sur une offre gratuite qui peut être supprimée ou limitée.

Prévoir si possible une télémétrie minimale des coûts par import ou page OCR, sans collecter le contenu privé du document. Une limite ou un budget configurable doit pouvoir interrompre les appels payants.

### 22. Roadmap d'exécution recommandée

Cette roadmap propose un ordre de travail. Elle n'autorise pas à tout coder en une seule livraison et doit être réconciliée avec l'état réel du dépôt.

#### Phase 0 — Audit et base de travail

- inspecter le dépôt et ses changements locaux ;
- confirmer l'application principale et ses commandes ;
- documenter l'architecture réelle et les lacunes ;
- confirmer les variables d'environnement requises sans exposer leurs valeurs ;
- établir un état de référence des tests et du build ;
- proposer un plan d'implémentation ordonné par risque et valeur métier.

#### Phase 1 — Socle sécurisé

- authentification et organisations ;
- sélection du commerce actif ;
- rôles et permissions ;
- isolation tenant côté serveur ;
- modèle de données et migrations contrôlées ;
- journal d'audit et idempotence des opérations critiques.

#### Phase 2 — Opérations métier cœur

- catalogue/produits sans dépendance obligatoire à un code-barres ;
- mouvements de stock ;
- ventes et paiements enregistrés ;
- clients et crédits ;
- fournisseurs, achats et dépenses ;
- rapports de base ;
- reçus avec identité du commerce.

Ne commence pas un module avancé si les services métier fondamentaux sont contradictoires ou insécurisés.

#### Phase 3 — Multilingue et accessibilité

- français/anglais/arabe ;
- RTL complet ;
- préférence de langue par utilisateur ;
- écrans de vente et de stock testés dans les trois langues ;
- libellés simples, actions visuelles et parcours mobile.

Cette capacité doit être préparée dans l'architecture dès le départ, même si toutes les traductions sont livrées de manière graduelle.

#### Phase 4 — Qadr Capture / Qadr Adapt

- import déterministe CSV/Excel ;
- PDF textuel et PDF scanné ;
- photos et prétraitement ;
- extraction OCR ;
- benchmark distinct pour manuscrit français et arabe ;
- mapping et recherche hybride ;
- revue humaine ;
- import sécurisé/idempotent et rapport de résultat.

La première version doit proposer un parcours complet sur un petit périmètre fiable avant d'étendre les formats et modèles.

#### Phase 5 — Fonctions SaaS de plateforme

- abonnement et codes promotionnels ;
- gestion Super Admin ;
- instrumentation et observabilité minimales ;
- sécurité de la gestion des fichiers ;
- limites d'usage et suivi des coûts.

#### Phase 6 — Intégrations avancées

- paiements en ligne réels après décision explicite ;
- impressions plus directes si les modèles d'imprimantes le justifient ;
- synchronisation hors ligne plus complète après conception et tests ;
- assistance audio et langues supplémentaires selon les observations terrain.

### 23. Priorités de décision

En cas de conflit entre rapidité, ergonomie, sécurité et complexité, utilise cet ordre :

1. sécurité et intégrité des données ;
2. exactitude des ventes, stocks, paiements et dettes ;
3. simplicité et utilité réelle pour le commerçant ;
4. qualité et récupérabilité des imports ;
5. coût total prévisible ;
6. évolutivité et extensibilité ;
7. sophistication technique.

Ne choisis pas une architecture plus complexe uniquement pour paraître moderne. Le produit doit d'abord résoudre les problèmes concrets des commerçants et pouvoir être exploité par une petite équipe.

### 24. Format obligatoire du compte rendu de l'agent

À la fin de chaque tâche substantielle, fournir un compte rendu concis structuré ainsi :

1. **Résultat** : ce qui fonctionne maintenant.
2. **Fichiers principaux** : fichiers créés ou modifiés et raison.
3. **Vérifications** : commandes exécutées et résultat exact.
4. **Sécurité et données** : contrôles pertinents ajoutés ou non encore couverts.
5. **Limites connues** : les choses qui ne sont pas terminées ou pas testées.
6. **Prochaine étape recommandée** : une seule étape logique et prioritaire.

Ne dis jamais « tout est terminé » si des parties essentielles ne sont que des maquettes, des mocks, des données en mémoire, des intégrations non testées ou des appels simulés.

### Directive finale

Construis Qadr Ops comme un logiciel de commerce sérieux, pas comme une simple démonstration visuelle. La simplicité doit se voir dans l'expérience du commerçant ; la rigueur doit être assurée dans les services métier, la base de données, la sécurité et les tests. Préserve le dépôt, avance par incréments vérifiables et distingue toujours ce qui est réellement fonctionnel de ce qui reste à construire.
