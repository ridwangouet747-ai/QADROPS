# Runbook de production : Qadr Ops (Vercel + Neon)

> Rédigé le 2026-11-12 (mandat global de release). **Aucune étape de ce runbook n'a encore été exécutée en
> production** : il n'existe ni déploiement de production de `apps/web`, ni base de production migrée. Les
> étapes marquées « vérifié » l'ont été sur la branche Neon de staging ou en local seulement.
>
> Documents détaillés auxquels ce runbook renvoie : `vercel-environments.md` (variables par environnement),
> `neon-production-plan.md` (base de production), `backup-restore.md` (sauvegarde et restauration),
> `../production-setup-guide.md` (services externes), `../security/neon-rls-validation.md` (RLS),
> `owner-action-checklist.md` (ce qui revient au propriétaire).

## 0. Règles

1. Rien ne part en production sans un Preview validé sur **le même commit** (même SHA).
2. Une migration de la base de production exige, dans l'ordre : essai sur staging, sauvegarde prise et
   vérifiée, code compatible déjà testé, cible relue (`select current_database(), inet_server_addr()` et nom de
   la branche Neon dans la console). Jamais de migration destructive.
3. Aucune clé de production dans Preview ; aucune `DATABASE_URL` partagée entre Preview et Production.
4. Aucun push forcé, aucune réécriture de `main`.
5. Une décision de retour arrière se prend **avant** le déploiement : on note le dernier déploiement sain et la
   dernière sauvegarde utilisable.

## 1. Cible retenue

| Élément | Valeur | État |
| --- | --- | --- |
| Projet Vercel canonique | `web` (`prj_tN0I7SYCLobO9nGu4VARSBt10rjE`, équipe `qadragency`) | relié à GitHub `QADROPS`, branche de production `main` |
| Réglages du projet | racine `apps/web`, Node **24.x**, installation `npm ci`, build `npm run build` (`next build --webpack`), fonctions en `iad1` (même région que Neon `us-east-1`) | **corrigés le 2026-11-12** (Node était en 26.x, build en `next build`) |
| Protection des déploiements | Vercel Authentication sur tout sauf domaines personnalisés | en place |
| Variables d'environnement | aucune | **à créer** par le propriétaire (§ 3) |
| Second projet `qadrops` | 36 variables Neon de l'intégration, `DATABASE_URL` commune à Preview et Production, non relié au dépôt | **ne pas utiliser** ; à archiver par le propriétaire |
| Base Preview | Neon, branche `mission-14-staging`, base `qadr_staging` (26 migrations, RLS validée) | prête |
| Base Production | Neon, branche `main` | **jamais migrée** ; seul un schéma `neon_auth` inutilisé (9 tables) y existe |
| Offre Vercel | Hobby | **bloquant pour la production** : réservée à un usage non commercial |
| Offre Neon | Free (`free_v3`) | 6 h de PITR, 1 instantané manuel, pas de sauvegarde planifiée ; insuffisant pour des données réelles |

## 2. Préparer une release

```powershell
cd apps/web
npm ci
npm run lint
npm run typecheck
npm test                      # 95 fichiers, environ 15 min
npx drizzle-kit check
npx drizzle-kit generate      # doit répondre « No schema changes »
npm run build
npm audit --omit=dev
```

Noter le SHA testé (`git rev-parse HEAD`). Le Preview et la production doivent porter ce SHA.

## 3. Variables d'environnement (propriétaire, tableau de bord Vercel)

La liste complète, environnement par environnement, est dans `vercel-environments.md` § 3. Règles minimales :

