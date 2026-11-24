# Guide de configuration des services externes (production)

Audit du 2026-11-01, établi par lecture du code de `apps/web` et `apps/print-agent`, branche `feat/missions-08-10`.

**Rien n'a été créé sur une plateforme externe** : ni compte, ni clé, ni domaine, ni base. Aucune connexion à Neon, aucun déploiement. Une variable déclarée dans `.env.example` ne veut pas dire que le service fonctionne : chaque service reste **non vérifié** tant que les tests réels de la section 14 n'ont pas été faits.

> **Mise à jour du 2026-11-01 : l'hébergement retenu est Cloudflare Workers, pas Vercel.** Les sections 4 (Vercel) et 12 (crons Vercel) sont remplacées par `docs/cloudflare-deployment.md`. Sur Workers, la question du proxy (§ 8.2) ne se pose plus pour l'application, et Better Auth lit l'adresse IP dans `cf-connecting-ip`.

> Les informations sur les offres, les quotas et les écrans des fournisseurs (Vercel, Neon, Resend, Cloudflare, Sentry, PostHog) viennent de la documentation connue à la date de rédaction. Elles n'ont **pas pu être revérifiées en ligne** pendant cet audit (accès web indisponible). Vérifiez-les sur le site officiel au moment de configurer, et notez la date.

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Règles pour les secrets](#2-règles-pour-les-secrets)
3. [Inventaire des variables](#3-inventaire-des-variables)
4. [Vercel](#4-vercel-hébergement)
5. [Neon (PostgreSQL)](#5-neon-postgresql)
6. [Better Auth](#6-better-auth)
7. [Resend et sa liaison avec Better Auth](#7-resend-et-sa-liaison-avec-better-auth)
8. [Cloudflare (DNS, Turnstile)](#8-cloudflare-dns-turnstile)
9. [Sentry](#9-sentry)
10. [PostHog](#10-posthog)
11. [Web Push / VAPID](#11-web-push--vapid)
12. [Tâches planifiées](#12-tâches-planifiées-cron)
13. [Service local d'impression](#13-service-local-dimpression-print-agent)
14. [Permissions multi-tenant](#14-permissions-multi-tenant-ce-que-la-configuration-peut-casser)
15. [Ordre de mise en place](#15-ordre-de-mise-en-place-recommandé)
16. [Checklist finale](#16-checklist-finale)
17. [Modifications de code faites pendant cet audit](#17-modifications-de-code-faites-pendant-cet-audit)

---

## 1. Vue d'ensemble

| Service | Intégration dans le code | Indispensable en production | Vérifié en réel |
| --- | --- | --- | --- |
| Neon | **Intégré** : pilote `@neondatabase/serverless`, Drizzle, 13 migrations (0000–0012) | Oui | Non : jamais contacté |
| Better Auth | **Intégré** : comptes, sessions, commerces, invitations | Oui | Non : seulement sur PGlite |
| Resend | **Intégré** : réinitialisation, vérification d'adresse, invitations | **Oui, en pratique** (voir § 7.3) | Non : testé avec un faux client |
| Cloudflare DNS | Rien dans le code (configuration externe) | Oui, si le domaine y est géré | Non |
| Cloudflare Turnstile | **Intégré** : widget et vérification serveur | Oui (fortement recommandé) | Non : clés de test seulement |
| Cloudflare R2 | **Intégré** (mission 12, lot L2) : stockage privé de l'original des imports, signature SigV4 maison, `docs/storage-r2.md` | Non : sans R2, l'import fonctionne sans garder l'original | Non : jamais contacté (`fetch` simulé, vecteurs AWS) |
| Sentry | **Intégré** : serveur, edge et navigateur ; envoi des cartes sources **absent** | Recommandé | Non |
| PostHog | **Retiré le 2026-11-24** (mission performance) : plus aucun envoi, ni bibliothèque, ni bandeau. | — | — |
| Web Push / VAPID | **Intégré** : chiffrement maison, abonnement par appareil | Facultatif | Non : vecteur RFC seulement |
| Cron | **Intégré** : deux routes, déclarées dans `apps/web/vercel.json` | Recommandé | Non |
| Vercel | **Partiel** : `vercel.json` (crons) seulement ; projet non créé | Oui (hébergeur retenu) | Non |
| Print Agent | **Intégré** : service local sans dépendance | Facultatif (par commerce) | Imprimante simulée seulement |

---

## 2. Règles pour les secrets

- **Aucune valeur réelle dans Git.** `.env.example` ne contient que des noms et des valeurs vides ou d'exemple. Les fichiers `.env*` (sauf `.env.example`) sont ignorés par Git. Aucun fichier `.env.local` n'existe aujourd'hui dans `apps/web`.
- **Où les ranger :**
  - en production : dans Vercel → *Settings → Environment Variables*, environnement **Production**, case *Sensitive* cochée pour chaque secret ;
  - pour vos essais locaux : dans `apps/web/.env.local` (jamais commité).
- **Le préfixe `NEXT_PUBLIC_` rend une valeur publique.** Elle est copiée dans le JavaScript envoyé au navigateur **au moment du build**. Conséquences :
  - ne mettez jamais de secret dans une variable `NEXT_PUBLIC_…` ;
  - si vous changez une variable `NEXT_PUBLIC_…`, il faut **redéployer** pour que le changement soit pris en compte.
- **Une valeur par environnement.** Vercel distingue *Production*, *Preview* et *Development*. Les déploiements *Preview* ne doivent **jamais** recevoir la base ou les clés de production (voir § 4.4 et § 5.2).
- **Générer vous-même les secrets**, sur votre ordinateur, sans les coller dans un chat ni un ticket :

  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  ```

  Cette commande donne 43 caractères aléatoires, assez pour `BETTER_AUTH_SECRET`, `CRON_SECRET` et `NOTIFICATIONS_CRON_SECRET`. Utilisez une valeur différente pour chacun.

---

## 3. Inventaire des variables

Inventaire tiré de toutes les lectures de `process.env` dans `apps/web` (schéma `src/lib/env.ts` et lectures directes).

### 3.1 Variables lues par l'application

| Variable | Lue dans | Côté | En production |
| --- | --- | --- | --- |
| `DATABASE_URL` | `lib/env.ts` → `lib/db/client.ts`, `lib/auth/server.ts`, scripts | Serveur | **Obligatoire** |
| `BETTER_AUTH_SECRET` | `lib/auth/server.ts` (32 caractères au moins) | Serveur | **Obligatoire** |
| `BETTER_AUTH_URL` | `lib/auth/server.ts` | Serveur | **Obligatoire**, en HTTPS. Sans elle, l'authentification refuse désormais de démarrer (§ 17). |
| `NEXT_PUBLIC_AUTH_URL` | `lib/auth/client.ts` | Navigateur (build) | Facultative : vide = origine courante. Si renseignée, identique à `BETTER_AUTH_URL`. |
| `TURNSTILE_SECRET_KEY` | `lib/auth/turnstile.ts` via `server.ts` | Serveur | **Obligatoire** : en production, l'absence de clé fait échouer connexion et inscription. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `components/auth/turnstile-widget.tsx` | Navigateur (build) | **Obligatoire**, avec la précédente (les deux ensemble, sinon erreur de configuration) |
| `RESEND_API_KEY` | `lib/auth/email.ts` | Serveur | **Obligatoire en pratique** (§ 7.3) |
| `RESEND_FROM_EMAIL` | `lib/auth/email.ts` | Serveur | **Obligatoire**, avec la précédente (les deux ensemble) |
| `RESEND_REPLY_TO` | `lib/auth/email.ts` | Serveur | Facultative |
| `SENTRY_DSN` | `sentry.server.config.ts`, `sentry.edge.config.ts` | Serveur | Recommandée |
| `SENTRY_ENVIRONMENT` | idem | Serveur | Recommandée (`production`) |
| `NEXT_PUBLIC_SENTRY_DSN` | `src/instrumentation-client.ts` | Navigateur (build) | Recommandée |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | idem | Navigateur (build) | Recommandée (`production`) |
| ~~`NEXT_PUBLIC_POSTHOG_KEY`~~ | Retirée le 2026-11-24 | — | Ne plus définir |
| ~~`NEXT_PUBLIC_POSTHOG_HOST`~~ | Retirée le 2026-11-24 | — | Ne plus définir |
| `VAPID_PUBLIC_KEY` | `lib/notifications/server.ts` (servie par `/api/notifications/push-config`) | Serveur | Facultative (push) |
| `VAPID_PRIVATE_KEY` | idem | Serveur | Facultative (push), secret |
| `VAPID_SUBJECT` | idem | Serveur | Facultative (push) : `mailto:` ou `https://` |
| `CRON_SECRET` | `api/cron/subscriptions`, `api/internal/notifications/process` | Serveur | Recommandée (crons Vercel) |
| `NOTIFICATIONS_CRON_SECRET` | `api/internal/notifications/process` | Serveur | Facultative : seulement pour un planificateur externe en `POST` |
| `DATABASE_URL_UNPOOLED` | `drizzle.config.ts`, `scripts/migrate.ts` (`requireMigrationDatabaseUrl`) | Terminal (migrations) | Facultative : chaîne **directe** Neon, sinon `DATABASE_URL`. Jamais lue par l'application |
| `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `lib/storage/config.ts` | Serveur | Facultatives, **les quatre ensemble** ; `R2_SECRET_ACCESS_KEY` est un secret. Sans elles en production : aucun fichier conservé |
| `R2_JURISDICTION` | idem | Serveur | Facultative : `eu` ou `fedramp` si le bucket a été créé dans une juridiction |
| `QADR_STORAGE_IMPORT_MAX_BYTES`, `QADR_STORAGE_IMPORT_RETENTION_DAYS`, `QADR_STORAGE_EXPORT_*` | idem | Serveur | Facultatives et bornées (défauts : 2 Mio et 90 jours pour les originaux d'import) |

### 3.2 Variables techniques ou réservées à certains usages

| Variable | Rôle | En production |
| --- | --- | --- |
| `NODE_ENV` | Fournie par Next.js et Vercel (`production`) | Ne pas définir |
| `NEXT_RUNTIME` | Fournie par Next.js | Ne pas définir |
| `QADR_PREVIEW_MODE` | Démonstration locale PGlite. Refusée hors développement. | **Ne pas définir** (ou `false`) |
| `PORT` | Port local de la prévisualisation | Ne pas définir |
| `SENTRY_TEST_ENABLED` | Route de test Sentry, active **seulement** en développement | Ne pas définir |
| `QADR_FILE_STORAGE` | `memory` : stockage de fichiers en mémoire, développement et tests seulement | **Refusée en production** |
| `QADR_DB_TARGET` | Garde-fou des scripts `migrate.ts` et `platform-admin.ts`, à définir dans votre terminal au moment de la commande | **Jamais dans Vercel** |

### 3.3 Variables déclarées mais inutilisées

| Variable | État |
| --- | --- |
| `QADR_SESSION_SECRET`, `QADR_DATA_FILE`, `QADR_BOOTSTRAP_ADMIN_*` | Propres à l'ancien MVP de la racine. **Sans effet** sur `apps/web`. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | **Non lues** : l'envoi des cartes sources n'est pas branché (§ 9.4). Inutile de les créer aujourd'hui. |

---

## 4. Vercel (hébergement)

> **Abandonné** : l'application sera hébergée sur Cloudflare Workers (`docs/cloudflare-deployment.md`). Section conservée pour mémoire.

**État : partiel.** Seul `apps/web/vercel.json` existe ; il déclare les deux tâches planifiées. Aucun projet Vercel n'a été créé.

### 4.1 Ce que vous devez fournir

- Un compte Vercel et un forfait qui **autorise l'usage commercial**. L'offre gratuite *Hobby* est réservée à un usage personnel non commercial : pour Qadr Ops, prévoyez *Pro* (payant, par membre et par mois ; tarif à vérifier).
- L'accès au dépôt GitHub.
- Le nom de domaine choisi (par exemple `app.votredomaine.ci`).

### 4.2 Étapes

1. *Add New → Project* → importer le dépôt GitHub.
2. **Root Directory : `apps/web`**. C'est indispensable : l'application, `vercel.json` et les migrations y sont.
3. Laisser Framework = Next.js. Fixer :
   - Install Command : `npm ci` ;
   - Build Command : `npm run build` (le script appelle `next build --webpack`).
4. *Settings → General → Node.js Version* : **24.x** (`engines` de `package.json`). Vérifiez que Vercel la propose ; sinon la plus récente disponible, après un build d'essai.
5. *Settings → Functions → Region* : choisir **la même région que la base Neon** (§ 5.1), par exemple Francfort (`fra1`) avec Neon `aws-eu-central-1`. Une base et des fonctions éloignées ajoutent la latence de l'aller-retour à chaque requête.
6. *Settings → Environment Variables* : saisir les variables du § 3.1, environnement par environnement (§ 4.4). Cocher *Sensitive* pour chaque secret.
7. *Settings → Domains* : ajouter le domaine, puis :
   - choisir **une seule adresse canonique** et rediriger l'autre vers elle (par exemple `www` → sans `www`) ;
   - `BETTER_AUTH_URL` doit être exactement cette adresse canonique (§ 6).
8. *Settings → Deployment Protection* : protéger les déploiements *Preview* (accès réservé à l'équipe).

> **Attention : connecter le dépôt déclenche des déploiements automatiques.** Un `git push` vers une branche suivie déploie. Ne connectez le dépôt qu'au moment où vous décidez de déployer.

### 4.3 Points du code qui dépendent de Vercel

- `after()` (e-mails et notifications envoyés après la réponse) s'appuie sur `waitUntil`, géré par Vercel.
- Toutes les routes qui touchent la base fonctionnent en runtime Node.js. Le pilote Neon exige `WebSocket`, présent dans Node 22 et plus.
- Les crons sont déclarés dans `vercel.json` (§ 12).
- Adresse IP du client : Better Auth limite le débit par adresse IP lue dans `x-forwarded-for`, que Vercel renseigne lui-même. **Cela suppose que Cloudflare ne soit pas en mode proxy** (§ 8.2).

### 4.4 Variables par environnement

| Environnement Vercel | Base | `BETTER_AUTH_URL` | Clés tierces |
| --- | --- | --- | --- |
| Production | branche Neon `main` | `https://app.votredomaine.ci` | clés de production |
| Preview | **branche Neon de test, jamais la production** | domaine fixe de test, par exemple `https://staging.votredomaine.ci` (rattaché à une branche Git dans *Domains*) | clés distinctes de test |
| Development | rien (utiliser `npm run preview` en local) | — | — |

Pourquoi un domaine fixe pour les *Preview* :
- Better Auth n'accepte que l'origine `BETTER_AUTH_URL` (`trustedOrigins`). Les adresses aléatoires `*.vercel.app` ne permettent donc pas de se connecter.
- Turnstile vérifie le nom de domaine.
- En **Production** (2026-11-18), les autres adresses du projet (ex. `web-qadragency.vercel.app`) renvoient chaque page en 307 vers celle de `BETTER_AUTH_URL` (`lib/canonical-host.ts`), sauf `/api/*` et `/_next/*`.
- Sur Vercel, `NODE_ENV` vaut `production` **aussi en Preview**. Les clés de test Turnstile y sont donc refusées : il faut une vraie clé Turnstile qui autorise le domaine de test.

---

## 5. Neon (PostgreSQL)

**État : intégré, jamais contacté.**

**Fichiers :**
- `src/lib/db/client.ts` : `Pool` WebSocket, qui permet les transactions interactives ;
- `src/lib/db/schema.ts` et `drizzle/0000…0012` : 13 migrations, avec des déclencheurs d'audit, de caisse et de notifications ;
- `drizzle.config.ts` ;
- les scripts `scripts/migrate.ts`, `scripts/check-database.ts` et `scripts/platform-admin.ts`.

**Variables :** `DATABASE_URL` (chaîne *pooled*, application) et, pour les migrations seulement, `DATABASE_URL_UNPOOLED` (chaîne directe, repli sur `DATABASE_URL`). Procédure de première connexion : `docs/storage-r2.md` § 6.1 (mission 12, lot L2).

### 5.1 Étapes

1. Créer un compte Neon, puis un projet `qadr-ops` dans une région proche de l'Afrique de l'Ouest et **identique à celle des fonctions Vercel** (par exemple `aws-eu-central-1`, Francfort).
2. Créer une branche de test (`staging`), issue de `main` mais vide de données réelles.
3. Pour chaque branche, copier deux chaînes de connexion dans *Connection Details*, toutes deux avec `sslmode=require` :
   - **pooled** (l'hôte contient `-pooler`) : pour l'application (`DATABASE_URL` dans Vercel) ;
   - **directe** (sans `-pooler`) : pour les migrations, dans votre terminal seulement, sous le nom `DATABASE_URL_UNPOOLED` (lu par `drizzle.config.ts` et `npm run db:migrate`).
4. Mettre la chaîne *pooled* de `main` dans Vercel *Production*, et celle de `staging` dans Vercel *Preview*.
5. Activer une alerte de consommation et vérifier la durée de restauration (*point-in-time restore*) incluse dans le forfait.

### 5.2 Migrations : décision et autorisation nécessaires

- `npm run db:migrate` **refuse de s'exécuter** si `QADR_DB_TARGET` ne vaut pas `development`, puis demande une phrase de confirmation. **Aucune procédure de migration de production n'existe dans le code**, et c'est volontaire (règles du projet).
- Procédure proposée, **à valider par vous avant toute exécution** :
  1. appliquer les 13 migrations sur la branche Neon `staging` (`QADR_DB_TARGET=development`, chaîne directe de `staging`) ;
  2. tester l'application en *Preview* ;
  3. ajouter au script une cible `production` explicite (point B de la checklist) ;
  4. appliquer sur `main` avec votre autorisation écrite.
- Les migrations sont additives. Aucune n'est destructive sur une base vide.

### 5.3 Premier Super Admin

Une fois la production migrée, procédez ainsi :
1. Créez votre compte normalement sur `/register`.
2. Depuis votre ordinateur, avec la chaîne directe de `main` :

```powershell
cd apps/web
$env:DATABASE_URL = '<chaîne directe main, collée localement>'
$env:QADR_DB_TARGET = 'production'
npx tsx scripts/platform-admin.ts grant --email vous@votredomaine.ci --reason "Ouverture de la console"
Remove-Item Env:DATABASE_URL; Remove-Item Env:QADR_DB_TARGET
```

La commande demande de taper `CONFIRMER` et inscrit l'opération au journal d'audit. Aucune route web ne peut attribuer ce droit.

### 5.4 Points d'attention

- **Une connexion par requête.** `createDatabase()` crée un nouveau `Pool` à chaque requête, sans le fermer ; les connexions inactives se ferment d'elles-mêmes après quelques secondes. C'est correct pour un petit trafic, mais coûteux : une nouvelle poignée de main WebSocket et une nouvelle connexion à chaque requête. **Recommandation :** un `Pool` partagé par instance (point B, à faire avant d'ouvrir à plusieurs commerces).
- **Un seul rôle de base.** L'application et les migrations utilisent le même rôle, propriétaire. Option plus sûre : un rôle applicatif sans droit DDL, et un rôle de migration réservé à vous.
- **Pas de RLS PostgreSQL.** L'isolation entre commerces est assurée par les services (§ 14).
- **Suspension automatique.** Sur les petits forfaits, le calcul se met en veille après inactivité, et la première requête suivante est plus lente.

---

## 6. Better Auth

**État : intégré.** Fichiers : `src/lib/auth/server.ts` (configuration unique `createQadrAuth`, instance `getAuth()`), `client.ts`, `permissions.ts`, `turnstile.ts`, `email.ts`, `src/proxy.ts` (redirection vers `/login`, qui n'est pas un contrôle de sécurité). Les tables d'authentification font partie des migrations Drizzle : Better Auth n'a pas de migration séparée.

**Variables :**
- `BETTER_AUTH_SECRET` : obligatoire, 32 caractères au moins ;
- `BETTER_AUTH_URL` : obligatoire, en HTTPS ;
- `NEXT_PUBLIC_AUTH_URL` : facultative.

**Aucun compte à créer** : Better Auth est une bibliothèque, pas un service.

### 6.1 Étapes

1. Générer `BETTER_AUTH_SECRET` (§ 2) et le mettre dans Vercel *Production*. Une autre valeur pour *Preview*.
2. `BETTER_AUTH_URL` = l'adresse canonique exacte, sans barre finale (`https://app.votredomaine.ci`). Elle sert à la fois :
   - de domaine des cookies de session (`Secure` en production) ;
   - de seule origine de confiance (protection CSRF) ;
   - de base des liens des e-mails (réinitialisation, vérification, invitation) ;
   - de nom de domaine attendu par Turnstile.
3. `NEXT_PUBLIC_AUTH_URL` : laisser vide (le navigateur appelle alors l'origine courante) ou mettre la même valeur. Une valeur différente, `www` d'un côté et sans `www` de l'autre par exemple, casse la connexion.
4. **Ne jamais changer `BETTER_AUTH_SECRET` sans raison** : toutes les sessions et tous les liens en cours deviennent invalides.

### 6.2 Décisions encore ouvertes (à vous)

- **Limitation de débit.** Elle est en mémoire, donc propre à chaque instance serverless ; c'est insuffisant à plusieurs instances. Proposition : stockage en base (nouvelle table, à préparer en local) (`docs/authentication.md` § 7).
- **Vérification d'adresse à l'inscription** : non exigée aujourd'hui.

---

## 7. Resend et sa liaison avec Better Auth

**État : intégré, testé avec un faux client uniquement.**

**Fichiers :**
- `src/lib/auth/email.ts` : transport, réessais, idempotence ;
- `email-templates.ts` : modèles fr/en/ar ;
- `server.ts` : branchement à Better Auth.

**Variables :**
- `RESEND_API_KEY` et `RESEND_FROM_EMAIL`, **ensemble** ;
- `RESEND_REPLY_TO`, facultative.

### 7.1 Liaison vérifiée dans le code

| Envoi | Déclencheur Better Auth | Lien contenu |
| --- | --- | --- |
| Réinitialisation du mot de passe | `emailAndPassword.sendResetPassword` | Généré par Better Auth à partir de `BETTER_AUTH_URL` |
| Vérification d'adresse (à la demande, session requise) | `emailVerification.sendVerificationEmail` | idem |
| Invitation d'équipe | `organization.sendInvitationEmail` | `BETTER_AUTH_URL/invitations/<id>` |

- Ces trois fonctions ne sont branchées **que si** `RESEND_API_KEY` et `RESEND_FROM_EMAIL` sont présentes (`resolveEmailTransport()`). Sinon rien n'est envoyé ni simulé, et l'interface l'indique.
- Les envois partent **après** la réponse HTTP (`advanced.backgroundTasks` → `after()`). La réponse est la même, que le compte existe ou non.
- La langue du message est celle du cookie de langue de la personne qui fait la demande. Pour une invitation, c'est la langue choisie pour l'invité.

### 7.2 Configuration partielle : panne totale

Si une seule des deux variables est renseignée, `readEnvironment()` lève une erreur. Comme cette fonction est appelée à chaque démarrage de l'authentification, **tous les écrans de connexion tombent en panne**. Saisissez donc toujours les deux ensemble. Il en va de même pour les deux clés Turnstile.

### 7.3 Pourquoi Resend est indispensable en production

- En production, accepter une invitation exige une adresse vérifiée (`invitationRequiresVerifiedEmail`). Sans e-mail, personne ne peut vérifier son adresse, donc **aucun employé ne peut rejoindre un commerce**.
- La réinitialisation de mot de passe est également impossible.

### 7.4 Étapes

1. Créer un compte Resend (offre gratuite limitée par jour et par mois ; montants à vérifier).
2. *Domains → Add Domain* : utiliser un **sous-domaine d'envoi**, par exemple `mail.votredomaine.ci`, pour protéger la réputation du domaine principal. Choisir la région la plus proche (Europe).
3. Resend affiche des enregistrements DNS à créer dans Cloudflare (§ 8.1). En général :
   - un `MX` et un `TXT` (SPF) sur un sous-domaine de retour ;
   - un `TXT` DKIM `resend._domainkey…` ;
   - un `TXT` DMARC `_dmarc`, recommandé (commencer par `p=none`).

   **Recopiez exactement les valeurs affichées par Resend.** Elles sont propres à votre compte.
4. Attendre le statut *Verified*.
5. *API Keys → Create* : droit **Sending access**, limité à ce domaine. La clé n'est affichée qu'une fois : la coller directement dans Vercel (`RESEND_API_KEY`, *Sensitive*).
6. `RESEND_FROM_EMAIL` = `QADR OPS <no-reply@mail.votredomaine.ci>`. Le domaine doit être celui qui a été vérifié.
7. `RESEND_REPLY_TO` = une boîte de support réellement lue, si vous en avez une.

---

## 8. Cloudflare (DNS, Turnstile)

### 8.1 DNS

**État : rien dans le code.** Configuration entièrement externe.

À fournir : un domaine acheté, et un compte Cloudflare avec l'offre gratuite.

1. *Add a site* → saisir le domaine → offre gratuite.
2. Chez le registraire du domaine, remplacer les serveurs de noms par les deux serveurs indiqués par Cloudflare. La propagation prend de quelques minutes à 48 h.
3. Créer les enregistrements :

| Nom | Type | Valeur | Proxy |
| --- | --- | --- | --- |
| `app` (ou `@`) | `CNAME` (ou `A` pour la racine) | **valeur affichée par Vercel** dans *Domains* (souvent `cname.vercel-dns.com`, ou une adresse IP pour la racine) | **DNS only** (nuage gris) |
| `staging` | `CNAME` | idem | DNS only |
| Enregistrements Resend | `MX`, `TXT` | valeurs affichées par Resend | DNS only (non proxifiable) |

4. *SSL/TLS* : si un enregistrement passe un jour en mode proxy, utiliser le mode **Full (strict)**, jamais *Flexible*.

### 8.2 Proxy Cloudflare devant Vercel : écart avec la documentation existante

`docs/cloudflare-evaluation.md` recommandait le proxy (nuage orange) devant l'hébergeur. **Avec le code actuel et Vercel, je recommande au contraire le mode DNS only**, pour trois raisons :

1. **Limitation de débit.** Better Auth identifie le client par `x-forwarded-for`. Derrière le proxy, Vercel verrait les adresses de Cloudflare : tous les utilisateurs d'un même nœud partageraient la même limite, et des blocages seraient possibles.
2. **Double CDN.** Vercel a déjà son propre CDN et ses certificats ; le proxy ajoute une couche de cache à régler (ne jamais mettre en cache `/api/*` ni les pages connectées).
3. **Turnstile marche sans proxy.**

Si vous voulez quand même le WAF de Cloudflare, il faudra :
- **ne pas** se contenter de lire `cf-connecting-ip` : sur Vercel, un client qui joint directement l'adresse `*.vercel.app` peut envoyer cet en-tête avec la valeur de son choix et échapper à la limitation par adresse IP (correction de la mission 16). Il faut **ensemble** : un en-tête secret ajouté par une règle Cloudflare et vérifié par l'application, le refus du trafic direct sur l'adresse Vercel de production, puis une modification de `client-ip-headers.ts` qui ne lit `cf-connecting-ip` qu'avec ce secret (détail : `docs/engineering/mission-16-cloudflare-r2-push.md` § 2.3) ;
- créer des règles de contournement du cache pour `/api/*`, `/business/*` et `/platform/*`.

À trancher par vous.

### 8.3 Turnstile

**État : intégré.**

**Fichiers :**
- `components/auth/turnstile-widget.tsx` ;
- `src/lib/auth/turnstile.ts` : appel à Siteverify ; contrôle du nom de domaine et de l'action ; jeton réutilisé refusé ; clés de test refusées en production.

**Formulaires protégés :** inscription (`register`), connexion (`login`), mot de passe oublié (`password-reset`).

1. Cloudflare → *Turnstile → Add widget*, mode *Managed*.
2. Noms de domaine autorisés :
   - le domaine de production **exact**, celui de `BETTER_AUTH_URL` (le serveur compare le nom de domaine renvoyé par Cloudflare à celui de `BETTER_AUTH_URL`) ;
   - un second widget pour `staging`.
3. Clé du site → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Clé secrète → `TURNSTILE_SECRET_KEY` (*Sensitive*). **Les deux ensemble.**
4. Le formulaire envoie lui-même le nom d'action : rien à configurer dans Cloudflare pour les actions.

### 8.4 R2

**État : intégré (mission 12, lot L2), jamais contacté.** Bucket privé (jamais public), jeton *Object Read & Write* limité à ce seul bucket, variables Vercel, aucune règle CORS nécessaire : voir `docs/storage-r2.md` § 4. Sans R2, l'import de catalogue fonctionne mais l'original n'est pas conservé, et l'écran le dit.

---

## 9. Sentry

**État : intégré** (erreurs seulement, sans performance ni session replay). Envoi des cartes sources absent.

### 9.1 Fichiers et variables

| Côté | Fichier | Variables |
| --- | --- | --- |
| Serveur Node.js | `sentry.server.config.ts`, chargé par `src/instrumentation.ts` | `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |
| Edge (`proxy.ts`) | `sentry.edge.config.ts` | idem |
| Navigateur | `src/instrumentation-client.ts`, `app/global-error.tsx` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (figées au build) |

- **Données envoyées.** Le filtre `beforeSend` supprime l'utilisateur, la requête, les contextes, les étiquettes, le fil d'Ariane et le texte des erreurs. Seuls partent le type d'erreur et la pile d'appels. Rien n'est envoyé sans DSN.
- **Corrigé pendant cet audit (§ 17).** Avant, les erreurs serveur imprévues des 71 routes API étaient converties en réponse 500 **sans jamais atteindre Sentry**. Les erreurs de rendu serveur non plus. Les deux sont maintenant transmises.

### 9.2 Étapes

1. Créer une organisation Sentry, puis un projet de plateforme *Next.js* (`qadr-ops-web`). Choisir l'hébergement des données en **Union européenne** à la création de l'organisation.
2. Copier le DSN. Ce n'est pas un secret : il est visible dans le navigateur.
3. Dans Vercel *Production* :
   - `SENTRY_DSN` = `NEXT_PUBLIC_SENTRY_DSN` = ce DSN ;
   - `SENTRY_ENVIRONMENT` = `NEXT_PUBLIC_SENTRY_ENVIRONMENT` = `production`.

   En *Preview* : même DSN, environnement `preview`.
4. Redéployer, car les variables `NEXT_PUBLIC_…` sont figées au build.
5. Sentry → *Settings → Subscription / Spend* : fixer un plafond. Activer *Data Scrubbing* comme seconde protection.

### 9.3 Limites

- Les bloqueurs de publicité peuvent empêcher l'envoi depuis le navigateur. Aucun tunnel n'est configuré.
- La route `/api/observability/sentry-test` ne fonctionne **qu'en développement**. Pour tester avec le DSN de production, voir § 16 C.

### 9.4 Optionnel : cartes sources (piles lisibles côté navigateur)

Sans cartes sources, les piles d'appels du navigateur restent minifiées. Pour les rendre lisibles, il faudrait :
- envelopper `next.config.ts` avec `withSentryConfig` ;
- ajouter `SENTRY_AUTH_TOKEN` (secret, build seulement), `SENTRY_ORG` et `SENTRY_PROJECT`.

Non fait : cela change le build et demande un jeton. Décision à prendre (point B facultatif).

---

## 10. PostHog

> **Retiré le 2026-11-24** (mission performance) : plus aucun envoi, ni bibliothèque, ni bandeau. Les étapes ci-dessous sont caduques.

**État : intégré.**

**Fichiers :**
- `src/lib/analytics/events.ts` : catalogue fermé ;
- `client.ts` ;
- `components/analytics-provider.tsx` : bandeau de consentement.

Détail : `docs/analytics.md`.

**Variables :** `NEXT_PUBLIC_POSTHOG_KEY` et `NEXT_PUBLIC_POSTHOG_HOST`. **Les deux sont nécessaires** : sans l'hôte, PostHog reste éteint, car la valeur par défaut du schéma serveur ne s'applique pas dans le navigateur.

1. Créer une organisation PostHog en **région UE** (définitive à la création).
2. Créer un projet. Copier la **clé publique de projet** (`phc_…`), jamais une clé personnelle d'API.
3. Dans Vercel :
   - `NEXT_PUBLIC_POSTHOG_KEY` = `phc_…` ;
   - `NEXT_PUBLIC_POSTHOG_HOST` = `https://eu.i.posthog.com`.

   Puis redéployer.
4. Dans le projet PostHog, couper aussi côté serveur, en double sécurité : autocapture, session replay, heatmaps, enquêtes.
5. Fixer une **limite de facturation**.

Facultatif : sans ces variables, rien n'est chargé et l'application fonctionne normalement.

---

## 11. Web Push / VAPID

**État : intégré.**

**Fichiers :**
- `src/lib/notifications/web-push.ts` (RFC 8291/8292) ;
- `server.ts` ;
- `client.ts` ;
- `public/sw.js` ;
- route `/api/notifications/push-config`, qui donne la clé publique au navigateur.

**Variables :** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret) et `VAPID_SUBJECT`.

1. Générer la paire **vous-même**, en local :

   ```powershell
   cd apps/web
   node scripts/generate-vapid-keys.mjs
   ```

2. Copier les deux valeurs dans Vercel *Production* (la clé privée en *Sensitive*). Utiliser une autre paire pour *Preview*.
3. `VAPID_SUBJECT` = `mailto:support@votredomaine.ci`, une adresse réellement lue : les services de push l'utilisent pour vous joindre en cas d'abus.
4. **Ne jamais changer la paire après la mise en service** : tous les abonnements existants deviennent invalides, et chaque appareil doit se réabonner.

Aucun compte n'est nécessaire : Google, Mozilla, Apple et Microsoft acceptent les envois signés VAPID. Le code n'envoie qu'à leurs adresses (`isAllowedPushEndpoint`).

**Limite iOS.** Sur iPhone et iPad, le push web ne fonctionne que pour une application **installée sur l'écran d'accueil** (iOS 16.4 et plus). Cela demande un manifeste web, qui **n'existe pas** dans le projet (point B).

Sans VAPID, les notifications internes (cloche, boîte de réception) fonctionnent ; seul le push est désactivé.

---

## 12. Tâches planifiées (cron)

> **Remplacé** : sur Cloudflare, les mêmes routes sont appelées par des Cron Triggers (`wrangler.jsonc`, `cloudflare/worker.ts`), voir `docs/cloudflare-deployment.md` § 5. `CRON_SECRET` reste nécessaire.

**État : intégré.** Corrigé pendant cet audit pour être compatible avec Vercel Cron (§ 17).

| Route | Rôle | Planification (`apps/web/vercel.json`, heure UTC = heure d'Abidjan) | Secret |
| --- | --- | --- | --- |
| `GET /api/cron/subscriptions` | Fait passer à « expiré » les abonnements arrivés à échéance, puis supprime du stockage les fichiers échus et les envois orphelins (`docs/storage-r2.md` § 2.3) | `0 1 * * *` (1 h) | `CRON_SECRET` ; sans lui, la route répond 404 |
| `GET` ou `POST /api/internal/notifications/process` | Rattrape la boîte d'envoi des notifications et prévient des abonnements qui finissent dans 3 jours | `0 7 * * *` (7 h) | `CRON_SECRET` (Vercel) ou `NOTIFICATIONS_CRON_SECRET` (planificateur externe) |

1. Générer `CRON_SECRET` (§ 2) et le mettre dans Vercel *Production*. Vercel l'envoie de lui-même dans `Authorization: Bearer …` à chaque exécution.
2. Les crons ne s'exécutent que sur le déploiement **de production**. L'offre *Hobby* les limite à une exécution par jour, à une heure approximative. Une fréquence plus élevée demande *Pro* ; dans ce cas, modifier `schedule`.
3. `NOTIFICATIONS_CRON_SECRET` n'est utile que si un planificateur externe appelle la route en `POST`. Sinon, ne pas le créer.
4. Suivre les exécutions dans Vercel → *Cron Jobs* / *Logs*.

Sans cron : les notifications partent quand même juste après chaque opération (`after()`), et l'expiration est appliquée à la lecture. Le cron est un rattrapage.

---

## 13. Service local d'impression (Print Agent)

**État : intégré.** Ce n'est pas un service en ligne : il tourne sur l'ordinateur de caisse de chaque commerce qui active le module.

**Fichiers :** `apps/print-agent/src/*.mjs`, `config.example.json` ; côté web, `src/lib/printing/agent-client.ts`.

**Variables d'environnement :** aucune. Toute la configuration est dans `apps/print-agent/agent-config.json`, local à chaque ordinateur et désormais ignoré par Git.

**Par ordinateur de caisse :**
1. Installer Node.js 20 ou plus.
2. Copier `config.example.json` en `agent-config.json` et y renseigner :
   - `allowedOrigins` : **exactement** l'adresse de production, `https://app.votredomaine.ci`, sans barre finale. Une origine absente fait refuser toutes les requêtes ;
   - `printers` : les imprimantes, en TCP 9100, partage Windows ou périphérique.
3. Lancer `node src/cli.mjs`, puis saisir le code d'appairage dans Qadr Ops → *Imprimante*.

À savoir :
- Le service écoute seulement sur `127.0.0.1:17777`. Une page HTTPS qui appelle `http://127.0.0.1` est acceptée par Chrome et Edge (en-tête *Private Network Access* fourni). **Firefox et Safari ne sont pas testés.**
- Pas d'installateur, pas de démarrage automatique avec Windows, pas de signature : à prévoir avant un déploiement chez plusieurs commerçants.
- **Aucune imprimante physique n'a été testée** (`docs/printing.md` § 4).

---

## 14. Permissions multi-tenant : ce que la configuration peut casser

L'isolation entre commerces ne dépend d'aucune variable. Le commerce actif vient toujours de la session côté serveur (`business-context.ts`, `assertActiveMembership`), jamais d'un identifiant envoyé par le navigateur. 11 fichiers de tests contiennent des scénarios « commerce A / commerce B ».

En revanche, la configuration peut l'affaiblir :

| Risque | Protection |
| --- | --- |
| Une *Preview* pointe sur la base de production | Base `staging` distincte (§ 4.4) |
| Fuite de la chaîne de connexion | Variable *Sensitive* dans Vercel, jamais dans un terminal partagé, jamais dans un journal |
| Droit Super Admin attribué par erreur | Script `platform-admin.ts` seulement, `QADR_DB_TARGET` explicite, confirmation `CONFIRMER`, audit |
| Routes planifiées, qui traitent tous les commerces | Secret de 32 caractères au moins, comparé en temps constant. Chaque notification garde son `business_id` et ses destinataires sont recalculés selon les permissions. |
| Limite de débit contournée ou partagée | Mode DNS only (§ 8.2), puis stockage en base (§ 6.2) |
| Données personnelles vers Sentry ou PostHog | Filtres `beforeSend` (Sentry, PostHog) et catalogue fermé |

---

## 15. Ordre de mise en place recommandé

1. Domaine et Cloudflare DNS.
2. Neon : projet, branches `main` et `staging`.
3. Resend : vérification du domaine, qui demande des enregistrements DNS et donc un délai.
4. Turnstile : widgets production et staging.
5. Sentry et PostHog : projets en UE.
6. Clés VAPID et secrets, générés en local.
7. Projet Vercel : variables d'abord, connexion du dépôt ensuite, **avec votre accord de déployer**.
8. Migrations sur `staging`, tests en *Preview*, puis migrations sur `main` **avec votre autorisation**.
9. Premier Super Admin.
10. Tests réels (§ 16 C), puis ouverture à un premier commerce pilote.

---

## 16. Checklist finale

### A. À faire par vous sur les plateformes

- [ ] Acheter le domaine. Le confier à Cloudflare (serveurs de noms) ; offre gratuite.
- [ ] Vercel : compte en **forfait autorisant l'usage commercial (Pro)**. Projet avec Root Directory `apps/web`, Node 24.x, région des fonctions = région Neon, Deployment Protection sur les *Preview*.
- [ ] Vercel : saisir les variables du § 3.1 pour *Production* et *Preview*, secrets en *Sensitive*. Ne pas définir `QADR_PREVIEW_MODE`, `SENTRY_TEST_ENABLED` ni `QADR_DB_TARGET`.
- [ ] Vercel *Domains* : domaine de production (adresse canonique et redirection de l'autre) et domaine fixe `staging` rattaché à une branche.
- [ ] Cloudflare DNS : enregistrements Vercel en **DNS only**. Décider si vous voulez le proxy (§ 8.2).
- [ ] Neon : projet dans la région choisie, branches `main` et `staging`, chaînes *pooled* dans Vercel, chaînes directes gardées pour les migrations, alerte de consommation.
- [ ] Resend : sous-domaine d'envoi, enregistrements DNS copiés à l'identique, statut *Verified*, clé *Sending access* limitée au domaine, adresse d'expédition.
- [ ] Turnstile : un widget pour la production (domaine exact) et un pour `staging`.
- [ ] Sentry : organisation en UE, projet Next.js, DSN dans les 4 variables, plafond de dépense.
- [ ] ~~PostHog~~ : retiré le 2026-11-24, rien à faire.
- [ ] Générer en local : `BETTER_AUTH_SECRET`, `CRON_SECRET` (et `NOTIFICATIONS_CRON_SECRET` si planificateur externe), clés VAPID. Une valeur distincte par environnement.
- [ ] Donner votre autorisation écrite pour : (1) connecter le dépôt à Vercel et déployer ; (2) migrer `staging` ; (3) migrer la production.
- [ ] Créer votre compte sur `/register`, puis lancer `platform-admin.ts grant` (§ 5.3).
- [ ] Indiquer la marque et le modèle des imprimantes des commerçants pilotes.

### B. À configurer dans le code (par moi, sur votre accord)

Fait pendant cet audit (§ 17) :
- [x] Erreurs serveur imprévues (routes API) et erreurs de rendu (`onRequestError`) transmises à Sentry.
- [x] Route de rattrapage des notifications compatible avec Vercel Cron (`GET` et `CRON_SECRET`) ; `apps/web/vercel.json` déclare les deux crons.
- [x] Refus de démarrer l'authentification en production sans `BETTER_AUTH_URL` HTTPS.
- [x] `apps/print-agent/agent-config.json` ignoré par Git.

À faire :
- [ ] **Avant la première migration de production :** ajouter à `scripts/migrate.ts` une cible `production` explicite (confirmation dédiée et affichage de l'hôte), sur votre autorisation.
- [ ] **Avant d'ouvrir à plusieurs commerces :** un `Pool` Neon partagé par instance au lieu d'un par requête (`src/lib/db/client.ts`), testé sur la branche `staging`.
- [ ] **Avant d'ouvrir à plusieurs commerces :** limitation de débit Better Auth en base (table et migration locale à valider).
- [ ] Seulement si vous choisissez le proxy Cloudflare : `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`. Même dans ce cas, ne plus privilégier `cf-connecting-ip` pour Turnstile hors proxy (`clientIp` dans `server.ts`).
- [ ] Facultatif : manifeste web (`app/manifest.ts` et icônes), nécessaire au push sur iPhone.
- [ ] Facultatif : cartes sources Sentry (`withSentryConfig` et jeton de build).
- [ ] Facultatif : installateur et démarrage automatique du service d'impression sous Windows.

### C. À tester avant la mise en production

Automatique (déjà en place, à relancer avant chaque déploiement, depuis `apps/web`) :
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx drizzle-kit check`, `npx drizzle-kit generate` (doit répondre « No schema changes ») ;
- [ ] `node --test "test/**/*.test.mjs"` dans `apps/print-agent`.

Réel, sur `staging`, puis à nouveau en production :
- [ ] **Neon** : `npm run db:check` (lecture seule) ; 13 migrations appliquées ; deux ventes simultanées sur le même produit (verrous) ; temps de réponse depuis la région Vercel.
- [ ] **Better Auth** : inscription, connexion, déconnexion, cookie `Secure` ; création de deux commerces A et B ; l'utilisateur de A ne voit rien de B, même en modifiant les identifiants dans l'URL ou la requête.
- [ ] **Resend** :
  - réinitialisation de mot de passe reçue (Gmail, Outlook, téléphone), dans les trois langues dont l'arabe (RTL) ;
  - lien pointant vers le bon domaine ;
  - message hors des spams ; SPF, DKIM et DMARC « pass » dans les en-têtes ;
  - invitation reçue, adresse vérifiée, invitation acceptée.
- [ ] **Turnstile** : inscription et connexion réussies avec la vraie clé ; échec si le widget est retiré ; clé de test refusée.
- [ ] **Sentry** :
  - serveur : erreur volontaire en local avec le DSN de production (`npm run dev`, `SENTRY_TEST_ENABLED=true`, `POST /api/observability/sentry-test`) ;
  - navigateur : erreur volontaire sur `staging` ;
  - vérifier qu'aucun e-mail, montant ou nom n'apparaît dans l'événement.
- [ ] ~~PostHog~~ : retiré le 2026-11-24 ; vérifier qu'aucun bandeau de mesure d'audience n'apparaît.
- [ ] **Web Push** : abonnement et réception sur Chrome Android, Chrome ou Edge sur ordinateur, Firefox ; clic qui ouvre la bonne page ; désabonnement.
- [ ] **Cron** :
  - appel manuel avec le secret : `curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://app.votredomaine.ci/api/internal/notifications/process` doit répondre 200 ;
  - sans secret : 401 ;
  - exécution visible le lendemain dans Vercel.
- [ ] **Print Agent** : appairage depuis le domaine de production ; page de test et ticket de vente sur une **imprimante réelle** (58 et 80 mm) ; accents ; coupe du papier ; état « papier épuisé » ; Firefox ou Safari si utilisés.
- [ ] **Charge** : le premier commerce pilote utilise l'application une journée complète. Surveiller Sentry, les journaux Vercel et la consommation Neon.

---

## 17. Modifications de code faites pendant cet audit

| Fichier | Changement | Raison |
| --- | --- | --- |
| `apps/web/src/instrumentation.ts` | `export const onRequestError = Sentry.captureRequestError` | Les erreurs de rendu serveur n'atteignaient pas Sentry |
| `apps/web/src/lib/domain/business-context.ts` | `errorResponse` transmet les erreurs imprévues (500) à Sentry ; la réponse reste générique | Les pannes des 71 routes API étaient invisibles |
| `apps/web/src/lib/cron-auth.ts` (+ test) | Vérification commune du jeton des tâches planifiées, en temps constant, avec plusieurs secrets admis | Partagée par la route des notifications |
| `apps/web/src/app/api/internal/notifications/process/route.ts` | Accepte `GET` (Vercel Cron, `CRON_SECRET`) en plus de `POST` (`NOTIFICATIONS_CRON_SECRET`) | Vercel Cron appelle en `GET` avec `CRON_SECRET` : la route n'était appelable que par un planificateur externe |
| `apps/web/vercel.json` | Deux crons quotidiens | Aucune planification n'était déclarée |
| `apps/web/src/lib/env.ts`, `auth/server.ts` (+ test) | `assertProductionAuthUrl` : en production, `BETTER_AUTH_URL` doit être déclarée et en HTTPS | La valeur par défaut `http://localhost:3000` aurait cassé sans bruit les cookies, Turnstile et les liens des e-mails |
| `apps/print-agent/.gitignore` | Ignore `agent-config.json` | Configuration propre à chaque ordinateur |
| `apps/web/.env.example`, `docs/notifications.md` | Commentaires mis à jour | Cohérence avec ce qui précède |

Aucune variable existante n'a été renommée ni retirée. `NOTIFICATIONS_CRON_SECRET` garde son rôle.
