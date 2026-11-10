# Mission 16 : Vercel, GitHub et premier Preview

Date : **2026-11-10**. Branche : `feat/mission-13-reprise`. Application : `apps/web`.

Ce document prépare le premier déploiement Preview. **Rien n'a été poussé, déployé ni modifié** sur Vercel, GitHub, Neon ou Cloudflare. Aucune valeur de variable n'a été lue ni déchiffrée.

Il complète `vercel-environments.md` (inventaire des variables, garde-fous, risques R1 à R18).

## 0. Sources de cette relecture

| Source | Ce qui a été lu | Fiabilité |
| --- | --- | --- |
| CLI Vercel 65.9.0, connectée au compte du propriétaire | `vercel project ls`, `vercel project inspect`, et en `GET` seulement : `/v9/projects/{id}`, `/v10/projects/{id}/env`, `/v9/projects/{id}/domains`, `/v6/deployments`, `/v1/storage/stores`. Les réponses ont été filtrées avant affichage : noms, cibles et types des variables, jamais leurs valeurs. | En direct, le 2026-11-10 |
| Serveur MCP Neon | `list_projects`, `list_branches` (lecture seule) | En direct, le 2026-11-10 |
| API publique GitHub, sans authentification | Visibilité du dépôt | En direct, le 2026-11-10 |
| Git local | `git ls-remote origin`, `git log -p origin/main..HEAD`, `git check-ignore` | En direct, le 2026-11-10 |
| Serveur MCP Vercel | Non disponible pendant cette session | — |

Les identifiants sont abrégés, comme dans `vercel-environments.md` : **le dépôt GitHub est public** (§ 3.1).

## 1. Audit des deux projets Vercel

Équipe Vercel `qadragency`. Les deux projets sont en région `iad1`, avec Fluid Compute activé. Leur protection est *Standard Protection* (`all_except_custom_domains`) : toutes les URL `*.vercel.app` exigent une connexion Vercel, seuls les domaines personnalisés de production seraient publics.