| Variable | Preview | Production |
| --- | --- | --- |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | chaînes de **staging** (`mission-14-staging`, base `qadr_staging`) | chaînes de la base de production, **différentes** |
| `BETTER_AUTH_SECRET` | secret propre au Preview | secret propre à la production (≥ 32 octets aléatoires) |
| `BETTER_AUTH_URL` | URL du Preview | `https://<domaine>` (HTTPS obligatoire, refusé sinon) |
| `CRON_SECRET` | facultatif | obligatoire (≥ 32 caractères) |
| `GENIUSPAY_*` | clés **sandbox** uniquement | clés live seulement quand `NODE_ENV` et `VERCEL_ENV` valent `production` (le code refuse sinon) |
| `RESEND_*`, `TURNSTILE_*` | clés de test | clés de production (domaine vérifié) |
| `QADR_OWNER_USERNAME` / `QADR_OWNER_PASSWORD` | facultatif | saisies par le propriétaire, jamais dans le dépôt ni dans une conversation |

Un secret se génère sur le poste du propriétaire et se colle directement dans Vercel, par exemple :

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 4. Déployer un Preview

Prérequis : dépôt GitHub **privé** (le dépôt `QADROPS` est public au 2026-11-12, voir la checklist du
propriétaire), variables Preview créées, offre Vercel compatible avec l'usage commercial.

1. Créer la branche de release depuis le commit testé et la pousser (sans `--force`).
2. Vercel construit un Preview pour cette branche. Vérifier dans le journal de build : Node 24, `npm ci`,
   `next build --webpack`, aucune variable manquante.
