# Rapport exécutif unique : activation de la production

> Relevé du 2026-11-13. Ce document **remplace** toutes les versions précédentes de ce rapport. Statuts :
> **VALIDÉ** (preuve citée), **PARTIEL**, **BLOQUÉ** (accès, décision ou outil du propriétaire), **À CORRIGER**,
> **NON TESTÉ**. Aucun secret n'y figure.

## Verdict

Qadr Ops **n'est pas encore en production**. La chaîne s'arrête à la première étape que vous avez imposée :
la **restauration réelle** d'une sauvegarde PostgreSQL avant de migrer `main`. Elle exige un `pg_dump` et les
identifiants de la base ; le système d'autorisations de l'agent a refusé deux fois l'accès aux identifiants, et
Docker ne démarre pas sur le poste (aucune distribution WSL). Tout ce qui suit (migration, fusion, déploiement,
tests distants) en dépend et n'a donc pas été fait. Le reste a avancé : verrou d'inscription pour l'usage
personnel, script de la formule Standard, workflow de sauvegarde capable de tester la restauration sur staging.

## Tableau de bord

| Sujet | Statut | Détail |
| --- | --- | --- |
| Branche, commit | VALIDÉ | `feat/mission-13-reprise` ; code testé `31d8eca`, puis le commit de ce lot (voir `git log`) poussé sans force |
| Hash GitHub | VALIDÉ | `origin/feat/mission-13-reprise` = dernier commit local ; dépôt `ridwangouet747-ai/QADROPS` **privé** |
| `main` GitHub | BLOQUÉ | `2cb9c97` (31 octobre) ; fusion prévue juste après la migration |
| URL Vercel de production | BLOQUÉ | `https://web-phi-beryl-45.vercel.app` sert encore le déploiement du 1er novembre (`2cb9c97`), derrière la protection Vercel (302 vers `vercel.com/sso-api` pour tout visiteur anonyme) |
| Statut du déploiement | PARTIEL | le Preview de `31d8eca` est READY (`dpl_8SG96E3jpAJxo1jnrU7hmEJwJv47`) ; aucun déploiement de production de la release |
| Neon `main` | BLOQUÉ | cible vérifiée par SQL : branche `br-holy-wind-bc24ak16` (`main`, principale, branche de production Vercel), base `neondb`, PostgreSQL 18.7, **0 table publique**, rôle `qadr_tenant` absent |
| Migrations exécutées sur `main` | BLOQUÉ | 0 sur 26. Revue faite : aucune ne supprime de données (les `DROP` remplacent des contraintes `CHECK` ou des politiques, les deux `UPDATE` remplissent une colonne nouvelle avant `NOT NULL`). Instantané `snap-cold-frost-bcldn8o9` (2026-11-12 22:28 UTC) présent |
| RLS réellement vérifiée | PARTIEL | sur Neon staging uniquement : 24 essais SQL et catalogue 44/44 (`../security/neon-rls-validation.md`). La RLS ne protège que l'export complet ; les autres routes reposent sur le filtrage applicatif. Connexions poolées, réutilisation de connexion et fin de transaction à travers le pooler : NON TESTÉ (identifiants nécessaires) |
| Sauvegarde et restauration | BLOQUÉ | aucun `pg_dump` réel. Workflow `neon-backup.yml` prêt (export, contrôle, restauration dans PostgreSQL 18 jetable, comparaison des comptes et du catalogue, chiffrement), jamais exécuté : secrets GitHub absents, et le lancement manuel exige qu'il soit sur `main` |
| Tests locaux | voir § Tests | |
| Tests distants | PARTIEL | Preview seulement, sans base : en-têtes de sécurité, HTTPS, refus du cron sans secret (404), `GET` du webhook (405), erreurs génériques sans fuite. Aucun parcours métier distant |
| Better Auth | VALIDÉ en local, NON TESTÉ à distance | correctifs propriétaire, connexion générique, et nouveau verrou d'inscription (§ Sécurité) |
| GeniusPay | NON TESTÉ | aucune clé ; webhook prêt (`/api/webhooks/geniuspay`, signature HMAC, fenêtre 300 s, relecture du paiement) |
| Resend | NON TESTÉ | aucune clé ni domaine |
| Turnstile | PARTIEL | widget et clés posés en Production ; vérification réelle impossible sans humain |
| R2 | NON TESTÉ | aucun bucket |
| Push | NON TESTÉ | clés VAPID posées ; `VAPID_SUBJECT` absent, donc désactivé |

