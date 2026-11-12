# Checklist unique du propriétaire

> Mise à jour le 2026-11-12 (directive finale). Elle remplace toutes les listes précédentes. Chaque action revient
> au propriétaire parce qu'elle demande un accord, une dépense, un secret ou un accès que l'agent n'a pas.
> **Ne collez jamais un secret dans une conversation avec un agent** : saisissez-le directement dans Vercel,
> GitHub ou le tableau de bord concerné.
>
> Classement : **P** = obligatoire avant utilisation personnelle ; **C** = obligatoire avant ouverture aux
> commerçants ; **L** = peut attendre.

Déjà fait par l'agent (pour mémoire) : dépôt vérifié privé, code poussé (`31d8eca`), projet Vercel `web` réglé,
protection Vercel sur tous les déploiements, variables de Production (`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`CRON_SECRET`, Turnstile, VAPID, Sentry environnement, base Neon), widget Turnstile créé, instantané Neon de `main`,
workflow de sauvegarde écrit.

## P. Obligatoire avant utilisation personnelle

| # | Action | Type | Où | Détail |
| --- | --- | --- | --- | --- |
| P-1 | **Autoriser l'agent à migrer la branche Neon `main`** | validation | conversation | 26 migrations additives, une transaction chacune, instantané `snap-cold-frost-bcldn8o9` déjà pris. L'agent ne peut pas écrire sans votre accord |
| P-2 | Autoriser la fusion de `feat/mission-13-reprise` dans `main` (sans force) | validation | conversation | déclenche le déploiement de production sur `web-phi-beryl-45.vercel.app` |
| P-3 | Saisir `QADR_OWNER_USERNAME` et `QADR_OWNER_PASSWORD` (type *Sensitive*, Production seulement), redéployer, se connecter à `/platform/login`, puis retirer les deux variables | clé | Vercel → `web` → *Settings* → *Environment Variables* | l'agent ne choisit aucun identifiant ; nom de 3 à 30 caractères (a-z, 0-9, point, tiret bas), mot de passe de 12 caractères au moins, propre à Qadr Ops |
| P-4 | Créer les secrets GitHub `NEON_BACKUP_DATABASE_URL` (chaîne **directe** de `main`, sans `-pooler`) et `BACKUP_PASSPHRASE` (32 caractères au moins, conservée hors de GitHub), puis lancer le workflow « Sauvegarde Neon » à la main | clé + validation | GitHub → *Settings* → *Secrets and variables* → *Actions* ; onglet *Actions* | première preuve réelle de `pg_dump` et de restauration ; procédure : `backup-restore.md` § 4.0 |
| P-5 | Activer le second facteur du compte propriétaire | validation | votre poste : `npx tsx scripts/platform-owner.ts enroll-2fa` depuis `apps/web`, avec la chaîne de `main`, `QADR_OWNER_USERNAME` et `QADR_OWNER_PASSWORD` dans l'environnement du terminal (en-tête du script) | facultatif techniquement (D-05), fortement conseillé ; la console n'a pas d'écran pour cela |
| P-6 | Parcourir l'application connectée : créer une boutique, un produit, du stock, une vente, un paiement manuel, un crédit, une dépense, un fournisseur, consulter le tableau de bord, exporter, se déconnecter | validation | navigateur | l'agent ne peut pas passer Turnstile ; signalez toute erreur, il la corrige |
| P-7 | Rester sur l'usage personnel tant que l'offre Vercel est Hobby : pas de commerçant tiers, pas de paiement réel, pas de formule publiée | décision | — | conditions Vercel § 4 |

## C. Obligatoire avant ouverture aux commerçants

| # | Action | Type | Où | Détail |
| --- | --- | --- | --- | --- |
| C-1 | Passer l'équipe Vercel en **Pro** | compte (dépense) | Vercel → *Settings* → *Billing* | Hobby interdit l'usage commercial |
| C-2 | Passer Neon sur une offre avec restauration longue et sauvegardes (Launch au minimum) | compte (dépense) | Vercel → *Storage* → `qadr-data-base` | Free : 6 h de restauration |
| C-3 | Retirer ou adapter la protection Vercel de la production (garder celle des Preview) | décision | Vercel → `web` → *Deployment Protection* | aujourd'hui tout visiteur anonyme est redirigé |
| C-4 | Domaine (achat) puis DNS Cloudflare en **nuage gris** ; mettre à jour `BETTER_AUTH_URL` et le domaine du widget Turnstile | compte (dépense) + DNS | registraire, Cloudflare, Vercel | aucun domaine n'est acheté |
| C-5 | Resend : domaine vérifié (enregistrements SPF, DKIM et DMARC à créer dans Cloudflare, donnés par Resend), `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | DNS + clé | Resend, Cloudflare, Vercel | `resend-dns.md` ; sans eux, ni réinitialisation de mot de passe ni invitation par e-mail |
| C-6 | GeniusPay live : contrat, `GENIUSPAY_API_KEY` (`pk_live_`), `GENIUSPAY_API_SECRET` (`sk_live_`), `GENIUSPAY_WEBHOOK_SECRET`, webhook `https://<domaine>/api/webhooks/geniuspay` | clé + compte | GeniusPay, Vercel (Production seulement) | jamais la même clé qu'en sandbox ; aucun paiement réel pour « tester » |
| C-7 | Créer la formule **Standard** : 5 000 FCFA, 30 jours, toutes fonctions (D-04) | validation | `/platform/plans` | aucun tarif n'est écrit dans le code |
| C-8 | `VAPID_SUBJECT` = `mailto:` d'une adresse que vous lisez | clé | Vercel | sans lui le push reste désactivé |
| C-9 | Décider de la politique pour un commerce sans abonnement ou en `pending` | décision | — | aujourd'hui non bloqué |
| C-10 | Relecture juridique de `/privacy` et des conditions d'utilisation | validation | — | |
| C-11 | Vérifier l'adresse IP vue par la limitation derrière Vercel (et Cloudflare si proxy) | validation | Preview ou production | `../rate-limiting.md` |

## L. Peut attendre

| # | Action | Type | Détail |
| --- | --- | --- | --- |
| L-1 | Variables **Preview** du projet `web` : base de staging, secrets propres, clés GeniusPay **sandbox**, Turnstile de test | clés | `vercel-environments.md` § 3 ; sans elles, les Preview répondent 500 aux API |
| L-2 | Bucket R2 privé de production et jetons ; bucket de test pour `r2.integration.test.ts` | compte + clés | `../storage-r2.md` |
| L-3 | DSN Sentry (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`) | clé | sans eux, aucune erreur n'est remontée |
| L-4 | Projet Vercel `qadrops` : l'archiver | décision | sa `DATABASE_URL` vise un **autre** projet Neon (`soft-shadow-14690872`) ; il n'est pas relié au dépôt |
| L-5 | Recevoir une vraie notification push sur un téléphone ; imprimer un vrai ticket | validation | rien de cela n'est vérifié |
| L-6 | Supprimer, si vous le souhaitez, la branche `restore-test-2026-11-12` et les bases `qadr_t_26b71d2dd995`, `qadr_t_2daf7bad4b7c`, `qadr_t_71046c3dca94` de staging | décision | l'agent ne supprime aucune donnée |
| L-7 | Décider du sort de la préparation Workers (`wrangler`, `@opennextjs/cloudflare`, scripts `cf:*`) | décision | elle porte les 4 alertes élevées de `npm audit` complet |
| L-8 | Revue mensuelle des accès (Vercel, Neon, GitHub, Cloudflare, Resend, GeniusPay) | validation | |