3. Essais sur le Preview (contournement de la protection par le partage de lien ou le jeton d'automatisation) :
   - `/` et `/login` répondent 200, en-têtes de sécurité présents (`curl -I`) ;
   - inscription d'un commerce de test, vente, paiement en espèces, rapport, export ;
   - essai A/B : un compte du commerce A ne lit rien de B (reprise de `tenant-isolation.http.test.ts`) ;
   - export complet (seule route sous RLS) ;
   - console de la plateforme : connexion, changement de mot de passe ;
   - GeniusPay **sandbox** uniquement ;
   - adresse client vue par la limitation (`x-forwarded-for`), voir `../rate-limiting.md`.
4. Consigner les résultats dans `mission-global-release-report.md`.

## 5. Mettre en production

Seulement si le § 4 est entièrement vert **et** que la checklist du propriétaire est close.

1. **Sauvegarde avant migration** : instantané manuel de la branche `main` (l'unique instantané de l'offre Free
   lui est réservé), noté avec son heure serveur. Sur une offre payante, vérifier aussi la fenêtre PITR.
2. **Cible** : dans la console Neon, relire le nom de la branche (`main`) et de la base. Vérifier qu'elle ne
   contient aucune table Qadr Ops (`select count(*) from information_schema.tables where table_schema='public'`).
3. **Migrations** depuis `apps/web`, avec la chaîne directe de production saisie localement (jamais écrite) :
   `npm run db:migrate` (le script exige `QADR_DB_TARGET` et une confirmation). Les migrations 0000 à 0025
   s'appliquent ensemble.
4. **Contrôle** : 26 lignes dans `drizzle.__drizzle_migrations`, dernière empreinte
   `82bd6fab01ecfa6ef4a614d38feaf0bba967be09286098b5897a407ad03d614e`, 63 tables, 44 politiques RLS. Rejouer le
   script de `../security/neon-rls-validation.md` § 3 **sur une branche enfant de production**, jamais sur
   `main` elle-même (il écrit puis annule).
5. **Fusion** de la branche de release dans `main` (fusion normale, sans réécriture) : Vercel déploie en
   production.
6. **Fumée** : `/`, `/login`, `/platform/login` ; connexion du propriétaire (compte créé à la première connexion
   depuis `QADR_OWNER_USERNAME` / `QADR_OWNER_PASSWORD`, puis variables retirées) ; création de la formule
   Standard dans `/platform/plans` (§ 7).
7. Surveiller Sentry et les journaux Vercel pendant une heure.

## 6. Retour arrière

### 6.1 Application (Vercel)

- Tableau de bord Vercel → *Deployments* → déploiement de production précédent → *Instant Rollback* (ou
  `vercel rollback <url> --scope qadragency`). Sur l'offre Hobby, seul le déploiement de production
  immédiatement précédent est proposé (**à vérifier** sur l'offre retenue).
- Un retour arrière de l'application ne défait **pas** une migration : vérifier que l'ancien code supporte le
  schéma présent. Les migrations du dépôt n'ajoutent que des tables, colonnes nullables, index, contraintes et
  politiques ; l'ancien code les ignore.

### 6.2 Base (Neon)

| Situation | Action | Perte |
| --- | --- | --- |
| Erreur dans les 6 h (Free) ou la fenêtre PITR (payant) | *Backup & Restore → Restore from history* sur `main` ; Neon garde l'état d'avant dans `main_old_<horodatage>` | écritures après l'instant choisi |
| Migration ratée juste après l'instantané | restauration de l'instantané « avant migration », en plusieurs étapes (nouvelle branche, contrôle, finalisation) | écritures depuis l'instantané |
| Perte du projet | dernier `pg_dump` chiffré (`backup-restore.md` § 4) | jusqu'au dernier `pg_dump` ; **aucun n'existe encore** |

Toute restauration de `main` est une opération de production : accord écrit du propriétaire, procédure de
`backup-restore.md` § 9.

### 6.3 Désactiver la RLS 0025 sans restaurer (dernier recours)

La RLS ne s'applique qu'au rôle `qadr_tenant`, utilisé par l'export complet seulement. Si elle bloquait
l'export, le plus sûr est de revenir au déploiement précédent (§ 6.1). Ne retirer les politiques que si
l'application déployée **n'appelle plus** `withTenantScope` (sinon l'export échoue sur `SET ROLE`) :

```sql
-- À exécuter avec le rôle propriétaire, en une transaction, après instantané.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'qadr_tenant_isolation' LOOP
    EXECUTE format('DROP POLICY qadr_tenant_isolation ON %I.%I', t.schemaname, t.tablename);
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM qadr_tenant;
REVOKE USAGE ON SCHEMA public FROM qadr_tenant;
```

Le rôle et la fonction `qadr_current_business_id()` peuvent rester : sans politique ni droit, ils sont inertes.
Ne pas supprimer la ligne 0025 de `drizzle.__drizzle_migrations` : la migration est idempotente et serait
réappliquée telle quelle.

## 7. Après la mise en production

- Formule Standard : créée par le propriétaire dans `/platform/plans` d'après la fiche de
  `../product/landing-page.md` § 3.1 (5 000 FCFA pour 30 jours, décision D-04). Elle n'est pas créée par un
  script : aucune formule n'est écrite dans le code.
- `pg_dump` chiffré hebdomadaire (quotidien tant que l'offre Free reste en place) et test de restauration
  mensuel (`backup-restore.md` § 5 et § 6).
- Revue mensuelle des accès (Vercel, Neon, GitHub, Cloudflare, Resend, GeniusPay).

## 8. Incidents courants

| Symptôme | Vérifier d'abord |
| --- | --- |
| 500 sur toutes les routes métier | `DATABASE_URL` (Vercel, bon environnement), état du calcul Neon (mise en veille, quota de 100 CU-h de l'offre Free) |
| Connexion impossible | `BETTER_AUTH_URL` en HTTPS et égal au domaine servi ; horloge ; limitation (`rate_limit_bucket`) |
| 403 `invalid_origin` | domaine servi absent de `trustedOrigins` (`BETTER_AUTH_URL`) |
| Aucun e-mail | `RESEND_API_KEY` + `RESEND_FROM_EMAIL`, domaine vérifié ; Sentry `EmailDeliveryFailedError` |
| Paiement d'abonnement bloqué en attente | cron `/api/cron/subscriptions` (journal Vercel), webhook GeniusPay signé ; ne jamais activer à la main sur la foi d'une redirection |
| Crons absents | ils ne tournent que sur la production ; une fois par jour sur Hobby |
