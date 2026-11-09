# Environnements Vercel de Qadr Ops

## 1. Objet

Date : **2026-11-09**. Branche inspectée : `feat/mission-13-reprise`. Application : `apps/web` (Next.js 16.4.2, webpack, Node 24.x, Neon, Better Auth 1.7.7).

Ce document fait l'inventaire, par lecture du code, de ce qu'il faut régler sur Vercel pour chaque environnement (*Development*, *Preview*, *Production*) :
- les variables d'environnement réellement lues ;
- les réglages du projet ;
- les crons ;
- les risques constatés ;
- les actions manuelles du propriétaire.

Il complète `docs/production-setup-guide.md`, dont plusieurs passages sont périmés (voir § 7.3), et `docs/architecture/cloudflare-vercel-ownership.md` (décision D-01 : Vercel exécute Next.js, Cloudflare est devant).

**Méthode et limites.**
- L'inventaire vient de recherches sur `process.env.*`, `process.env[...]`, les fonctions qui reçoivent `source = process.env` (`readEnvironment`, `readGeniusPayConfig`, `readStorageConfig`, `storagePolicy`, `billingAppUrl`, `resolveEmailTransport`, `isLocalPreview`) et les noms construits dynamiquement (`QADR_STORAGE_${…}`).
- Les recherches ont porté sur `src/`, `scripts/`, `sentry.*.config.ts`, `next.config.ts`, `drizzle.config.ts`, `cloudflare/` et les bibliothèques `better-auth` / `@better-auth/*`.
- Aucun fichier `.env*` autre que `.env.example` n'a été lu.
- **Rien n'a été exécuté contre Vercel ou un service externe par l'auteur de ce document.** Constat du 2026-11-09 (mission 15) : l'équipe Vercel `qadragency` existe, et le projet Neon `qadr-data-base` (`aws-us-east-1`, PostgreSQL 18) y a été créé par l'intégration Vercel Marketplace ; sa branche `main` (production) est vide, la branche `mission-14-staging` porte la base `qadr_staging` migrée (25 migrations). L'accès MCP à l'équipe Vercel demandait une nouvelle autorisation : la liste des projets n'a pas pu être relue.
- Les limites des offres Vercel citées (durées, crons, taille des corps) viennent de la documentation déjà recopiée dans le dépôt (`docs/qadr-capture-models.md` § 133, `docs/rate-limiting.md`). Elles **n'ont pas été revérifiées en ligne** pour ce document. Relisez la page officielle au moment de configurer et notez la date.

## 2. Réglages du projet Vercel

| Réglage | Valeur attendue | Preuve dans le dépôt | Remarque |
| --- | --- | --- | --- |
| Root Directory | `apps/web` | `apps/web/vercel.json`, `apps/web/package.json`, migrations dans `apps/web/drizzle` | La racine contient le MVP historique (`package.json` suivi par Git) ; ne jamais construire depuis la racine. |
| Include files outside Root Directory | Désactivé | Aucun import hors de `apps/web`. `outputFileTracingRoot: process.cwd()` (`next.config.ts:8`) | — |
| Framework | Next.js | — | — |
| Install Command | `npm ci` | `apps/web/package-lock.json` | Jamais `npm install`, qui réécrit le lockfile. Installe aussi `@opennextjs/cloudflare` et `wrangler` (préparation Workers inutilisée) : sans effet sur le build Vercel, mais du temps et 4 alertes `npm audit` (décision D-06). |
| Build Command | **`npm run build`, fixé explicitement** | `package.json` : `"build": "next build --webpack"` | En Next.js 16, `next build` sans option utilise **Turbopack** (`node_modules/next/dist/docs/01-app/01-getting-started/01-installation.md:157`). Un `next build` nu produirait un build non testé. |
| Output Directory | Par défaut (`.next`) | `next.config.ts:7` (`.next-preview` seulement si `NODE_ENV=development` et `QADR_PREVIEW_MODE=true`) | — |
| Node.js | 24.x | `package.json` → `"engines": { "node": "24.x" }` | Le pilote Neon exige `WebSocket` global (`src/lib/db/client.ts:10-12`). |
| Runtime des fonctions | Node.js partout | 93 routes sur 94 déclarent `export const runtime = "nodejs"`. La 94ᵉ, `api/observability/sentry-test`, répond 404 hors développement. Aucune route `edge`. `src/proxy.ts` tourne en Node.js par défaut en Next 16 (doc Next `16-proxy.md`, l. 255). | `sentry.edge.config.ts` n'est donc chargé par aucun chemin actif. |
| Fluid Compute | Activé (défaut des nouveaux projets, à vérifier) | `attachDatabasePool(pool)` (`src/lib/db/client.ts:17`) | Pool Neon partagé par instance, libéré avant la mise en veille. |
| Région des fonctions | **Même région que Neon**, par exemple `fra1` avec Neon `aws-eu-central-1` | `vercel.json` ne fixe aucune région | Vercel utilise une région américaine par défaut : chaque requête paierait l'aller-retour transatlantique vers une base européenne. |
| Durée maximale | Défaut de l'offre, sauf `/api/cron/subscriptions` : `maxDuration = 300` (mission 15). | `api/cron/subscriptions/route.ts` | R2 corrigé (§ 5). |
| Taille des corps | 4,5 Mo (requête et réponse, limite Vercel) | Import : 2 Mo (`src/lib/imports/spreadsheet.ts:12`, contrôlé avant `formData()` dans `api/business/imports/route.ts:21`). Webhook GeniusPay : 64 Kio (`api/webhooks/geniuspay/route.ts:8`). Export complet : archive ≤ 4 Mo (`DATA_EXPORT_LIMITS.archiveBytes`, `src/lib/domain/data-export.ts:38`). | **Exports de rapport XLSX : aucune borne en octets** (risque R8). |
| En-têtes de sécurité | Servis par Next.js | `next.config.ts:5` → `src/lib/security-headers.ts` : CSP `frame-ancestors 'none'…`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS seulement si `NODE_ENV=production` (donc aussi en Preview) ; `/sw.js` en `no-store` | `poweredByHeader: false`. La CSP ne restreint pas les scripts (choix documenté). |
| Webhook GeniusPay | Corps brut | `request.text()` puis vérification HMAC sur les octets reçus (`api/webhooks/geniuspay/route.ts:20-22`, `src/lib/billing/geniuspay.ts:76-94`) | Ne placer devant cette route aucun proxy ni règle qui réécrit le corps. `src/proxy.ts` ne couvre pas `/api/*` (`matcher`, l. 19). |
| Cache | Rien de public sur `/api/*` ni sur les pages connectées | 59 fichiers de route posent `cache-control` (`no-store` ou `private, no-store`). Les trois GET sans en-tête explicite (`api/auth/[...all]`, deux crons) sont dynamiques et sans `s-maxage`. Aucun `revalidate`, `"use cache"` ni `unstable_cache`. | Si Cloudflare passe en proxy (D-04), ajouter une règle de contournement du cache pour `/api/*`, `/business/*`, `/platform/*`. |
| Déploiements automatiques | À décider avant de relier le dépôt | — | Relier le dépôt déploie à chaque push (règle D-02 : aucun push sans accord). Prévoir un *Ignored Build Step* ou une liste de branches. |
| Deployment Protection | Activée sur Preview | `docs/production-setup-guide.md` § 4.2 | Bloque aussi les webhooks et les appels de cron manuels vers Preview (risque R6). |