## Ce qui a été fait le 2026-11-13

1. **Verrou d'inscription (usage personnel sous Hobby)** : `src/lib/auth/registration.ts`. En production
   Vercel, seules les adresses de `QADR_REGISTRATION_ALLOWLIST` peuvent créer un compte par requête HTTP
   (e-mail, Google, Apple, invitation) ; sans liste, aucune ; `QADR_REGISTRATION=open` rouvre à tous. Refus dans
   `databaseHooks.user.create.before`, rendu en `422 SIGN_UP_FAILED` (identique à une adresse déjà inscrite).
   C'est ce qui permettra de rendre le domaine de production public (webhook joignable, application protégée par
   Better Auth) sans accueillir de commerçants tiers. Tests : `registration-allowlist.http.test.ts` (7).
2. **Formule Standard** : `scripts/ensure-standard-plan.ts`, par le service de la console
   (`createPlatformPlan` : validation et audit), idempotent (rien si `STANDARD` existe), **inactive** par défaut
   (absente de la page publique sous Hobby), `--publish` pour l'activer. Tests : `standard-plan.http.test.ts` (3).
3. **Workflow de sauvegarde** : lancement manuel avec la source `production` ou `staging` (secret
   `NEON_STAGING_DATABASE_URL`) pour prouver la restauration avant la migration de `main`.
4. **Constat sur le second facteur** : `scripts/platform-owner.ts enroll-2fa` chiffre avec
   `BETTER_AUTH_SECRET`, dont la valeur de Production est illisible (type *Sensitive*). Solution dans la
   checklist (P-5) : le propriétaire pose son propre secret avant toute création de compte.
5. Documents : `../authentication.md` § 11.6, `vercel-environments.md`, `backup-restore.md` § 4.0 et 4.0 bis,
   `.env.example`, `CLAUDE.md`, checklist.

## Tests

Locaux, depuis `apps/web` :

| Commande | Résultat |
| --- | --- |
| `npx vitest run` (suite complète) | 98 fichiers réussis, 855 tests réussis, 10 ignorés, 0 échec |
| `npx vitest run` des deux nouveaux fichiers | 2 fichiers, 10 tests réussis |
| `npx vitest run` auth (`registration-allowlist`, `auth-security`, `platform-owner-login`) | 3 fichiers, 44 tests réussis |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, « Compiled successfully in 2.6min », 82 pages générées |

Les 10 tests ignorés de la suite sont les essais Cloudflare R2 réels (aucun bucket de test) : ils ne comptent
pas comme réussis.

## Sécurité

- Authentification et sessions : comportement figé par tests HTTP sur PGlite ; jamais observé sur Vercel.
- Permissions et multi-tenant : attaques A→B refusées (`tenant-isolation.http.test.ts`) ; aucune fuite connue.
- Webhooks : signature vérifiée en local ; aujourd'hui injoignable (protection Vercel), ce qui sera corrigé au
  déploiement en passant la protection en mode standard (Preview protégés, domaine de production public).
- Dépendances : `npm audit --omit=dev` 0 élevée, 9 modérées ; `npm audit` complet 4 élevées (outils de
  développement Workers inutilisés). Ce n'est pas un audit « sans vulnérabilité ».
- Risques résiduels : RLS limitée à l'export ; pooler Neon jamais testé ; aucune sauvegarde prouvée ; adresse IP
  vue par la limitation non vérifiée sur Vercel ; offre Neon Free (6 h de restauration) ; aucun hors-ligne.

## Ce qui débloque tout

Une seule décision : la checklist **P-0** ([`owner-action-checklist.md`](owner-action-checklist.md)).

- **Voie rapide** : autoriser dans la conversation l'usage des identifiants de base (fichiers locaux privés,
  jamais affichés, effacés ensuite), et rendre un `pg_dump` 18 disponible (installer la distribution WSL de
  Docker Desktop, ou autoriser le téléchargement des outils clients PostgreSQL 18 officiels). L'agent enchaîne
  alors restauration réelle, migration de `main`, contrôles RLS (y compris par le pooler), fusion, protection
  standard, déploiement et tests distants.
- **Voie GitHub** : vous créez les secrets et lancez le workflow (P-4) ; elle suppose que la release soit
  d'abord sur `main`.
