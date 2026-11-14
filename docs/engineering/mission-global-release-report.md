# Rapport final de mise en production

> Relevé du 2026-11-14. Remplace toutes les versions précédentes. Aucun secret n'y figure. Catégories :
> **VALIDÉ** (exécuté, preuve citée), **CONFIGURÉ MAIS NON TESTÉ**, **NON OPÉRATIONNEL**, **RISQUES RÉSIDUELS**.
> Un test local réussi n'est jamais présenté comme une preuve distante ; une variable présente n'est jamais présentée
> comme une fonction validée.

## Verdict

Qadr Ops est **accessible sur son URL de production** `https://web-phi-beryl-45.vercel.app`, déploiement
`dpl_EfgneNa84xMA7rBswsuiCrdjuftS`, commit `7c10771` (`main`), région `iad1`, base Neon `main`. Personne ne peut
encore s'en servir : aucun compte n'existe, et l'inscription est fermée à tous tant que le propriétaire n'a pas posé
`QADR_REGISTRATION_ALLOWLIST` (checklist P-3 bis).

## VALIDÉ

| Sujet | Preuve |
| --- | --- |
| Sauvegarde et restauration réelles | `pg_dump`/`pg_restore` 18.7 sur staging puis sur `main` ; empreintes identiques (`backup-restore.md` § 6.7) |
| Migration de Neon `main` | 26 migrations en une transaction (`scripts/migrate-production.ts`) ; journal à 26 lignes, relu le 2026-11-14 |
| RLS PostgreSQL | 44 tables, 44 politiques, rôle `qadr_tenant` sans BYPASSRLS ; 24 essais directs et essai à travers le pooler (`../security/neon-rls-validation.md` § 4 bis). **Ne protège que l'export complet** |
| Isolation applicative par `business_id` | les 50 routes `/api/business` passent par `getBusinessContext` (commerce lu dans la session, appartenance vérifiée) ; `tenant-isolation` 21/21 sur PostgreSQL réel |
| Tests sur PostgreSQL réel (branche de répétition, jamais `main`) | 20 fichiers : **210 réussis, 1 échoué, 0 ignoré**. L'échec : « durée comparable » (`auth-security`), refus 530 ms contre création 1 290 ms entre le poste et Neon ; écart dû aux allers-retours d'écriture, test conservé (`../authentication.md` § 11.6) |
| Suite locale | `npx vitest run` : exit 0, 99 fichiers, **862 réussis, 10 ignorés** (essais R2 réels sans bucket), 0 échec, 1 032 s |
| Contrôles statiques | `tsc --noEmit` exit 0 ; `npm run lint` exit 0 ; `drizzle-kit check` « Everything's fine » ; `drizzle-kit generate` « No schema changes » ; `npm run build` exit 0, 82 pages |
| CI | `.github/workflows/ci.yml`, exécution `43590985828` sur `7c10771` : succès (installation, typecheck, ESLint, Drizzle, Vitest 316 s, build 98 s, audit) |
| Fusion | `main` avancé de `2cb9c97` à `7c10771` sans force ; le commit fusionné est celui que le CI a validé |
| Déploiement | Production READY, SHA `7c10771`, alias `web-phi-beryl-45.vercel.app` |
| Accès public | protection Vercel en mode standard : domaine de production public (200) ; URL de déploiement et Preview protégés (302) |
| Contrôles distants (lecture seule) | `/`, `/login`, `/platform/login`, `/robots.txt`, manifest, `sw.js`, `offline.html` : 200 ; ressource `/_next/static` 200, `immutable` ; API métier et plateforme sans session : 401 ; cron sans secret : 401 ; routes Organization et two-factor : 404 |
| En-têtes | HSTS 2 ans, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'` |
| Webhook GeniusPay public | GET 405 ; POST sans signature, signature fausse, horodatage périmé : 401 `invalid_signature` ; journaux : `missing_headers`, `bad_signature`, `stale`. Joignable malgré la protection Vercel (domaine de production public) |
| Configuration de paiement chargée | le webhook répond 401 et non 503 `billing_unavailable` : les clés live sont acceptées par le code en Production |
| Connexion à la base | tentative de connexion propriétaire inconnue : 401 générique, journal « User not found » ; `rate_limit_bucket` de `main` passé de 0 à 4 lignes |
| Turnstile côté serveur | inscription et connexion sans jeton : 400 `TURNSTILE_FAILED`, journal `turnstile.rejected` |
| GeniusPay, clé publique | `GET /payments/{référence inexistante}` : 404 `TRANSACTION_NOT_FOUND` avec la clé, 401 `INVALID_API_KEY` avec une fausse |
| Secrets | aucun motif de secret dans les 66 commits publiés (seulement des valeurs de test `exemple`, `invalid`) ; `.env.local` ignoré par Git ; variables GeniusPay, `SENTRY_DSN`, `VAPID_SUBJECT` transmises par l'entrée standard, type *Sensitive* |

## CONFIGURÉ MAIS NON TESTÉ