## 3. Matrice des variables

Légende :
- **Secret** : oui = à cocher *Sensitive* dans Vercel. « Public » = copié dans le JavaScript du navigateur au build (`NEXT_PUBLIC_*`), donc un redéploiement est nécessaire après chaque changement.
- **Dev** = environnement *Development* de Vercel (`vercel env pull`, `vercel dev`). En local, le projet utilise `apps/web/.env.local` ou `npm run preview`.

### 3.1 Variables lues par l'application (46)

| Variable | Service | Lue dans | Dev | Preview | Production | Secret ? | Si absente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Next.js | `env.ts:6`, `next.config.ts:6-7`, `auth/server.ts:83,303-315`, `billing/geniuspay.ts:61`, `billing/index.ts:17`, `storage/config.ts:73`, `preview/mode.ts:6`, `proxy.ts:11`, 15 pages `app/business/**` | Ne pas définir | Ne pas définir (**Vercel met `production` aussi en Preview**) | Ne pas définir | Non | Fournie par Next.js |
| `NEXT_RUNTIME` | Next.js | `src/instrumentation.ts:6,9` | Ne pas définir | Ne pas définir | Ne pas définir | Non | Fournie par Next.js |
| `VERCEL_ENV` | Vercel | `billing/geniuspay.ts:62` | Fournie (`development`) | Fournie (`preview`) | Fournie (`production`) | Non | Sans elle (hors Vercel), une clé GeniusPay sandbox est refusée en production |
| `DATABASE_URL` | Neon | `env.ts:7,73-77` → `db/client.ts:33`, `auth/server.ts:310-314`, `scripts/check-database.ts`, `platform-admin.ts`, `platform-owner.ts` | Branche Neon de développement, ou rien (`npm run preview` la retire, `scripts/preview.mjs:10`) | Chaîne **pooled** (`-pooler`) de la branche **staging** | Chaîne **pooled** de la branche **main** | Oui | Better Auth refuse de démarrer (`auth/server.ts:310-311`) ; toute route métier échoue (`requireDatabaseUrl`) |
| `DATABASE_URL_UNPOOLED` | Neon | `env.ts:9,83-92`, `drizzle.config.ts:6` | Facultative (terminal) | **Ne pas définir** : l'application ne la lit pas | **Ne pas définir** | Oui | Les migrations utilisent `DATABASE_URL` |
| `BETTER_AUTH_SECRET` | Better Auth | `env.ts:10`, `auth/server.ts:310-314`, `auth/platform-request.ts:20` (clés HMAC de limitation), `scripts/platform-owner.ts:62` | Valeur locale ≥ 32 car. | Valeur **propre** ≥ 32 car. | Valeur **propre** ≥ 32 car. | Oui | Refus de démarrer (`server.ts:310`). Valeur de repli `qadr-preview-only-…` dans `platform-request.ts:20`, voir R4. |
| `BETTER_AUTH_URL` | Better Auth, GeniusPay, Turnstile | `env.ts:11`, `auth/server.ts:116,122,305,313`, `auth/platform-request.ts:13-14`, `billing/index.ts:14`, `api/public/campaigns/check/route.ts:31` | `http://localhost:3000` | **Domaine fixe HTTPS** (par exemple `https://staging.<domaine>`) | `https://app.<domaine>` (adresse canonique, sans barre finale) | Non | En production (Preview compris) : refus de démarrer si absente ou non HTTPS (`env.ts:65-71`, `server.ts:313`) ; GeniusPay désactivé (`billing/index.ts:17,31-33`) |
| `NEXT_PUBLIC_AUTH_URL` | Better Auth (client) | `auth/client.ts:7`, `env.ts:12` | Laisser vide | **Laisser vide** (origine courante) | **Laisser vide**, ou = `BETTER_AUTH_URL` | Public | Origine courante. **Ne jamais la déclarer avec une valeur vide** : `z.string().url()` refuse `""` et casse l'authentification (R4). |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile | `env.ts:13,45`, `auth/server.ts:308,316`, `api/public/campaigns/check/route.ts:33` | Clé de test `1x…AA` (ou rien) | **Vraie clé** du widget staging | **Vraie clé** du widget production | Oui | Production : connexion, inscription, réinitialisation et vérification de campagne refusées (`turnstile.ts:37-38`). Clés de test refusées en production **et en Preview** (`turnstile.ts:18-19,40`). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile | `components/auth/turnstile-widget.tsx:10`, `env.ts:14,45`, `auth/server.ts:308,316` | Clé de test `1x…AA` | Clé du widget staging | Clé du widget production | Public | Comme ci-dessus ; une seule des deux clés : `readEnvironment` lève une erreur (`env.ts:45-46`) |
| `RESEND_API_KEY` | Resend | `env.ts:15,54`, `auth/email.ts:127-130` | Vide (aucun envoi) ou clé de test | Clé limitée au domaine d'envoi | Clé *Sending access* limitée au domaine | Oui | Aucun e-mail. En production (Preview compris), une invitation exige une adresse vérifiée (`server.ts:76-85`) : sans Resend, **personne ne peut rejoindre un commerce**. |
| `RESEND_FROM_EMAIL` | Resend | idem | idem | Adresse du domaine vérifié | Adresse du domaine vérifié | Non | Avec la précédente, sinon erreur (`env.ts:54-55`) |
| `RESEND_REPLY_TO` | Resend | `env.ts:17`, `auth/email.ts:127,130` | Facultative | Facultative | Boîte de support lue | Non | Pas d'adresse de réponse. Une valeur qui n'est pas un e-mail casse `readEnvironment`. |
| `GOOGLE_CLIENT_ID` | Google OAuth | `env.ts:29,48,102` | Facultative | Client OAuth de test (redirection staging) | Client OAuth de production | Non | Bouton Google masqué |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | idem | Facultative | Avec la précédente | Avec la précédente | Oui | Paire incomplète : erreur (`env.ts:48-49`) |
| `APPLE_CLIENT_ID` | Apple | `env.ts:31,51,103-104` | Facultative | Services ID de test | Services ID | Non | Bouton Apple masqué ; aussi masqué si `BETTER_AUTH_URL` n'est pas HTTPS (`env.ts:100-104`) |
| `APPLE_CLIENT_SECRET` | Apple | idem | Facultative | JWT ES256 ≤ 6 mois | JWT ES256 ≤ 6 mois, à renouveler | Oui | Paire incomplète : erreur (`env.ts:51-52`) |
| `APPLE_APP_BUNDLE_IDENTIFIER` | Apple | `env.ts:34,104` | — | Facultative | Facultative (application iOS) | Non | Aucun effet |
| `SENTRY_DSN` | Sentry | `sentry.server.config.ts:3`, `sentry.edge.config.ts:3`, `env.ts:18`, `api/observability/sentry-test/route.ts:6` | Facultative | DSN du projet | DSN du projet | Non (recommandé *Sensitive*) | Aucune erreur serveur envoyée. Valeur qui n'est pas une URL : `readEnvironment` échoue (R4). |
| `SENTRY_ENVIRONMENT` | Sentry | `sentry.*.config.ts:8`, `env.ts:20` | `development` | `preview` | `production` | Non | Événements étiquetés `development`, même en production (R12) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry | `src/instrumentation-client.ts:3`, `env.ts:19` | Facultative | DSN | DSN | Public | Aucune erreur navigateur envoyée |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Sentry | `instrumentation-client.ts:8`, `env.ts:21` | `development` | `preview` | `production` | Public | `development` |
| `SENTRY_TEST_ENABLED` | Sentry | `api/observability/sentry-test/route.ts:4` | `true` seulement pour l'essai | **Ne pas définir** | **Ne pas définir** | Non | Route 404 (active seulement si `NODE_ENV=development`) |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog | `lib/analytics/client.ts:20,42`, `env.ts:22` | Vide | Clé `phc_…` d'un projet de test (facultative) | Clé `phc_…` (facultative) | Public | Analytique éteinte |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog | `analytics/client.ts:20,43`, `env.ts:23` | — | `https://eu.i.posthog.com` | `https://eu.i.posthog.com` | Public | Analytique éteinte : le défaut du schéma serveur ne s'applique pas dans le navigateur. Valeur vide : `readEnvironment` échoue. |
| `VAPID_PUBLIC_KEY` | Web Push | `lib/notifications/server.ts:8`, `env.ts:24` (87 caractères base64url) | Paire de développement | **Paire propre** | **Paire propre**, jamais changée ensuite | Non (servie au navigateur par `/api/notifications/push-config`) | Push désactivé, notifications internes actives. Mauvais format : `readEnvironment` échoue (R4). |
| `VAPID_PRIVATE_KEY` | Web Push | `notifications/server.ts:9`, `env.ts:25` (43 caractères) | idem | idem | idem | Oui | idem |
| `VAPID_SUBJECT` | Web Push | `notifications/server.ts:10`, `env.ts:26` | `mailto:…` | `mailto:…` | `mailto:` d'une boîte lue | Non | Push désactivé |
| `CRON_SECRET` | Vercel Cron | `api/cron/subscriptions/route.ts:22-26`, `api/internal/notifications/process/route.ts:15` (via `cron-auth.ts`) | Facultative | Valeur **propre** ≥ 32 car. (appels manuels seulement) | Valeur ≥ 32 car. ; Vercel l'envoie en `Authorization: Bearer` | Oui | `/api/cron/subscriptions` répond 404, les notifications 401 : ni expiration, ni rapprochement GeniusPay, ni purge |
| `NOTIFICATIONS_CRON_SECRET` | Planificateur externe | `api/internal/notifications/process/route.ts:15`, `env.ts:27` (≥ 32 car.) | — | Ne pas définir | Seulement si un planificateur externe appelle en `POST` | Oui | Seul `CRON_SECRET` est accepté. **Moins de 32 caractères : `readEnvironment` échoue, et l'authentification avec** (R4). |
| `R2_ACCOUNT_ID` | Cloudflare R2 | `storage/config.ts:57,63,78` (32 hex) | Facultative | Compte Cloudflare | Compte Cloudflare | Non | Sans les quatre variables : aucun stockage (l'import fonctionne sans garder l'original) |
| `R2_BUCKET_NAME` | R2 | idem | — | Bucket **de test** (`qadr-ops-fichiers-staging`) | Bucket de production | Non | idem ; configuration partielle : erreur (`config.ts:70-72`) |
| `R2_ACCESS_KEY_ID` | R2 | idem | — | Jeton du bucket de test | Jeton du bucket de production | Oui | idem |
| `R2_SECRET_ACCESS_KEY` | R2 | idem | — | idem | idem | Oui | idem |
| `R2_JURISDICTION` | R2 | `storage/config.ts:61,78` | — | `eu` si le bucket l'est | `eu` si le bucket l'est | Non | Point d'accès global |
| `QADR_FILE_STORAGE` | Stockage | `storage/config.ts:74,84` | `memory` possible | **Ne pas définir** (refusé : Preview tourne avec `NODE_ENV=production`) | **Ne pas définir** (refusé, `config.ts:74-76`) | Non | — |
| `QADR_STORAGE_IMPORT_MAX_BYTES` | Stockage | `storage/config.ts:50` (borne 20 Mio) | Facultative | Facultative | Facultative (défaut 2 Mio) | Non | 2 Mio. Hors bornes : erreur. |
| `QADR_STORAGE_IMPORT_RETENTION_DAYS` | Stockage | `storage/config.ts:51` | Facultative | Facultative | Facultative (défaut 90) | Non | 90 jours |
| `QADR_STORAGE_EXPORT_MAX_BYTES` | Stockage | `storage/config.ts:50` (borne 50 Mio) | — | — | Facultative (finalité pas encore branchée) | Non | 10 Mio |
| `QADR_STORAGE_EXPORT_RETENTION_DAYS` | Stockage | `storage/config.ts:51` | — | — | Facultative | Non | 7 jours |
| `GENIUSPAY_API_KEY` | GeniusPay | `billing/geniuspay.ts:51,56` | `pk_sandbox_…` ou rien | **`pk_sandbox_…` uniquement** | `pk_live_…` | Oui | Paiement en ligne annoncé indisponible ; webhook 503 |
| `GENIUSPAY_API_SECRET` | GeniusPay | `geniuspay.ts:52,57` | `sk_sandbox_…` | **`sk_sandbox_…` uniquement** | `sk_live_…` | Oui | idem ; préfixes discordants refusés (`geniuspay.ts:58-59`) |
| `GENIUSPAY_WEBHOOK_SECRET` | GeniusPay | `geniuspay.ts:53,60` | `whsec_…` sandbox | `whsec_…` sandbox | `whsec_…` live | Oui | idem |
| `GENIUSPAY_BASE_URL` | GeniusPay | `geniuspay.ts:65-66` | Facultative | Facultative | Facultative (défaut `https://geniuspay.ci/api/v1/merchant`) | Non | Défaut. Non HTTPS ou hôte hors `geniuspay.ci`/`genius.ci` : refus (mission 15). |
| `QADR_PREVIEW_MODE` | Aperçu local | `next.config.ts:7`, `preview/mode.ts:6`, `preview/database.ts:23`, `auth/server.ts:83,303`, `proxy.ts:11`, `storage/config.ts:84`, 15 pages | `false` (le lanceur la met lui-même) | **Ne pas définir** | **Ne pas définir** | Non | Sans effet hors `NODE_ENV=development` |
| `PORT` | Aperçu local | `auth/server.ts:305`, `scripts/preview.mjs:12` | Facultative | Ne pas définir | Ne pas définir | Non | 3001 en aperçu |

