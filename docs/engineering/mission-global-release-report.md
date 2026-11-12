# Rapport du mandat global de release et de mise en production

> Date : 2026-11-12. Branche locale `feat/mission-13-reprise` (base `baa0084`). **Rien n'a été poussé, rien n'a
> été déployé, aucune base de production n'a été migrée, aucune dépense n'a été engagée.**
>
> Ce rapport distingue ce qui est **vérifié** (commande exécutée, résultat cité), ce qui est **fait sans preuve
> de bout en bout**, et ce qui est **bloqué** par une décision, un accès ou une dépense du propriétaire.

## 1. Verdict

**Qadr Ops n'est pas en production, et ne doit pas y être mis en l'état.** Le code et la base de staging sont
prêts pour un Preview ; la production est bloquée par quatre conditions qui ne dépendent pas du code :

1. le dépôt GitHub `QADROPS` est **public** : aucun nouveau code ne peut y être poussé avant qu'il soit privé ;
2. l'équipe Vercel est en offre **Hobby**, réservée à l'usage non commercial ;
3. l'offre Neon **Free** ne donne que 6 h de restauration et aucune sauvegarde planifiée ; aucun `pg_dump` n'existe ;
4. aucune clé de production (Resend, Turnstile, GeniusPay live, R2, VAPID) ni domaine n'existe.

## 2. Table de vérité

