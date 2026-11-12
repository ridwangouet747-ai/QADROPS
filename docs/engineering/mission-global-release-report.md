# Rapport exécutif unique : directive finale de mise en ligne

> Relevé du 2026-11-12, 23 h UTC environ. Ce document **remplace** les versions précédentes de ce rapport : il
> n'en existe pas d'autre. Chaque affirmation est classée **vérifié** (commande exécutée, résultat cité),
> **fait sans preuve de bout en bout**, ou **bloqué**. Aucun secret n'y figure.

## Verdict en une phrase

Le code est publié sur GitHub (dépôt privé) et construit sans erreur sur Vercel ; l'application n'est **pas encore
utilisable**, parce que la base de production Neon (`main`) n'est pas migrée : son écriture a été refusée par le
système d'autorisations de l'agent et attend l'accord explicite du propriétaire.

## A. Adresse de l'application

| Élément | Valeur | Statut |
| --- | --- | --- |
| URL de production | `https://web-phi-beryl-45.vercel.app` | sert encore l'**ancien** déploiement du 1er novembre (commit `2cb9c97`) ; la production change à la fusion dans `main` |
| URL du Preview du code actuel | `https://web-o7q39yzpb-qadragency.vercel.app` (déploiement `dpl_8SG96E3jpAJxo1jnrU7hmEJwJv47`, état READY) | **vérifié** : construit sur Vercel à partir de `31d8eca` |
| Type | projet Vercel canonique `web`, équipe `qadragency`, offre **Hobby** | — |
| Environnements | Production : variables posées (§ F, G) ; Preview : **aucune variable** | Preview sans base, donc les API qui lisent la base répondent 500 |
| HTTPS | HTTPS seul, HSTS `max-age=63072000; includeSubDomains` | **vérifié** sur le Preview |
| Accès | protection Vercel « All Deployments » : tout visiteur anonyme reçoit 302 vers `vercel.com/sso-api` | **vérifié** par `curl` anonyme sur les deux URL, pages et `/api/webhooks/geniuspay` compris |

**Usage personnel seulement.** L'offre Hobby est réservée à l'usage personnel ou non commercial (conditions Vercel
§ 4). Les restrictions sont techniques et vérifiables : seuls les membres de l'équipe Vercel passent la protection ;
aucune clé GeniusPay n'existe, et le webhook est derrière la même protection (302), donc aucun paiement ne peut
aboutir ; aucune formule n'est créée en base, donc aucun tarif n'est affiché ; l'inscription n'est atteignable
que derrière la protection. Ouvrir aux commerçants exige l'offre Pro (checklist, ligne P-1).

## B. Code

| Élément | Valeur |
| --- | --- |
| Branche | `feat/mission-13-reprise` |
| Commit testé | `31d8ecaf2f22b6819930e091e734edb2665b7e3e` (« fix(securite) : propriétaire refusé hors console, GET de paiement sans écriture, sauvegarde Neon »), précédé de `2687738` (release : RLS 0025, comptes, marque, console) |
| GitHub | `ridwangouet747-ai/QADROPS`, **privé** (vérifié : 404 en accès anonyme) ; `origin/feat/mission-13-reprise` = `31d8eca`, identique au code testé ; push sans force |
| `main` distant | `2cb9c97` (inchangé) : la fusion attend la migration de la base de production |
| Secrets dans l'historique | balayage de tout l'historique : seulement des valeurs factices de test ; seul `apps/web/.env.example` est suivi |
| Hors commit, volontairement | `apps/web/.gitignore`, `docs/engineering/dependencies-and-skills.md`, `production-video/` (changements du propriétaire) |

Correctifs de cette directive :