### 3.2 Variables des scripts et des tests (12) : jamais dans Vercel

| Variable | Lue dans | Rôle | Secret ? |
| --- | --- | --- | --- |
| `QADR_DB_TARGET` | `scripts/migrate.ts:11` (doit valoir `development`), `platform-admin.ts:29-34`, `platform-owner.ts:58-73` (`development` ou `production`) | Garde-fou de cible, posé dans le terminal | Non |
| `QADR_OWNER_USERNAME`, `QADR_OWNER_EMAIL`, `QADR_OWNER_NAME` | `scripts/platform-owner.ts:66,76` | Compte propriétaire de la plateforme | Non |
| `QADR_OWNER_PASSWORD` | `scripts/platform-owner.ts:76-86` | Mot de passe du propriétaire, saisi dans le terminal puis effacé | **Oui** |
| `QADR_PREVIEW_HOSTNAME` | `scripts/preview.mjs:16` | Restreint l'aperçu à `127.0.0.1` pendant un tunnel | Non |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_PATH` | `scripts/apple-client-secret.mjs:39-42` (avec `APPLE_CLIENT_ID`) | Fabrication du JWT Apple ; la clé `.p8` reste sur le poste | Chemin seulement |
| `BENCH_RUNS` | `scripts/bench-pglite.ts:31` | Mesures locales | Non |
| `QADR_TEST_POSTGRES_URL`, `QADR_TEST_POSTGRES_TARGET` | `src/test/postgres-harness.ts:26-29` | Tests sur la branche Neon de staging (`TARGET=staging` exigé) | URL : oui |