| Domaine | Statut | Preuve ou motif |
| --- | --- | --- |
| Audit et état de référence | **VALIDÉ** | état Git relevé (78 lignes de modifications locales, 60 commits non poussés) ; suite complète de référence : 95 fichiers, 824 tests réussis, 10 ignorés |
| Correctifs de sécurité (V-5, V-6, connexion générique) | **CORRIGÉ** | tests HTTP réels sur PGlite (§ 4.1) ; jamais exercés sur un déploiement |
| CSP complète (V-7) | **PARTIEL** | Report-Only seulement, jamais observée dans un navigateur sur un déploiement |
| Alertes élevées en production (V-4) | **CORRIGÉ** | `npm audit --omit=dev` : 0 élevée (§ 4.2) |
| Filtres `business_id` manquants (5 requêtes) | **CORRIGÉ** | `inventory.ts`, `imports.ts`, `subscription-billing.ts` |
| RLS 0025 sur Neon staging | **VALIDÉ (staging)** | 24/24 essais, catalogue 44/44 : `../security/neon-rls-validation.md` |
| RLS étendue aux routes métier | **PARTIEL** | export seul ; inventaire A 44 / B 11 / C 5 / D 8 et plan : `../security/production-security-audit.md` § 4.4 |
| Sauvegarde et restauration | **PARTIEL / BLOQUÉ** | copie de branche vérifiée identique (`backup-restore.md` § 6.6) ; ni PITR exercée, ni instantané, ni `pg_dump` |
| GitHub privé | **BLOQUÉ** | dépôt public ; aucun accès pour changer la visibilité ; rien poussé |
| Commit de release | **NON FAIT** | aucun commit sans autorisation explicite (règle du projet) |
| Projet Vercel canonique `web` | **CONFIGURÉ** | Node 24.x, `npm ci`, `npm run build`, racine `apps/web`, région `iad1` (vérifié par relecture de l'API) |
| Séparation Preview / Production | **BLOQUÉ** | `web` n'a aucune variable ; `qadrops` partage `DATABASE_URL` entre Preview et Production (à archiver) |
| Offre Vercel compatible commerce | **BLOQUÉ** | Hobby |
| GeniusPay | **NON TESTÉ À DISTANCE** | garde-fous de clés testés en local ; aucun appel sandbox réel dans ce mandat ; aucun paiement réel |
| Resend, Turnstile, R2, Push | **BLOQUÉ** | aucune clé de production ; push jamais reçu sur un appareil réel |
| Tests complets (local) | **VALIDÉ** | 96 fichiers, 838 tests réussis ; lint, typecheck, drizzle-kit et build réussis (§ 4.3) |
| Tests sur Neon (`tenant-rls.http.test.ts`) | **NON FAIT** | chaîne de connexion de staging non disponible pour l'agent |
| Déploiement Preview | **NON FAIT** | bloqué par le dépôt public, l'absence de variables et l'offre Hobby |
| Production, compte propriétaire, formule Standard | **NON FAIT** | conditions du § 1 ; le compte et la formule se créent par le propriétaire (runbook § 5 et § 7) |
| Runbook de retour arrière | **ÉCRIT** | `production-runbook.md` § 6 ; jamais exercé |

## 3. Ce qui a été fait

### 3.1 Base de données (Neon, branche de staging uniquement)

- Migration 0025 appliquée sur `qadr_staging` (branche `mission-14-staging`) en une transaction, avec la ligne
  du migrateur Drizzle (empreinte SHA-256 du fichier) : 26 migrations.
- Catalogue et 24 essais de comportement de la RLS : tous conformes.
- Branche `restore-test-2026-11-12` créée depuis staging : contenu identique à l'original.
- Branche principale `main` relue en lecture seule : aucune table Qadr Ops, seulement le schéma `neon_auth` de
  l'intégration Vercel (9 tables, non utilisé).

### 3.2 Code

- Défense en profondeur : 5 requêtes sans filtre `business_id` corrigées.
- Correctifs d'authentification et en-têtes : § 4.1.
- Dépendances : § 4.2.

### 3.3 Vercel

- Projet `web` : Node 26.x → **24.x**, build `next build` → **`npm run build`** (`next build --webpack`). Aucun
  déploiement déclenché.
- Projet `qadrops` relu (noms et cibles des variables seulement, aucune valeur lue) : 18 variables communes à
  Preview et Production, dont `DATABASE_URL`, `DATABASE_URL_UNPOOLED` et `POSTGRES_URL`.

### 3.4 Documents

- `../security/neon-rls-validation.md` (nouveau) ;
- `../security/production-security-audit.md` (mis à jour) ;
- `production-runbook.md` (nouveau) ;
- `owner-action-checklist.md` (nouveau) ;
- `backup-restore.md` (§ 6.6 ajouté).

## 4. Vérifications

### 4.1 Correctifs d'authentification

| Correctif | Fichiers | Preuve |
| --- | --- | --- |
| V-5 : routes d'identifiants Better Auth fermées au propriétaire actif (`/change-password`, `/change-email`, `/delete-user`, `/link-social`, `/unlink-account` → 404) ; aucun lien de réinitialisation pour lui | `src/lib/auth/server.ts` | `src/test/password-change.http.test.ts` |
| V-6 : changement de mot de passe d'un commerçant, compte toujours issu de la session, `revokeOtherSessions` imposé, limites 5/15 min par compte et 20/15 min par IP | `src/lib/auth/server.ts`, `src/lib/security/rate-limit.ts` | `password-change.http.test.ts` (10 tests) |
| Connexion générique : même 401 `INVALID_EMAIL_OR_PASSWORD` pour adresse inconnue et mauvais mot de passe, sans cookie | — (comportement figé par test) | `auth-security.http.test.ts` (+1) |
| V-7 : CSP complète en `Content-Security-Policy-Report-Only`, CSP appliquée inchangée | `src/lib/security-headers.ts` | `security-headers.test.ts` (+3) |

Documentation : `docs/authentication.md` § 11.5, `docs/rate-limiting.md`, `docs/platform-owner-access.md`.

Risque laissé ouvert, par décision à prendre : `/sign-in/email` ouvre encore une session **ordinaire** au
propriétaire sans second facteur (hors limites et audit de la console ; aucun accès à `/api/platform/*`).

### 4.2 Dépendances

- `@opennextjs/cloudflare` 1.20.15 déplacé en dépendance de développement (même version) : il n'est importé que
  par `open-next.config.ts`, préparation Workers inutilisée (D-01). Le lockfile ne change que par des marqueurs
  `"dev": true`.
- `npm audit --omit=dev` : **avant** 4 élevées, 8 modérées (relevé de l'audit de sécurité) ; **après** 0 élevée,
  9 modérées. Les 9 sont des outils de build ou de migration qui ne s'exécutent pas dans une requête :
  `esbuild` (serveur de développement), `@esbuild-kit/*` via `drizzle-kit`, `glob`/`minimatch` via les
  greffons de build de `@sentry/nextjs`. L'écart de 8 à 9 n'est pas expliqué (base d'avis mise à jour entre les
  deux relevés, probablement) ; il n'a pas été recherché plus loin.
- `npm audit` complet : voir § 4.3. Les alertes du paquet Workers y restent visibles ; leur retrait définitif
  (avec `wrangler` et les scripts `cf:*`) est une décision du propriétaire.

### 4.3 Commandes

Toutes lancées depuis `apps/web` le 2026-11-12, sur le code final de ce mandat (non commité).

| Commande | Résultat |
| --- | --- |
| `npx vitest run` | **96 fichiers réussis, 838 tests réussis, 10 ignorés**, exit 0 (952 s). Référence en début de mandat : 95 fichiers, 824 tests. Base de test : PGlite, pas Neon. |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npx drizzle-kit check` | « Everything's fine » |
| `npx drizzle-kit generate` | « No schema changes, nothing to migrate » |
| `npm run build` (`next build --webpack`) | exit 0, « Compiled successfully in 79s », 82 pages générées |
| `npm audit --omit=dev` | 0 critique, **0 élevée**, 9 modérées |
| `npm audit` (complet) | 0 critique, 4 élevées, 17 modérées. Les 4 élevées (`glob`, `@node-minify/core`, `@opennextjs/aws`, `@opennextjs/cloudflare`) viennent toutes de la préparation Workers inutilisée, désormais en dépendance de développement |

Neon staging : 24 essais SQL de la RLS, tous conformes (`../security/neon-rls-validation.md`).

## 5. Ce qui n'a pas été vérifié

- Aucun essai sur un déploiement Vercel réel : en-têtes, cookies `__Secure-`, adresse IP vue par la limitation,
  crons, Sentry.
- Aucun appel réel à GeniusPay (sandbox ou live), Resend, Turnstile, R2 ou à un service de push.
- `tenant-rls.http.test.ts` n'a pas tourné contre Neon : la chaîne de connexion de staging n'a pas été obtenue,
  et l'agent ne doit pas la manipuler. Les essais Neon sont les 24 essais SQL du § 3.1.
- Aucune impression réelle, aucune notification reçue sur un téléphone.

## 6. Prochaine étape recommandée

Passer le dépôt `QADROPS` en privé (checklist A1), puis autoriser le commit de release. C'est le seul verrou qui
empêche tout le reste (Preview, puis production) d'avancer sans exposer le code.