| Sujet | État |
| --- | --- |
| GeniusPay, clé secrète | présente (*Sensitive*). **Non vérifiée** : GeniusPay ne contrôle pas le secret en lecture, et valide le corps avant le secret en écriture ; la seule vérification possible crée un paiement. Création de paiement, relecture, webhook signé réel, doublons : jamais exécutés en live |
| Webhook GeniusPay chez le fournisseur | l'URL `https://web-phi-beryl-45.vercel.app/api/webhooks/geniuspay` n'est pas déclarée dans le tableau de bord GeniusPay (action du propriétaire) |
| Sentry | `SENTRY_DSN` et `NEXT_PUBLIC_SENTRY_DSN` posés ; aucun événement de production observé |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` posés ; aucune notification reçue sur un appareil |
| Turnstile complet | rejet sans jeton prouvé ; passage avec un vrai jeton jamais observé |
| Liste d'inscription | règle prouvée par tests (PGlite et Neon réel) ; à distance, Turnstile refuse avant elle. Variable absente : toute inscription est refusée |
| Compte propriétaire | `QADR_OWNER_USERNAME`/`QADR_OWNER_PASSWORD` absents : aucun compte. Second facteur **facultatif** (décision D-05 du 2026-11-12), pas imposé |
| Parcours métier distant | boutique, vente, paiement manuel, crédit, dépense, export : jamais exécutés en production (aucun compte, Turnstile) |
| Crons | `/api/cron/subscriptions` (01:00) et notifications (07:00), quotidiens, compatibles Hobby ; aucune exécution observée |

## NON OPÉRATIONNEL

- **E-mails (Resend)** : non configuré. L'expéditeur local est une adresse `gmail.com`, et aucun domaine n'est
  vérifié dans Resend. Rien n'est envoyé, et l'interface le dit (`/api/account/capabilities`). Sans e-mail :
  ni réinitialisation de mot de passe, ni invitation, ni vérification d'adresse.
- **Fichiers privés (R2)** : aucune variable `R2_*`, `getFileStorage` renvoie `null` : fonction désactivée.
- **Formule Standard** : absente de la base (0 formule) ; aucun abonnement payant possible.
- **Inscriptions** : fermées à tous tant que `QADR_REGISTRATION_ALLOWLIST` manque.
- **Variables Preview** : aucune ; les Preview répondent sans base.
- **Hors ligne** : seule la page `offline.html` existe.

## RISQUES RÉSIDUELS

1. **Dépôt GitHub rendu public** par le propriétaire le 2026-11-14 pour lire le CI : à remettre en privé. Aucun secret
   dans l'historique.
2. **Le CI n'est pas bloquant techniquement** : aucune règle de protection de `main` (non disponible pour un dépôt
   privé sur l'offre GitHub Free). La barrière tient à la procédure : fusion par avance rapide d'un commit au CI vert.
3. **GeniusPay** : clé secrète non vérifiée. La clé publique `pk_live_` suffit à lire la liste des paiements du
   marchand : elle doit rester traitée comme un secret.
4. **Offre Vercel Hobby** : usage non commercial seulement. **Neon Free** : 6 h de restauration ; sauvegarde
   planifiée `neon-backup.yml` jamais lancée (secrets GitHub absents).
5. **RLS** limitée à l'export ; les autres routes reposent sur le filtrage applicatif `business_id`, audité et testé.
6. **Durée d'un refus d'inscription** plus courte qu'une création (entre le poste et Neon) : à mesurer sur Vercel
   avant d'ouvrir les inscriptions.
7. **Dépendances** : `npm audit --omit=dev` : 9 modérées, 0 élevée. Audit complet : 21 (17 modérées, 4 élevées).
   Les 4 élevées sont une seule faille de l'outil en ligne de commande `glob@10.3.3` (injection par `-c/--cmd`),
   via `@opennextjs/cloudflare` → `@opennextjs/aws` → `@node-minify/core` → `glob`, en dépendance de développement
   pour la préparation Workers inutilisée ; rien n'appelle cet outil. Correctifs proposés par npm : rétrogradations
   majeures, non appliquées.
8. **Second facteur du propriétaire facultatif** (D-05) ; à activer dès la création du compte (checklist P-5).
9. **Adresse IP** vue par la limitation derrière Vercel non vérifiée avec un vrai client.
10. Branches et bases Neon de travail conservées : `repetition-migration-main-2026-11-13` (`qadr_tests`),
    `restore-test-2026-11-12` (`qadr_restore_verif`, `qadr_restore_main`), bases `qadr_t_*` de staging.
    Suppression : décision du propriétaire.

## Architecture et performance

Monolithe modulaire conservé : services métier dans `lib/domain` (aucun composant n'importe la base), adaptateurs
remplaçables (`lib/billing`, `lib/storage`, `lib/notifications`), 96 routes. Aucune refonte entreprise. Performance :
mesures et index de `../performance.md` (PGlite) ; aucune mesure sur Neon de production, aucune optimisation ajoutée
sans mesure.