Les scripts k6 (`apps/web/load-tests/`) lisent `__ENV.QADR_LOAD_*` (7 noms). Ce sont des variables de k6, pas de `process.env`, et jamais de Vercel.

### 3.3 Variables lues par Better Auth lui-même : ne pas définir

| Variable | Lue dans | Effet si définie |
| --- | --- | --- |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `node_modules/better-auth/dist/context/helpers.mjs:83-84` | **Ajoute des origines de confiance** à celle de `BETTER_AUTH_URL` (`server.ts:122`), ce qui élargit la protection CSRF. Ne jamais la créer. |
| `AUTH_SECRET`, `BETTER_AUTH_SECRETS` | `better-auth/dist` | Secrets de repli ou de rotation. Le code passe toujours `secret` explicitement : ne pas les créer, pour éviter toute ambiguïté. |
| `VERCEL_URL`, `NEXTAUTH_URL` | `better-auth/dist/client/config.mjs:13-19` | Base du client d'authentification **côté serveur** quand `NEXT_PUBLIC_AUTH_URL` est vide. `VERCEL_URL` est fournie par Vercel ; ne pas définir `NEXTAUTH_URL`. |
| `BETTER_AUTH_TELEMETRY` (+ `_DEBUG`, `_ENDPOINT`, `_ID`) | `@better-auth/telemetry/dist/node.mjs:449` | Désactivée par défaut. Ne pas l'activer : elle enverrait des données à un tiers non répertorié dans `docs/privacy/`. |

