# Checklist du propriétaire : actions que l'agent ne peut pas ou ne doit pas faire

> Établie le 2026-11-12 (mandat global de release). Chaque ligne indique **pourquoi** elle revient au
> propriétaire : décision commerciale, dépense, secret à saisir, ou accès que l'agent n'a pas. Ne collez jamais
> un secret dans une conversation avec un agent : saisissez-le directement dans le tableau de bord concerné.
>
> Ordre conseillé : A (bloquants) → B (Preview) → C (production) → D (après lancement).

## A. Bloquants avant toute publication

| # | Action | Où | Pourquoi vous | État au 2026-11-12 |
| --- | --- | --- | --- | --- |
| A1 | Passer le dépôt `ridwangouet747-ai/QADROPS` en **privé** | GitHub → *Settings* → *General* → *Danger Zone* → *Change visibility* | l'agent n'a ni `gh` ni jeton GitHub | **public** ; `main` distant (2cb9c97, 31 octobre) expose déjà les missions 04 à 08 ; 60 commits locaux jamais poussés |
| A2 | Choisir l'offre Vercel compatible avec un usage commercial (Pro) | Vercel → *Settings* → *Billing* | dépense | équipe `qadragency` en **Hobby**, réservée à l'usage non commercial : production bloquée |
| A3 | Choisir l'offre Neon pour des données réelles (Launch au minimum : PITR jusqu'à 7 jours, sauvegardes planifiées) | Vercel → *Storage* (le projet Neon est géré par l'intégration Vercel) | dépense | Free : 6 h de PITR, 1 instantané manuel, aucune sauvegarde planifiée |
| A4 | Choisir et acheter le domaine | registraire, puis DNS Cloudflare en **nuage gris** | dépense | aucun domaine |
| A5 | Autoriser explicitement : commit de release, push de la branche de release, fusion dans `main`, migration de la base de production | conversation | règles du projet | rien n'est commité ni poussé |

## B. Pour un premier Preview

| # | Action | Où | Détail |
| --- | --- | --- | --- |
| B1 | Créer les variables **Preview** du projet `web` | Vercel → `web` → *Settings* → *Environment Variables* | liste : `vercel-environments.md` § 3 ; `DATABASE_URL` et `DATABASE_URL_UNPOOLED` = chaînes de la branche Neon `mission-14-staging`, base `qadr_staging` (console Neon → *Connect*) |
| B2 | Générer `BETTER_AUTH_SECRET` et `CRON_SECRET` propres au Preview | votre poste, puis collage dans Vercel | commande dans `production-runbook.md` § 3 |
| B3 | Clés GeniusPay **sandbox** | espace GeniusPay | jamais de clé live en Preview (le code la refuse) |
| B4 | Clés Turnstile de test ou d'un widget Preview | Cloudflare → *Turnstile* | |
| B5 | Projet Vercel `qadrops` : l'archiver, ou au moins retirer sa `DATABASE_URL` de l'environnement Preview | Vercel → `qadrops` | il partage une seule `DATABASE_URL` entre Preview et Production ; il n'est pas relié au dépôt |

## C. Pour la production

| # | Action | Où | Détail |
| --- | --- | --- | --- |
| C1 | Domaine Resend vérifié, clé API, `RESEND_FROM_EMAIL` | Resend + DNS Cloudflare | `../authentication.md` § 7, `resend-dns.md` |
| C2 | Clés Turnstile de production (hôte = domaine) | Cloudflare | |
| C3 | Contrat et clés GeniusPay **live**, secret du webhook, URL `https://<domaine>/api/webhooks/geniuspay` | GeniusPay | aucun paiement réel ne doit être fait pour « tester » |
| C4 | Bucket R2 privé de production et jetons (distinct du bucket de test) | Cloudflare R2 | `../storage-r2.md` |
| C5 | Clés VAPID et un `VAPID_SUBJECT` réel (`mailto:` d'une adresse que vous lisez) | votre poste | un sujet d'exemple désactive le push en production |
| C6 | Variables **Production** du projet `web` (toutes différentes de Preview) | Vercel | `vercel-environments.md` § 3 |
| C7 | `QADR_OWNER_USERNAME` et `QADR_OWNER_PASSWORD` (Production), puis première connexion à `/platform/login`, puis retrait des deux variables | Vercel, puis navigateur | l'agent ne choisit ni identifiant ni mot de passe |
| C8 | Instantané manuel de la branche Neon `main` juste avant la première migration | console Neon → *Backup & Restore* | l'unique instantané de l'offre Free lui est réservé |
| C9 | Créer la formule **Standard** dans `/platform/plans` (5 000 FCFA, 30 jours, D-04) | console de la plateforme | fiche : `../product/landing-page.md` § 3.1 ; aucun tarif n'est écrit dans le code |
| C10 | Décider de la politique pour un commerce sans abonnement ou en `pending` | décision produit | aujourd'hui non bloqué |

## D. Après le lancement

| # | Action | Fréquence |
| --- | --- | --- |
| D1 | Installer PostgreSQL 18 (outils clients) ou Docker, puis premier `pg_dump` chiffré et test de restauration dans une base vide | une fois, puis hebdomadaire (quotidien sur l'offre Free) ; `backup-restore.md` § 4 et § 6.3 bis |
| D2 | Recevoir une vraie notification push sur un téléphone | une fois ; tant que ce n'est pas fait, le push n'est pas déclaré opérationnel |
| D3 | Imprimer un vrai ticket sur une imprimante thermique | une fois ; aucune impression réelle n'est vérifiée (B-2) |
| D4 | Vérifier l'adresse IP vue par la limitation derrière Vercel (et Cloudflare si le proxy est activé) | une fois sur le Preview ; `../rate-limiting.md` |
| D5 | Supprimer, si vous le souhaitez, la branche Neon `restore-test-2026-11-12` et les bases orphelines `qadr_t_26b71d2dd995`, `qadr_t_2daf7bad4b7c`, `qadr_t_71046c3dca94` de la branche de staging | une fois ; l'agent n'a pas le droit de supprimer une base |
| D6 | Revue des accès (Vercel, Neon, GitHub, Cloudflare, Resend, GeniusPay) | mensuelle |
| D7 | Relecture juridique de `/privacy` et des conditions d'utilisation | avant d'ouvrir l'inscription au public |