- **A, owner sur `/sign-in/email`** : refus de tout propriétaire actif de la plateforme ou de tout compte à second
  facteur (même 401 qu'un mauvais mot de passe, durée comparable, aucun cookie), plus `databaseHooks` qui refusent
  au propriétaire toute session ou tout fournisseur social ouverts par requête HTTP. Les appels serveur de la
  console passent.
- **B, GET qui écrivait** : `GET /api/business/subscription/payments/[attemptId]` est en lecture seule ; la
  relecture GeniusPay passe par un `POST` (propriétaire, origine contrôlée, au plus une relecture toutes les 5 s).
- **C, CSP** : toujours en `Report-Only` (vérifié dans les en-têtes du Preview).
- **D, `@opennextjs/cloudflare`** : reste en dépendance de développement.

## C. Base de données

| Élément | Valeur | Statut |
| --- | --- | --- |
| Projet Neon de production | `soft-shadow-92812879` (région `iad1`), relié au projet `web` par la ressource `qadr-data-base` (Production seulement) | **vérifié** |
| Branche `main` | **aucune migration appliquée** (0 table publique ; seulement `neon_auth` de l'intégration Vercel) | **bloqué** : premier appel d'écriture refusé par le système d'autorisations de l'agent |
| Migrations prêtes | 26 (0000 à 0025), toutes additives ; empreintes SHA-256 des 26 fichiers identiques au journal de `qadr_staging` | **vérifié** |
| Branche de staging | `mission-14-staging`, base `qadr_staging` : 26 migrations | **vérifié** |
| RLS | 0025 appliquée sur staging ; 24 essais SQL exécutés sur Neon, tous conformes ; catalogue 44/44 tables. `tenant-rls.http.test.ts` tourne sur PGlite, pas sur Neon ; le comportement à travers le pooler Neon n'a jamais été testé | **vérifié (staging, SQL)** |
| Instantané | `snap-cold-frost-bcldn8o9` de `main`, 2026-11-12 22:28 UTC, avant toute écriture | **vérifié** |
| Sauvegarde planifiée | `.github/workflows/neon-backup.yml` (quotidien 02:30 UTC) : `pg_dump` 18, restauration dans un PostgreSQL 18 jetable, comparaison des comptes et du catalogue, chiffrement AES-256, artefact privé 14 jours | **écrite, jamais exécutée** : secrets GitHub à saisir (checklist P-4) |
| Test de restauration | branche `restore-test-2026-11-12` (copie de staging, conservée) : copie identique, **ce n'est pas** une restauration de sauvegarde. Le vrai test sera la première exécution du workflow | **non fait** |

Le rapport précédent annonçait la RLS « validée sur Neon » sans préciser : les 24 essais sont du SQL exécuté sur
la branche de staging par l'outil Neon, pas la suite Vitest. C'est la seule preuve Neon.

## D. Tests

Tous lancés depuis `apps/web`, sur `31d8eca`, en local, le 2026-11-12 :

| Commande | Résultat |
| --- | --- |
| `npx vitest run` | **96 fichiers, 845 réussis, 0 échec, 10 ignorés** (1 155 s). Base : PGlite. Les 10 ignorés sont les essais Cloudflare R2 réels (`r2.integration.test.ts`), sans bucket de test configuré : ils ne comptent pas comme réussis |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npx drizzle-kit check` | « Everything's fine » |
| `npm run build` | réussi, « Compiled successfully in 93s », 82/82 pages |
| Tests ciblés des correctifs | `platform-owner-login.http.test.ts` 19/19, `password-change.http.test.ts` 9/9, `subscription-billing.http.test.ts` (+4), `tenant-isolation.http.test.ts` (attaque A→B sur le nouveau `POST`) |

Essais **distants** sur le Preview (`vercel curl`, qui passe la protection avec le jeton de l'agent) :

| Requête | Résultat | Lecture |
| --- | --- | --- |
| `/`, `/login`, `/platform/login`, `/robots.txt` | 200 | pages servies |
| en-têtes de `/login` | HSTS, CSP appliquée (`frame-ancestors 'none'`…), CSP `Report-Only`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | conformes |
| `/api/account/me`, `/api/business/products`, `/api/platform/plans` | 500, corps `{"error":"Une erreur empêche le traitement de la requête."}` | attendu sans base en Preview ; message générique, aucune fuite |
| `/api/cron/subscriptions` sans secret | 404 | refus attendu |
| `GET /api/webhooks/geniuspay` | 405 | seul `POST` est accepté |

**Non testé à distance** : connexion, sessions et cookies réels, parcours métier (boutique, produits, stock,
vente, paiement manuel, crédit, dépenses, fournisseurs, tableau de bord, export, impression, déconnexion), journaux
d'exécution d'une requête réussie, crons. Deux raisons : la base de production n'est pas migrée, et la connexion
exige un défi Turnstile que l'agent ne doit pas résoudre. Ces parcours se font par le propriétaire (checklist P-6).

## E. Sécurité

| Domaine | État |
| --- | --- |
| Authentification | connexion générique (même 401 pour adresse inconnue et mauvais mot de passe) ; propriétaire de la plateforme refusé hors console ; routes d'identifiants Better Auth fermées au propriétaire ; changement de mot de passe d'un commerçant révoque les autres sessions. Tests HTTP sur PGlite |
| Sessions | cookies `__Secure-` en production d'après le code et `session-cookies.http.test.ts` ; **jamais observés sur Vercel** |
| Permissions et multi-tenant | permissions centralisées, attaques A→B de `tenant-isolation.http.test.ts` réussies (refus identique à un identifiant inconnu) ; RLS 0025 en défense en profondeur pour l'export seulement |
| Webhooks | GeniusPay : signature HMAC sur le corps brut, fenêtre de 300 s, relecture obligatoire du paiement par l'API ; tests locaux seulement ; aucun appel sandbox réel dans cette directive |
| Dépendances | `npm audit --omit=dev` : 0 critique, **0 élevée**, 9 modérées (outils de build ou de migration). `npm audit` complet : 0 critique, 4 élevées et 17 modérées, toutes dans des dépendances de développement (préparation Workers inutilisée, outils). Ce n'est pas un audit « sans vulnérabilité » |
| Origine des requêtes | `assertTrustedOrigin` sur les contextes et routes qui écrivent |
| Risques résiduels | RLS non étendue aux routes métier ; pooler Neon jamais testé avec la RLS ; adresse IP vue par la limitation derrière Vercel non vérifiée ; CSP complète jamais observée dans un navigateur ; offre Neon Free sans sauvegarde planifiée côté Neon (6 h de restauration) ; aucun fonctionnement hors ligne ; politique non tranchée pour un commerce `pending` |

## F. Intégrations

| Intégration | Configuration | Testée à distance ? |
| --- | --- | --- |
| GeniusPay | aucune clé (ni sandbox ni live) dans `web` ; webhook prévu `https://web-phi-beryl-45.vercel.app/api/webhooks/geniuspay`, aujourd'hui derrière la protection | **non** : paiement volontairement non opérationnel |
| Resend | aucune clé, aucun domaine ; sans elles, aucun e-mail n'est envoyé et l'interface le dit | **non** |
| Turnstile | widget `qadr-ops-production-vercel` (mode géré, domaine `web-phi-beryl-45.vercel.app`) ; clé de site et secret posés en Production | **non** : la vérification exige un humain |
| R2 | aucun bucket ni jeton | **non** |
| Push | clés VAPID générées et posées en Production ; `VAPID_SUBJECT` absent, donc push désactivé | **non** |
| Sentry | `SENTRY_ENVIRONMENT` posé ; pas de DSN | **non** |

## G. Actions du propriétaire

Une seule checklist, classée comme demandé : [`owner-action-checklist.md`](owner-action-checklist.md).

La première action débloque tout le reste : **autoriser la migration de la branche Neon `main`** (26 migrations
additives, une transaction par migration, instantané déjà pris). Après elle, l'agent fusionne
`feat/mission-13-reprise` dans `main` sans force, ce qui déploie la production, puis rejoue les essais distants.