**Total : 46 variables lues par l'application, dont 3 fournies par la plateforme (`NODE_ENV`, `NEXT_RUNTIME`, `VERCEL_ENV`), et 12 réservées aux scripts et tests, soit 58 noms. S'y ajoutent les 9 noms lus par la bibliothèque ci-dessus : `VERCEL_URL`, fournie par Vercel, et 8 autres à ne pas créer.** Les variables du MVP (`QADR_SESSION_SECRET`, `QADR_DATA_FILE`, `QADR_BOOTSTRAP_ADMIN_*`) et `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` ne sont pas lues par `apps/web`.

### 3.4 Garde-fous du code contre une mauvaise combinaison

| Garde-fou | Où | Ce qu'il refuse | Limite |
| --- | --- | --- | --- |
| URL publique HTTPS | `env.ts:65-71`, `auth/server.ts:313` | `BETTER_AUTH_URL` absente ou en `http://` quand `NODE_ENV=production` (Preview compris) | **`http://localhost` reste admis en production** (pour `next start` local) : une valeur `localhost` copiée dans Vercel passerait le contrôle et casserait cookies, e-mails et Turnstile. |
| Secret Better Auth | `auth/server.ts:310-311` | Secret absent ou de moins de 32 caractères | — |
| Paires obligatoires | `env.ts:45-56`, `storage/config.ts:69-72`, `geniuspay.ts:54-55` | Turnstile, Google, Apple, Resend, R2 (4) et GeniusPay (3) incomplets | Turnstile, Google, Apple et Resend lèvent une erreur dans `readEnvironment` : toute l'authentification tombe (R4). |
| Turnstile en production | `turnstile.ts:37-40` | Absence de clés, clés de test officielles | S'applique aussi en Preview (`NODE_ENV=production`). |
| Turnstile : domaine et action | `turnstile.ts:66-69`, `server.ts:116` | Jeton émis pour un autre nom d'hôte que celui de `BETTER_AUTH_URL` | Les URL aléatoires `*.vercel.app` échouent. |
| Origine de confiance | `server.ts:122` | Toute origine autre que `BETTER_AUTH_URL` (+ Apple) | Connexion impossible sur une URL Preview non canonique. |
| Clé GeniusPay sandbox | `geniuspay.ts:61-63` | Clé `sandbox` si `NODE_ENV=production` et `VERCEL_ENV≠preview` | — |
| Clé GeniusPay live | `geniuspay.ts` | Clé `live` si `NODE_ENV≠production`, ou si `VERCEL_ENV` est défini et ≠ `production` | Refusée en Preview depuis la mission 15 (R1 corrigé, test `geniuspay.test.ts`). |
| Environnement du paiement | `docs/billing-geniuspay.md` l. 46 | Webhook ou relecture d'un autre environnement (`environment_mismatch`) | — |
| Retours GeniusPay | `billing/index.ts:13-19,31-33` | `BETTER_AUTH_URL` non HTTPS en production | — |
| Stockage en mémoire | `storage/config.ts:73-76,84` | `QADR_FILE_STORAGE=memory` et mémoire implicite quand `NODE_ENV=production` | — |
| Aperçu PGlite | `preview/mode.ts:6`, `preview/database.ts:23-25`, `db/client.ts:32`, `scripts/preview.mjs:4-10` | Base de démonstration hors `NODE_ENV=development` ; accès à Neon pendant l'aperçu | — |
| Secret de cron | `api/cron/subscriptions/route.ts:23-26`, `cron-auth.ts:7-14` | Secret absent ou de moins de 32 caractères (404 ou 401), comparaison en temps constant | — |
| Route de test Sentry | `sentry-test/route.ts:4` | Toute exécution hors `NODE_ENV=development` | — |
| Scripts de base | `migrate.ts:11-22`, `platform-admin.ts:29-38`, `platform-owner.ts:58-73` | Cible non déclarée, phrase de confirmation exigée, hôte affiché | `migrate.ts` n'a pas de cible `production` (volontaire, `production-setup-guide.md` § 5.2). |

## 4. Séparation des environnements et bases Neon

### 4.1 Ce que Vercel change en Preview

Sur Vercel, `NODE_ENV=production` dans **Preview comme en Production**. Seule `VERCEL_ENV` les distingue, et le code ne la lit qu'à un seul endroit (`geniuspay.ts:62`). En Preview, par conséquent :
- `BETTER_AUTH_URL` HTTPS est obligatoire (`env.ts:65-71`) ;
- les cookies sont `Secure` (`server.ts:228`) et HSTS est envoyé (`security-headers.ts:17`) ;
- Turnstile exige de vraies clés (`turnstile.ts:40`) ;
- une invitation exige une adresse vérifiée, donc Resend (`server.ts:76-85`) ;
- le stockage en mémoire est interdit : R2 (bucket de test) ou aucun stockage ;
- seules les clés GeniusPay sandbox sont acceptées (R1 corrigé en mission 15).

### 4.2 Plan recommandé