| Réglage | `web` (`prj_tN0I…`) | `qadrops` (`prj_CNib…`) | Attendu pour `apps/web` |
| --- | --- | --- | --- |
| Créé le | 2026-11-01 | 2026-10-18 | — |
| Dépôt Git relié | `ridwangouet747-ai/QADROPS`, branche de production `main` | **Aucun** | Le dépôt, branche de production `main` |
| Root Directory | `apps/web` | `.` (racine, celle du MVP) | `apps/web` |
| Framework | Next.js | Aucun | Next.js |
| Install Command | `npm ci` | Aucune | `npm ci` |
| Build Command | **`next build`** (Turbopack en Next 16, build jamais testé) | Aucune | `npm run build` (`next build --webpack`) |
| Node.js | **26.x** | 24.x | 24.x (`engines` de `package.json`, qui devrait l'emporter au build ; à aligner quand même) |
| Variables | **0** | 36, toutes issues de deux ressources Neon du Marketplace (§ 1.1) | Voir `vercel-environments.md` § 3 |
| Domaines | `web-phi-beryl-45.vercel.app` | `qadrops.vercel.app` | Domaine Preview fixe, puis domaine de production |
| Déploiements | 1 en production : `dpl_GfGA…`, 2026-11-01, `main` `2cb9c97`, état READY | 0 | — |
| Crons | Activés, 0 définition (`2cb9c97` n'a pas de `apps/web/vercel.json`) | — | 2 définitions de `apps/web/vercel.json` |
| Contournement de protection | Aucun | Aucun | À décider (R6) |

Le domaine `web-qadragency.vercel.app` cité en mission 15 n'est pas le domaine du projet : c'est sans doute un alias de déploiement. Le domaine du projet est `web-phi-beryl-45.vercel.app`.

### 1.1 Correction importante : la `DATABASE_URL` actuelle de `qadrops` ne vise pas `qadr-data-base`

La mission 15 indiquait que la `DATABASE_URL` de `qadrops` visait la branche `main` du projet Neon de l'application. Les métadonnées des variables (`contentHint.storeId`) et la liste des ressources de stockage montrent autre chose. **Le nom du projet Neon visé n'a pas été lu dans la valeur**, qui n'a pas été déchiffrée.

| Ressource Vercel (Neon) | Projet Neon | Région | Branches | Variables injectées dans `qadrops` |
| --- | --- | --- | --- | --- |
| `qadr-data-base` | `soft-shadow-928…` (créé par le Marketplace le 2026-11-03) | `aws-us-east-1` | `main` (vide, jamais migrée) ; `mission-14-staging` (base `qadr_staging`, 25 migrations) | 18 variables **préfixées** `QADROPSDATABASE_*`, en **Development + Preview + Production** |
| `neon-charcoal-chair` | `soft-shadow-146…` (créé le 2026-10-18 avec le projet `qadrops`) | `aws-eu-west-2` | `main` seule, **archivée**, environ 38 Mio | 18 variables **sans préfixe** (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*`, `NEON_*`, `VITE_NEON_AUTH_URL`), en **Preview + Production** |

Conséquences :
- Le code ne lit que `DATABASE_URL` sans préfixe. Déployé dans `qadrops` en l'état, il viserait `neon-charcoal-chair`, une base qui n'est pas celle de l'application et dont le contenu n'a pas été examiné. Il ne viserait pas `qadr-data-base`.
- **Preview et Production partagent cette même chaîne**, ce qui reste le risque principal.
- Les variables `QADROPSDATABASE_*` sont présentes en **Development** : un `vercel env pull` copierait sur le poste les identifiants de la branche `main` de `qadr-data-base`.
- Ne jamais supprimer une ressource (*Delete*) dans l'onglet *Storage* de Vercel. Pour une ressource du Marketplace, cette action supprime aussi le projet Neon. Seule la **déconnexion d'un projet** (*Disconnect*) est sans danger pour les données.

### 1.2 Recommandation : héberger `apps/web` dans le projet `web`

Le choix ne repose pas sur le nom. Il repose sur ce qu'il reste à faire, et sur le risque de chaque option.

| Critère | `web` | `qadrops` |
| --- | --- | --- |
| Lien Git, Root Directory, framework, installation | Déjà corrects | Tout est à créer, dont le lien Git |
| Réglages à corriger | 2 : Node 24.x, Build Command | 5 : lien Git, Root Directory, framework, Install, Build |
| Variables existantes | Aucune : rien de dangereux à défaire | 36 variables, dont une `DATABASE_URL` partagée Preview/Production qui vise une autre base (§ 1.1) |
| Historique | Un déploiement de production obsolète (`2cb9c97`, sans variables, protégé), remplacé au premier déploiement de `main` | Aucun |
| Lien avec Neon | À créer (une connexion de ressource ou des variables manuelles) | Existant mais mal configuré |

**Recommandation : `web`.** Il suffit de corriger deux réglages et d'ajouter des variables propres, environnement par environnement. Dans `qadrops`, il faudrait au contraire défaire une configuration Neon trompeuse avant de pouvoir construire quoi que ce soit.

Ensuite, côté `qadrops` :
1. **Déconnecter** les deux ressources Neon de `qadrops`, sans jamais les supprimer.
2. Archiver ou supprimer le projet `qadrops` sur décision du propriétaire. C'est une action Vercel, et non une suppression de données Neon.

Le sort du projet Neon `neon-charcoal-chair` est une décision à part. Son contenu n'a pas été examiné.

Si le propriétaire préfère `qadrops`, la même procédure s'applique en inversant les rôles. Dans ce cas, déconnecter d'abord `neon-charcoal-chair`, puis relier le dépôt et régler Root Directory, framework, Install et Build.

## 2. Matrice Local / Preview / Production

La matrice complète (46 variables lues par l'application, avec les fichiers qui les lisent) est dans `vercel-environments.md` § 3.1. Le tableau ci-dessous en donne la lecture stricte par environnement pour les variables demandées.

- « Obl. » : obligatoire pour que la connexion et les routes métier fonctionnent dans cet environnement.
- **Local** : poste de développement (`.env.local` ou `npm run preview`).
- **Preview** : Vercel, `NODE_ENV=production`, `VERCEL_ENV=preview`.
- **Production** : Vercel, `VERCEL_ENV=production`.

| Variable | Local | Preview | Production | Obl. | Risque si partagée entre Preview et Production |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Aucune (`npm run preview`) ou branche Neon de dev | Chaîne *pooled* de `mission-14-staging`, base `qadr_staging` | Chaîne *pooled* de `main` (après migration autorisée) | Oui | **Critique** : la Preview écrit dans la base de production. **Aucun garde-fou dans le code** (§ 2.2). |
| `DATABASE_URL_UNPOOLED` | Terminal, pour les migrations | Ne pas définir (l'application ne la lit pas) | Ne pas définir | Non | Identifiants directs exposés sans utilité |
| `BETTER_AUTH_SECRET` | Valeur locale ≥ 32 car. | Valeur propre ≥ 32 car. | Valeur propre ≥ 32 car. | Oui | Élevé : une session ou un jeton signé en Preview serait valable en production (même secret HMAC). Non détecté par le code. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Domaine Preview **fixe**, HTTPS | `https://app.<domaine>` | Oui | Liens d'e-mail, retours GeniusPay et origine de confiance vers le mauvais environnement. HTTPS exigé, mais `localhost` admis (R15). |
| `CRON_SECRET` | Facultative | Valeur propre ≥ 32 car. | Valeur propre ≥ 32 car. | Prod. seulement (sinon crons 404/401) | Moyen : le secret Preview permettrait de déclencher les crons de production |
| `GENIUSPAY_API_KEY`, `_API_SECRET`, `_WEBHOOK_SECRET` | Sandbox ou rien | **Sandbox uniquement** | Live | Non (paiement « indisponible » sinon) | **Protégé** : live refusée si `VERCEL_ENV ≠ production`, sandbox refusée en production hors Preview, préfixes discordants refusés, `environment_mismatch` sur le webhook |
| `GENIUSPAY_BASE_URL` | Facultative | Facultative | Facultative | Non | **Protégé** : hôte limité à `geniuspay.ci` / `genius.ci`, HTTPS |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Vide (aucun envoi) | Clé dédiée, domaine d'envoi vérifié | Clé de production | Pour les invitations : oui (adresse vérifiée exigée) | Moyen : des e-mails réels partent depuis Preview vers de vraies adresses, au nom du domaine de production. Non détecté. |
| `RESEND_REPLY_TO` | Facultative | Facultative | Boîte de support | Non | Faible |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Paire de dev | Paire propre | Paire propre, jamais changée | Non | Moyen : un abonnement push pris en Preview serait valable en production. Non détecté. Sujet `example.com` refusé en production (lot VAPID de la mission 16, en cours). |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Clés de test `1x…` | Widget « staging » | Widget « production » | **Oui** (connexion, inscription, réinitialisation) | **Protégé en partie** : clés de test refusées dès que `NODE_ENV=production`. Le nom d'hôte du jeton est comparé à `BETTER_AUTH_URL`, donc un widget de production utilisé en Preview échoue, si sa liste d'hôtes est stricte. |
| `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_JURISDICTION` | Rien, ou mémoire | Bucket de test, jeton limité à ce bucket | Bucket de production | Non (sans R2, l'original des imports n'est pas gardé) | Élevé : des fichiers de Preview dans le bucket de production, et la purge de Preview sur des objets réels. **Non détecté** : le marqueur de bucket de test existe seulement pour les tests (`r2-test-target.ts`). |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Facultatives | DSN | DSN | Non | Faible si `SENTRY_ENVIRONMENT` diffère |
| `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `development` | `preview` | `production` | Non | Erreurs mal étiquetées (R12). Non détecté. |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Vide | Projet de test (facultatif) | Projet de production (facultatif) | Non | Statistiques de production polluées. Non détecté. |
| `NEXT_PUBLIC_AUTH_URL` | Vide ou `http://localhost:3000` | **Ne pas définir** | **Ne pas définir** | Non | Élevé : figée au build, une valeur de production en Preview envoie l'authentification de Preview vers la production (R7). Non détecté. |
| `QADR_PREVIEW_MODE` | Posée par `npm run preview` | Ne pas définir | Ne pas définir | Non | **Protégé** : sans effet hors `NODE_ENV=development` ; `getDatabase()` refuse Neon pendant l'aperçu. |
| `QADR_FILE_STORAGE` | `memory` possible | Ne pas définir | Ne pas définir | Non | **Protégé** : `memory` refusé en production |
| `QADR_STORAGE_*` (4) | Facultatives | Facultatives | Facultatives | Non | Faible |
| `QADR_DB_TARGET`, `QADR_OWNER_*`, `QADR_PREVIEW_HOSTNAME`, `QADR_TEST_*` | Terminal | **Jamais** | **Jamais** | — | Scripts et tests seulement |

### 2.1 Mélanges déjà refusés par le code

- Clé GeniusPay live hors production Vercel (`VERCEL_ENV` doit valoir `production`). Clé sandbox en production réelle. Clé publique et clé secrète d'environnements différents. Hôte d'API hors GeniusPay.
- Base de démonstration PGlite hors `NODE_ENV=development`, et accès à Neon pendant l'aperçu local (`getDatabase()`, `getRuntimeDatabase()`).
- Stockage en mémoire en production.
- Clés Turnstile de test en production et en Preview.
- `BETTER_AUTH_URL` absente ou en `http://` (sauf `localhost`) en production et en Preview.
- Secret Better Auth et secret de cron de moins de 32 caractères.
- Sujet VAPID d'exemple en production (lot de la mission 16, non commité au moment de la rédaction).
- Test R2 réel limité à un bucket portant un marqueur `test`, `staging`, `dev` ou `preview`, via des variables `QADR_TEST_R2_*` distinctes (lot de la mission 16, non commité).

### 2.2 Mélanges non protégés (à corriger par la configuration, ou par un garde-fou à décider)

| Mélange | Effet | Garde-fou simple proposé (non implémenté) |
| --- | --- | --- |
| `DATABASE_URL` de production en Preview | Écritures de test dans la base des commerçants | Lire le nom de base dans `DATABASE_URL` : en `VERCEL_ENV=preview`, exiger un nom qui contient `staging` (la base de staging s'appelle `qadr_staging`) ; en `VERCEL_ENV=production`, refuser ce marqueur. |
| Bucket R2 de production en Preview | Fichiers mêlés, purge croisée | Réutiliser `isTestBucketName` : exiger le marqueur en Preview, le refuser en Production. |
| Même `BETTER_AUTH_SECRET`, `CRON_SECRET` ou paire VAPID dans les deux environnements | Jetons, crons ou abonnements push valables des deux côtés | Indétectable par le code. Relecture humaine de la liste (§ 4, étape 6). |
| Clé Resend de production en Preview | E-mails réels envoyés depuis Preview | Clé Resend distincte par environnement, limitée au domaine |
| `NEXT_PUBLIC_AUTH_URL` définie | Authentification de Preview envoyée vers la production | Ne jamais la créer sur Vercel |
| `BETTER_AUTH_URL=http://localhost…` sur Vercel | Cookies, e-mails et Turnstile cassés | Refuser `localhost` quand `VERCEL_ENV` est défini (R15) |
| Variables `QADROPSDATABASE_*` en Development | Identifiants de `main` copiés par `vercel env pull` | Retirer la cible Development (§ 2.3) |

### 2.3 Procédure : retirer la Preview de la `DATABASE_URL` Neon et viser `mission-14-staging`

À faire par le propriétaire, dans le tableau de bord Vercel. Les libellés exacts de l'écran de connexion Neon sont **à vérifier** au moment de le faire, car ils n'ont pas été relus pendant cette mission.

**A. Défaire la configuration actuelle (projet `qadrops`)**
1. Vercel → *Storage* → `neon-charcoal-chair` → *Projects* → `qadrops` → **Disconnect**. Les 18 variables sans préfixe (dont `DATABASE_URL` en Preview + Production) disparaissent. Ne pas cliquer sur *Delete* pour la ressource.
2. Vercel → *Storage* → `qadr-data-base` → *Projects* → `qadrops` → **Disconnect**. Les 18 variables `QADROPSDATABASE_*`, Development compris, disparaissent. Le projet Neon et ses deux branches restent intacts.
3. Contrôle (lecture seule) : `vercel env ls --project qadrops --scope qadragency` ne doit plus afficher aucune variable de base de données.

**B. Preview du projet `web` vers `mission-14-staging`**

4. Console Neon → projet `qadr-data-base` → *Connect* → branche **`mission-14-staging`**, base **`qadr_staging`**, *Connection pooling* **activé** (hôte en `-pooler`). Copier la chaîne sans la coller ailleurs.
5. Dans un terminal, depuis un dossier quelconque (pas besoin de lier le dépôt) :
   ```powershell
   vercel env add DATABASE_URL --project web --scope qadragency --environment preview --git-branch feat/mission-13-reprise --sensitive
   ```
   Coller la chaîne **à l'invite**. N'utilisez pas `--value`, qui laisserait le secret dans l'historique du terminal.

   La portée `--git-branch` limite la base de staging à la seule branche de préproduction. Une autre branche poussée par erreur n'aurait aucune base et échouerait proprement, sans toucher à rien.
6. Ne pas créer `DATABASE_URL_UNPOOLED` dans Vercel : l'application ne la lit pas.

**C. Production (plus tard, après autorisation écrite de migrer `main`)**

7. Deux possibilités. La première : *Storage* → `qadr-data-base` → *Connect Project* → `web`, cible **Production seule**, **sans préfixe**, création de branches pour les déploiements Preview **désactivée**. La seconde : `vercel env add DATABASE_URL --project web --environment production --sensitive`, avec la chaîne *pooled* de `main`. La seconde évite que l'intégration réécrive la variable (R9).
8. Contrôle : `vercel env ls preview --project web --scope qadragency` et `vercel env ls production --project web --scope qadragency`. `DATABASE_URL` doit apparaître **une fois par environnement**, jamais avec les deux cibles sur la même ligne.

## 3. GitHub

### 3.1 État

- `origin` = `https://github.com/ridwangouet747-ai/QADROPS.git`. `git ls-remote` : une seule branche distante, `main` = `2cb9c97`.
- **Le dépôt est public** (API GitHub, 2026-11-10). Pousser revient donc à publier le code, les documents d'architecture, les procédures de sécurité et les noms des projets Vercel et Neon.
- `origin/main` est un ancêtre de `HEAD`, et aucun commit distant n'est absent en local : la publication est une avance rapide, sans conflit.
- **54 commits** absents d'`origin/main`, du 2026-11-01 au 2026-11-09 (de `d5f1693`, missions 08 à 10, à `ecf9277`, régression de la mission 15). Il y a 430 fichiers modifiés. Aucun objet ne dépasse 500 Ko. Un seul auteur.
- Les 15 autres branches locales (`feat/mission-11-fiabilisation`, `feat/missions-08-10`, `feat/video-reprenez-le-controle`, `master`, `worktree-agent-*`) sont **toutes contenues** dans `feat/mission-13-reprise`. Il n'y a rien à pousser en plus.
- La branche locale `master` suit `origin/main` : son nom diffère de celui de la branche distante.

### 3.2 Recherche de secrets dans les 54 commits

Méthode : `git log -p origin/main..HEAD`, avec 16 motifs : `sk_`, `pk_`, `re_`, `whsec_`, `npg_`, `phc_`, `gh*_`, `postgres://…:…@`, `BEGIN … PRIVATE KEY`, `AKIA…`, `gp_`, DSN Sentry, secret Turnstile `0x4AAAA…`, 64 caractères hexadécimaux, `VAPID_PRIVATE_KEY=`, et les affectations `SECRET|PASSWORD|API_KEY|ACCESS_KEY`. Les valeurs étaient masquées à l'affichage. Une recherche `git grep` a aussi porté sur l'arbre de `HEAD` et sur celui d'`origin/main`.

**Résultat : aucun secret réel trouvé.** 40 correspondances, toutes fictives :

| Type | Commits et fichiers | Nature |
| --- | --- | --- |
| `postgres://…:…@` | `82b7b7a`, `55b0846` (`db/client.test.ts`), `04d24af` (`db/runtime.test.ts`, `preview-billing-webhook.integration.test.ts`), `9926d83` (`webhook-gateway.integration.test.ts`), `b0439ee` (`env.test.ts`), `83208cf` (`postgres-harness.test.ts`), `5d90753` (`http-harness.ts`) | Hôtes `.invalid` ou `ep-exemple…`, mots de passe d'un à dix caractères |
| Secret Turnstile `0x4AAAA…` | `5e4e1b4` (`rate-limit.http.test.ts`) | Valeur d'essai (contient « essai ») |
| `SECRET`, `PASSWORD`, `API_KEY`, `ACCESS_KEY` | `df8db6c` (GeniusPay : `geniuspay.test.ts`, `fake-geniuspay.ts`, `subscription-billing.http.test.ts`), `b0439ee` (`storage/config.test.ts`, `stored-files.http.test.ts`), `5d90753`, `83208cf`, `3096b3c` | Valeurs de test explicites (`…_test_unitaire`, `secret-…`, `0123456789abcdef`, `mot-…`) |
| 64 caractères hexadécimaux | `b0439ee` (`sigv4.ts`, `sigv4.test.ts`, `r2.test.ts`), `92ef807` (`dependencies-and-skills.md`) | Empreinte SHA-256 du contenu vide, vecteurs de test SigV4 publics, empreinte d'un fichier `SKILL.md` |
| `VAPID_PRIVATE_KEY=` | `d5f1693` (`.env.example`, `scripts/generate-vapid-keys.mjs`) | Ligne vide et gabarit d'affichage, sans valeur |

### 3.3 Fichiers ignorés

| Chemin | Ignoré ? |
| --- | --- |
| `.env`, `.env.local`, `apps/web/.env*` (sauf `.env.example`), `apps/web/.vercel/.env.*.local` | Oui |
| `data/` (MVP) | Oui |
| `*.pem`, `*.key` (racine et `apps/web`), `*.p12`, `*.pfx`, `*.crt`, `*.cer`, `id_rsa*` | Oui |
| `.next/`, `.next-preview/`, `coverage/`, `*.tsbuildinfo` | Oui |
| **`*.p8`** (clé « Sign in with Apple », `APPLE_PRIVATE_KEY_PATH`) | **Non** |
| **`.vercel/`** (créé par `vercel link`, contient les identifiants du projet) | **Non** (seuls les `.env*` qu'il contient le sont) |
| **Exports téléchargés** (`*.zip`, `*.xlsx`, `*.csv`, `*.pdf` posés dans le dépôt) | **Non** |
| **`production-video/`**, **`.claude/worktrees/`** (chemins protégés, non suivis) | **Non**. Ils apparaissent en `??`. Un `git add .` les ajouterait, et les worktrees seraient enregistrés comme des sous-dépôts. |
| `apps/web/AGENTS.md` (recréé par `next dev`) | Non |

Les chemins protégés ne partiront pas tant que les ajouts se font fichier par fichier. Le coordinateur peut aussi ajouter `*.p8`, `.vercel/`, `production-video/` et `.claude/worktrees/` à `.gitignore`. Ce fichier est un chemin protégé : ce document ne le modifie pas.

### 3.4 Plan de publication (rien n'est poussé)

1. **Décision du propriétaire sur la visibilité.** Recommandation : passer le dépôt en **privé** avant le premier push (GitHub → *Settings* → *General* → *Danger Zone* → *Change visibility*). Les 54 commits décrivent en détail la sécurité, les garde-fous et l'infrastructure. Rien n'y est secret, mais rien n'oblige à le publier non plus. Un dépôt privé reste déployable par Vercel, puisque le propriétaire est membre de l'équipe.
2. Le coordinateur commite le travail de la mission 16, puis lance la régression complète. `git status` ne doit plus montrer que les chemins protégés.
3. **Configurer Vercel avant le push** (§ 4, étapes 2 à 6). Le projet `web` est relié au dépôt : le push d'une branche déclenche aussitôt un déploiement Preview.
4. Pousser **la seule branche de travail**, jamais `main` :
   ```powershell
   git push -u origin feat/mission-13-reprise
   ```
5. Ouvrir une PR `feat/mission-13-reprise` → `main` pour la relecture. **Ne pas la fusionner** tant que la production n'est pas prête : la fusion déclencherait un déploiement de production du projet `web`, qui remplacerait le déploiement obsolète du 2026-11-01. En attendant, ce déploiement resterait protégé, mais sans base ni secrets.
6. Ne pousser aucune autre branche : elles sont toutes contenues dans celle-ci.

## 4. Premier Preview : blocages et ordre des actions

### 4.1 Ce qui bloque aujourd'hui

| # | Blocage | Qui |
| --- | --- | --- |
| B1 | Aucune branche n'est sur GitHub. Vercel ne peut rien construire, et le push exige l'accord du propriétaire (D-02). | Propriétaire |
| B2 | Le dépôt est public : la visibilité doit être décidée avant le push. | Propriétaire |
| B3 | Projet `web` : Node 26.x et Build Command `next build` (Turbopack, jamais testé). | Propriétaire (réglages Vercel) |
| B4 | Aucune `DATABASE_URL` Preview vers `mission-14-staging`. En face, `qadrops` porte une `DATABASE_URL` partagée Preview/Production vers une autre base. | Propriétaire (§ 2.3) |
| B5 | Aucun secret Preview : `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL` sont obligatoires, sinon l'authentification refuse de démarrer. | Propriétaire |
| B6 | Turnstile : sans widget « staging », la connexion, l'inscription et la réinitialisation sont refusées en Preview (`NODE_ENV=production`). | Propriétaire (Cloudflare) |
| B7 | Aucun nom de domaine : Cloudflare n'a aucune zone (`mission-16-cloudflare-r2-push.md`). Il faut une adresse Preview **fixe** pour `BETTER_AUTH_URL` et le widget Turnstile. Une adresse `*.vercel.app` ajoutée au projet et rattachée à la branche peut suffire, mais elle reste derrière la protection Vercel (à vérifier). | Propriétaire |
| B8 | Resend n'a aucun domaine. En Preview, une invitation exige une adresse vérifiée : **personne ne peut rejoindre un commerce** existant. L'inscription d'un propriétaire fonctionne. | Propriétaire, non bloquant pour un premier essai |
| B9 | La protection Vercel bloque les webhooks GeniusPay sandbox et les appels de cron manuels (R6). | Décision, non bloquante pour un premier essai |
| B10 | Toute migration ajoutée en mission 16 devra être appliquée à `mission-14-staging` avant le Preview. Il y en a 25 à ce jour, et aucune nouvelle. | Propriétaire, avec autorisation |

### 4.2 Séquence pour le propriétaire

Chaque étape qui touche un service externe exige votre accord. Aucune n'a été faite.

1. **Visibilité GitHub** : décider public ou privé (recommandé : privé).
2. **Projet `web`**, dans *Settings* → *Build and Deployment* :
   - Node.js Version : **24.x** ;
   - Build Command : forcer **`npm run build`** ;
   - Install Command : `npm ci`, à garder ;
   - Root Directory : `apps/web`, à garder ;
   - *Include files outside the Root Directory* : désactivé.

   Puis *Git* : laisser `main` comme branche de production.
3. **Projet `qadrops`** : § 2.3, étapes 1 à 3. Déconnecter les deux ressources Neon, sans jamais les supprimer.
4. **Adresse Preview fixe** : *Settings* → *Domains* du projet `web` → ajouter une adresse (domaine personnalisé ou `*.vercel.app` libre), rattachée à la branche `feat/mission-13-reprise`. Noter l'adresse HTTPS exacte.
5. **Widget Turnstile « staging »** (Cloudflare → Turnstile) : nom d'hôte = l'adresse de l'étape 4.
6. **Variables Preview** du projet `web`, toutes avec `--environment preview --git-branch feat/mission-13-reprise`, saisies à l'invite et jamais avec `--value` :
   - `DATABASE_URL` : chaîne *pooled* de `mission-14-staging` (§ 2.3, étapes 4 et 5), `--sensitive` ;
   - `BETTER_AUTH_SECRET` : nouvelle valeur ≥ 32 caractères, `--sensitive` ;
   - `BETTER_AUTH_URL` : l'adresse de l'étape 4, sans barre finale ;
   - `TURNSTILE_SECRET_KEY` (`--sensitive`) et `NEXT_PUBLIC_TURNSTILE_SITE_KEY` : clés du widget de l'étape 5 ;
   - `CRON_SECRET` : nouvelle valeur ≥ 32 caractères, `--sensitive` (appels manuels seulement) ;
   - `SENTRY_ENVIRONMENT` et `NEXT_PUBLIC_SENTRY_ENVIRONMENT` = `preview`, plus les DSN si Sentry est voulu ;
   - facultatives : GeniusPay **sandbox** (3), R2 **bucket de test** (4), VAPID **paire propre** (3), Resend (quand un domaine existera).

   Ne jamais créer : `NEXT_PUBLIC_AUTH_URL`, `DATABASE_URL_UNPOOLED`, `QADR_PREVIEW_MODE`, `QADR_FILE_STORAGE`, `BETTER_AUTH_TRUSTED_ORIGINS`, ni aucune variable vide (R4).
7. **Relecture** : `vercel env ls preview --project web --scope qadragency`. Aucun nom ne doit apparaître à la fois en Preview et en Production sur la même ligne, et aucune valeur ne doit être recopiée depuis la production.
8. **Push** de `feat/mission-13-reprise` (§ 3.4, étape 4). Vercel construit la Preview.
9. **Contrôles sur la Preview**, en étant connecté à Vercel à cause de la protection :
   - `/login`, l'inscription d'un commerce (Turnstile staging) et `/platform/login` ;
   - une vente, puis la relecture des données sur la branche `mission-14-staging`, pour vérifier que l'écriture est arrivée en staging et pas ailleurs ;
   - les journaux de la fonction, sans erreur `readEnvironment`.
10. Plus tard : contournement de protection pour le webhook sandbox (R6), domaine et Resend (B8), puis la production après autorisation écrite de migrer `main`.

## 5. Ce qui n'a pas été vérifié

- Les **valeurs** des variables, et donc l'hôte réel visé par la `DATABASE_URL` de `qadrops` : seules les métadonnées le relient à `neon-charcoal-chair`.
- Le contenu de la base `neon-charcoal-chair`. Elle est archivée, et sa lecture l'aurait réveillée.
- Les libellés exacts de l'écran de connexion Neon ↔ Vercel, et l'option de création de branches pour les Preview.
- L'offre Vercel de l'équipe (Hobby ou Pro), le comportement de la protection sur une adresse `*.vercel.app` rattachée à une branche, et l'effet de `engines.node` face au réglage Node 26.x du projet.
- Les réglages GitHub autres que la visibilité (protection de `main`, webhooks) : la CLI `gh` n'est pas installée et l'API n'a été appelée que sans authentification.