| | Development | Preview | Production |
| --- | --- | --- | --- |
| Où | Poste local : `npm run preview` (PGlite, sans Neon) ou `npm run dev` + `.env.local` | Déploiements de branche, **un domaine fixe** (`staging.<domaine>`) rattaché à une branche Git | Domaine canonique `app.<domaine>` |
| Base Neon | Aucune, ou une branche `dev` dédiée | Branche **`staging`**, migrée (seule branche migrée à ce jour, mission 14). **Jamais `main`.** | Branche **`main`**, **jamais migrée à ce jour** : migration sur autorisation écrite seulement |
| `DATABASE_URL` | Branche `dev` (ou rien) | Chaîne *pooled* de `staging` | Chaîne *pooled* de `main` |
| Chaîne directe | Terminal seulement | Terminal seulement (`DATABASE_URL_UNPOOLED`, `QADR_TEST_POSTGRES_URL`) | Terminal seulement, au moment d'une migration autorisée |
| Secrets (`BETTER_AUTH_SECRET`, `CRON_SECRET`, VAPID) | Valeurs locales | Valeurs propres à Preview | Valeurs propres à Production |
| GeniusPay | Sandbox ou rien | **Sandbox uniquement**, webhook sandbox → domaine staging | Live, webhook live → domaine de production |
| Turnstile | Clés de test | Widget « staging » (nom d'hôte staging) | Widget « production » (nom d'hôte exact) |
| R2 | ~~Élevée~~ **Corrigé (mission 15)** | Le cron quotidien pouvait dépasser la durée maximale avant d'expirer les abonnements. | `api/cron/subscriptions/route.ts`, `subscription-billing.ts` | `maxDuration = 300` et budget de 120 s pour le rapprochement ; test ajouté. |
| Resend | Rien (l'interface le dit) | Clé de test sur le domaine d'envoi | Clé de production |
| Sentry / PostHog | Rien | Environnement `preview` | Environnement `production` |
| Crons | — | **Ne tournent pas** (Vercel Cron : production seulement) | `vercel.json` |

Règles :
1. **Ne jamais utiliser la portée « All Environments »** pour une variable secrète ou pour `DATABASE_URL`. Saisir chaque valeur environnement par environnement.
2. **Intégration Neon ↔ Vercel** : si elle est installée, elle peut créer une branche Neon par déploiement Preview et injecter elle-même `DATABASE_URL`, `DATABASE_URL_UNPOOLED` et des variables `PG*`/`POSTGRES_*` (ignorées par le code). Une telle branche, issue de `main`, ne serait pas migrée par le build : aucune migration n'a lieu au build, et c'est voulu. Recommandation : ne pas activer la création automatique de branches, et saisir les chaînes à la main (à trancher, voir § 8).
3. Les variables *Development* de Vercel finissent dans `.env.local` via `vercel env pull`, et `next dev` recharge `.env.local` (`db/client.ts:27-29`). N'y mettre aucune valeur de production.
4. Une variable Preview s'applique à toutes les branches. Pour que seul le domaine staging reçoive les secrets, utiliser la portée par branche de Vercel (à vérifier dans l'offre choisie) ou n'avoir qu'une branche de préproduction.

## 5. Crons

| Route | `vercel.json` | `cron-schedule.ts` (`CRON_ROUTES`) | `wrangler.jsonc` (inutilisé) | Contenu | Auth |
| --- | --- | --- | --- | --- | --- |
| `GET /api/cron/subscriptions` | `0 1 * * *` | `0 1 * * *` | `0 1 * * *` | Rapprochement GeniusPay (≤ 50 paiements), expiration, purge R2 (≤ 100 + 100), purge `rate_limit_bucket` | `CRON_SECRET`, sinon 404 |
| `GET`/`POST /api/internal/notifications/process` | `0 7 * * *` | `0 7 * * *` | `0 7 * * *` | Échéances d'abonnement, boîte d'envoi (100 au plus) | `CRON_SECRET` ou `NOTIFICATIONS_CRON_SECRET`, sinon 401 |

- **Cohérence** : les trois déclarations concordent. `src/lib/cron-schedule.test.ts:25-31` le vérifie pour `wrangler.jsonc` et `vercel.json`.
- **Fuseau** : Vercel Cron est en UTC, ce qui correspond à l'heure d'Abidjan (UTC+0).
- **Offres** : deux crons quotidiens restent compatibles avec la fréquence minimale de l'offre Hobby (une exécution par jour, heure approximative). Mais Hobby est réservée à un usage **non commercial** : Qadr Ops relève de Pro. Nombre de crons, précision et durée maximale par offre : **à vérifier** sur la documentation Vercel actuelle.
- **Production seulement** : la branche `staging` ne reçoit jamais d'expiration, de rapprochement ni de purge automatiques. Pour les tester, il faut appeler la route à la main sur le domaine staging avec le `CRON_SECRET` de Preview, ce qui se heurte à la *Deployment Protection* (R6).
- **Durée** (corrigé en mission 15) : la route exporte `maxDuration = 300`, et le rapprochement GeniusPay s'arrête après 120 s (`budgetMs`) ; les tentatives restantes (`deferred`) attendent le passage suivant, l'expiration des abonnements et les purges ont donc toujours lieu (test `subscription-billing.http.test.ts`).
- **Commentaire périmé** : `cron-schedule.ts:1-6` parle encore des Cron Triggers Cloudflare et de « l'ancien Vercel Cron ». C'est l'inverse depuis D-01.

## 6. Risques et incohérences

Classés par gravité. Aucun n'a été corrigé : ce document ne modifie aucun autre fichier.

| # | Gravité | Constat | Preuve | Proposition |
| --- | --- | --- | --- | --- |
| R1 | ~~Élevée~~ **Corrigé (mission 15)** | Une clé GeniusPay live était acceptée en Preview (`NODE_ENV=production`). | `billing/geniuspay.ts` | Refus si `VERCEL_ENV` est défini et ≠ `production` ; test ajouté. Ne jamais déclarer de clé live hors Production malgré tout. |
| R2 | **Élevée** | Le cron quotidien peut dépasser la durée maximale avant d'expirer les abonnements : rapprochement séquentiel (50 × 15 s au pire) placé avant `expireDueSubscriptions`, sans `maxDuration`. Une panne lente de GeniusPay pourrait couper la fonction et sauter l'expiration et les purges du jour, alors que le commentaire de la route promet le contraire. | `api/cron/subscriptions/route.ts:31-36`, `subscription-billing.ts:566-583`, `geniuspay.ts:28` | Exporter `maxDuration` sur la route, et borner le rapprochement par un budget de temps, ou faire l'expiration d'abord. À tester. |
| R3 | ~~Élevée~~ **Confirmé puis corrigé (mission 15)** | `src/proxy.ts` renvoyait `/platform/login` vers `/login` sans session : console du propriétaire injoignable hors aperçu. | `src/proxy.ts` | `/platform/login` exclue de la redirection ; `src/proxy.test.ts` échoue sans le correctif. |
| R4 | Moyenne | Couplage strict : `readEnvironment` valide **toutes** les variables du schéma à chaque appel de `getAuth()`. Les cas suivants font tomber connexion, inscription et routes métier : une variable facultative mal formée (VAPID, `NOTIFICATIONS_CRON_SECRET` de moins de 32 caractères, `SENTRY_DSN` ou `NEXT_PUBLIC_POSTHOG_HOST` qui ne sont pas des URL, `RESEND_REPLY_TO` qui n'est pas un e-mail), une variable URL déclarée vide (`BETTER_AUTH_URL=""`, `NEXT_PUBLIC_AUTH_URL=""`), une paire incomplète. Le message ne nomme pas la variable fautive. En outre, `platformRequestSecret()` se replie sur une valeur fixe si `BETTER_AUTH_SECRET` manque ; en pratique, Better Auth a déjà refusé de démarrer. | `env.ts:5-58`, `auth/server.ts:301-316`, `platform-request.ts:20` | Ne créer que les variables utiles, jamais vides. Après chaque changement de variable : redéployer, puis tester `/login`. Amélioration possible : citer les **noms** des variables invalides, comme `storage/config.ts:80`. |
| R5 | Moyenne | Preview avec `NODE_ENV=production` : connexion impossible sur les URL aléatoires `*.vercel.app` (origine de confiance, nom d'hôte Turnstile, cookies `Secure`). Il faut un domaine staging fixe, un widget Turnstile staging et Resend pour les invitations. | `server.ts:116,122,228`, `turnstile.ts:40,66-69`, `server.ts:76-85` | Domaine staging fixe ; `BETTER_AUTH_URL` de Preview = ce domaine. |
| R6 | Moyenne | La *Deployment Protection* sur Preview bloque les webhooks GeniusPay sandbox et les appels de cron manuels vers staging. Le contournement (*Protection Bypass for Automation*) met un jeton dans l'en-tête ou dans l'URL du webhook, et la seconde forme expose un secret dans une URL. | `docs/production-setup-guide.md` § 4.2 ; webhook sans session (`api/webhooks/geniuspay/route.ts:10-14`) | Décider : jeton de contournement dédié à staging et renouvelable, ou essais sandbox par le tunnel local documenté (`docs/engineering/geniuspay-sandbox-tunnel.md`). |
| R7 | Moyenne | `NEXT_PUBLIC_AUTH_URL` est figée au build. Une valeur de production copiée en Preview ferait appeler l'authentification de **production** par les pages staging. | `auth/client.ts:7` | Laisser la variable vide dans tous les environnements (origine courante). |
| R8 | Moyenne | Export XLSX des rapports : 9 feuilles × 5 000 lignes, compressées mais **sans borne en octets**. La limite de réponse Vercel de 4,5 Mo n'est contrôlée que pour l'export complet. Taille réelle jamais mesurée. | `domain/exports.ts:26,34`, `api/business/reports/export/route.ts:50-52` ; comparer `data-export.ts:38` | Mesurer un classeur au plafond, puis ajouter une borne et un refus 422 explicite, comme pour l'export complet. |
| R9 | Moyenne | Intégration Neon ↔ Vercel : branches Preview automatiques non migrées, et injection de variables qui peuvent écraser des valeurs saisies à la main. | `env.ts:8-9` (le nom `DATABASE_URL_UNPOOLED` vient de cette intégration) | Décision D-07 proposée (§ 8). |
| R10 | Faible | `vercel.json` ne fixe aucune région. Le projet Neon `qadr-data-base` est en `aws-us-east-1` : la région par défaut des fonctions Vercel (`iad1`, Washington) en est proche. Le projet `neon-charcoal-chair` (`eu-west-2`) n'est pas celui de l'application. | `apps/web/vercel.json`, Neon `list_projects` du 2026-11-09 | Garder `iad1` tant que la base reste en `us-east-1` ; si la base change de région, aligner la région des fonctions. |
| R11 | Faible | `BETTER_AUTH_TRUSTED_ORIGINS`, lue par la bibliothèque, élargirait les origines de confiance si quelqu'un la créait. | `better-auth/dist/context/helpers.mjs:83-84` | Ne jamais la créer. La relire dans la liste Vercel avant chaque mise en production. |
| R12 | Faible | `SENTRY_ENVIRONMENT` et `NEXT_PUBLIC_SENTRY_ENVIRONMENT` valent `development` par défaut : sans elles, les erreurs de production sont mal étiquetées. | `sentry.server.config.ts:8`, `instrumentation-client.ts:8` | Les déclarer en Preview (`preview`) et en Production (`production`). |
| R13 | Faible | Limiteur en mémoire pour `POST /api/public/campaigns/check` : la limite est multipliée par le nombre d'instances (limite assumée et documentée). | `src/lib/rate-limit.ts:1-10`, `campaigns/check/route.ts:18,25` | Règle de débit Cloudflare sur ce chemin si le proxy est retenu (D-04). |
| R14 | Faible | Build : si Vercel lance `next build` au lieu du script, Turbopack (défaut de Next 16) remplace webpack. | `package.json` `build` ; doc Next `01-installation.md:157` | Build Command fixée à `npm run build`. |
| R15 | Faible | `assertProductionAuthUrl` admet `http://localhost` en production. | `env.ts:67-68` | Vérifier la valeur à la main (§ 8). |

### 6.1 Documentation périmée (à corriger, hors périmètre de ce fichier)

| Document | Passage | Écart avec le code ou les décisions |
| --- | --- | --- |
| `docs/production-setup-guide.md` | l. 7, 128 (§ 4) et 474 (§ 12) | Annoncent que Vercel est **abandonné** au profit de Cloudflare Workers. C'est l'inverse depuis D-01 (`docs/engineering/decisions.md`, l. 10). |
| `docs/production-setup-guide.md` | § 3.1 | Ne liste ni GeniusPay (4), ni Google/Apple (5), ni `VERCEL_ENV`. |
| `docs/production-setup-guide.md` | § 5.4, § 6.2, § 16 B | Décrivent un pool créé à chaque requête et une limitation en mémoire. Or le pool est partagé (`db/client.ts:21-40`) et la limitation est en base depuis la mission 14 (`docs/rate-limiting.md`). |
| `docs/architecture/cloudflare-vercel-ownership.md` | § 4 et § 8 | Annoncent un envoi direct navigateur → R2 et un stockage « non implémenté », alors que l'envoi passe par le serveur (`docs/storage-r2.md` § 5). Annoncent aussi des en-têtes de sécurité « absents », alors qu'ils existent (`security-headers.ts`). |
| `apps/web/src/lib/cron-schedule.ts` | l. 1-6 | Commentaire orienté Cloudflare Cron Triggers. |

## 7. Actions du propriétaire sur Vercel

Classées par ordre d'exécution. Aucune n'a été faite. Chaque étape qui déploie ou touche une base exige votre accord explicite (règles du projet, D-02).

### 7.1 Décisions à prendre d'abord

1. **Offre Vercel** : Pro (usage commercial) ; Hobby est exclue pour Qadr Ops. Relever le tarif et la date de vérification.
2. **D-04, proxy Cloudflare** : DNS seul (recommandé, `docs/rate-limiting.md`) ou proxy (règles de cache et `cf-connecting-ip` à revoir).
3. **D-07 (proposée), intégration Neon ↔ Vercel** : chaînes saisies à la main (recommandé) ou intégration sans branches Preview automatiques.
4. **Contournement de la protection Preview** pour les webhooks sandbox et les crons manuels (R6).
5. **Correctifs de code à autoriser** : R1 (clé live en Preview), R2 (durée du cron), R3 (`/platform/login`), R8 (taille de l'export XLSX), et éventuellement `regions` dans `vercel.json`.

### 7.2 Création du projet (sans relier le dépôt tant que le déploiement n'est pas autorisé)

6. Root Directory `apps/web`, Install `npm ci`, Build `npm run build`, Node 24.x, Fluid Compute activé, région des fonctions = région Neon.
7. Deployment Protection active sur Preview. Déploiements automatiques limités aux branches voulues (*Ignored Build Step* ou réglage Git).
8. Domaines : `app.<domaine>` en Production, `staging.<domaine>` rattaché à la branche de préproduction. Une seule adresse canonique.

### 7.3 Variables, environnement par environnement (§ 3, § 4.2)

9. **Production** : `DATABASE_URL` (*pooled* `main`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://app.<domaine>`), Turnstile (2), Resend (2 + facultative), `CRON_SECRET`, Sentry (4), puis selon les services retenus : VAPID (3), R2 (4 ou 5), GeniusPay **live** (3 + facultative), PostHog (2), Google/Apple.
10. **Preview** : mêmes noms, **toutes les valeurs distinctes** : *pooled* `staging`, domaine staging, widget Turnstile staging, bucket R2 de test, **GeniusPay sandbox uniquement**, `SENTRY_ENVIRONMENT=preview`.
11. **Development** : vide, ou valeurs de la branche `dev` seulement.
12. Cocher *Sensitive* pour chaque variable marquée « Secret : oui ».
13. Ne **jamais** créer : `QADR_PREVIEW_MODE`, `QADR_FILE_STORAGE`, `SENTRY_TEST_ENABLED`, `QADR_DB_TARGET`, `DATABASE_URL_UNPOOLED`, `NOTIFICATIONS_CRON_SECRET` (sauf planificateur externe), `BETTER_AUTH_TRUSTED_ORIGINS`, `AUTH_SECRET`, `BETTER_AUTH_SECRETS`, `NEXTAUTH_URL`, `BETTER_AUTH_TELEMETRY`, ni aucune variable avec une valeur vide.
14. Relire la liste complète des deux environnements avant le premier déploiement, puis après chaque ajout (R4, R11).

### 7.4 Premier déploiement Preview (après autorisation)

15. Vérifier `/login`, l'inscription (Turnstile staging), une invitation (Resend) et `/platform/login` (R3).
16. Lire, sur une route de diagnostic temporaire et protégée, l'adresse reçue dans `x-forwarded-for` (`docs/rate-limiting.md`).
17. Appeler les deux crons à la main sur staging, avec le `CRON_SECRET` de Preview et le contournement retenu. Contrôler le JSON de réponse (`billing`, `storage`, `rateLimit`).
18. Paiement sandbox de bout en bout, webhook compris, sur staging.
19. Export XLSX d'une période chargée : noter la taille (R8).

### 7.5 Production (après autorisation écrite de migrer `main`)

20. Migration de `main` selon la procédure à valider (`docs/production-setup-guide.md` § 5.2 : la cible `production` de `migrate.ts` n'existe pas encore).
21. Création du propriétaire par `scripts/platform-owner.ts` depuis le poste local (`QADR_DB_TARGET=production`).
22. Au lendemain du premier déploiement, contrôler les exécutions des deux crons dans Vercel (*Cron Jobs*, *Logs*).
