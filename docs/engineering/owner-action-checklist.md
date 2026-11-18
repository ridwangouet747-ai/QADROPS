# Checklist unique du propriétaire

> Mise à jour le 2026-11-14 (mise en production, puis mission CTO : `mission-cto-2026-11-14.md`). Elle remplace toutes les listes précédentes. Chaque action revient
> au propriétaire parce qu'elle demande un accord, une dépense, un secret ou un accès que l'agent n'a pas.
> **Ne collez jamais un secret dans une conversation avec un agent** : saisissez-le directement dans Vercel,
> GitHub ou le tableau de bord concerné.
>
> Classement : **P** = obligatoire avant utilisation personnelle ; **C** = obligatoire avant ouverture aux
> commerçants ; **L** = peut attendre.

Déjà fait par l'agent (pour mémoire) : sauvegarde restaurée et migration de Neon `main` (26), RLS vérifiée, fusion de
`7c10771` dans `main` après CI vert, déploiement de production READY sur `https://web-phi-beryl-45.vercel.app`,
protection Vercel en mode standard (domaine public, Preview protégés), clés GeniusPay live, DSN Sentry et
`VAPID_SUBJECT` posés en Production (*Sensitive*), workflow CI. Détail : `mission-global-release-report.md`.

**Tout de suite** : remettre le dépôt GitHub `QADROPS` en **privé** (GitHub → *Settings* → *General* → *Danger Zone*).
Il répondait encore publiquement le 2026-11-14 au soir. Aucun secret n'a été trouvé dans l'historique Git (balayage du
2026-11-14) ; renouvelez quand même toute clé que vous auriez collée dans une *issue*, une *pull request*, un journal
d'*Actions* ou un fichier hors Git pendant la période publique.

## P. Obligatoire avant utilisation personnelle

| # | Action | Type | Où | Détail |
| --- | --- | --- | --- | --- |
| P-0 | ~~Sauvegarde réelle~~ | fait | — | restauration prouvée le 2026-11-13 |
| P-1 | ~~Migration de Neon `main`~~ | fait | — | 26 migrations, 2026-11-13 |
| P-2 | ~~Fusion dans `main` et protection standard~~ | fait | — | `7c10771`, 2026-11-14 |
| P-3 | Saisir `QADR_OWNER_USERNAME` et `QADR_OWNER_PASSWORD` (type *Sensitive*, Production seulement), redéployer, se connecter à `/platform/login`, puis retirer les deux variables | clé | Vercel → `web` → *Settings* → *Environment Variables* | l'agent ne choisit aucun identifiant ; nom de 3 à 30 caractères (a-z, 0-9, point, tiret bas), mot de passe de 12 caractères au moins, propre à Qadr Ops |
| P-3 bis | ~~Saisir `QADR_REGISTRATION_ALLOWLIST`~~ **inutile depuis le 2026-11-18** : en mode code (`manual_code`, production actuelle), un code `QADR-` valide suffit pour créer un compte de commerçant ; la liste n'est plus consultée | — | — | ne posez pas cette variable pour vos clients ; elle ne sert plus qu'en mode `geniuspay` (`../authentication.md` § 11.6) |
| P-4 | Créer les secrets GitHub `BACKUP_PASSPHRASE` (32 caractères au moins, gardée hors de GitHub), `NEON_STAGING_DATABASE_URL` (chaîne **directe** de la branche `mission-14-staging`, base `qadr_staging`) puis, après P-1, `NEON_BACKUP_DATABASE_URL` (chaîne directe de `main`) ; lancer « Sauvegarde Neon » à la main avec la source voulue | clé + validation | GitHub → *Settings* → *Secrets and variables* → *Actions* ; onglet *Actions* | GitHub ne propose le lancement manuel qu'une fois le workflow présent sur `main` (après P-2) ; procédure : `backup-restore.md` § 4.0 |
| P-5 | Second facteur du propriétaire | décision + validation | Vercel, puis votre poste | `scripts/platform-owner.ts enroll-2fa` chiffre le facteur avec `BETTER_AUTH_SECRET` ; celui de Production est de type *Sensitive*, donc illisible, même pour vous. **Avant toute création de compte**, remplacez-le dans Vercel par un secret que vous générez et gardez dans votre gestionnaire de mots de passe (48 caractères aléatoires), puis lancez le script avec ce secret, la chaîne de `main`, `QADR_OWNER_USERNAME` et `QADR_OWNER_PASSWORD`. Facultatif (D-05), fortement conseillé |
| P-5 bis | Formule Standard | validation | votre poste, ou l'agent avec P-0 (a) | `npx tsx scripts/ensure-standard-plan.ts` (après P-3) : crée `STANDARD` (5 000 XOF, 30 jours, toutes fonctions, sans limite) **inactive**, donc absente de la page publique sous Hobby ; idempotent, aucun doublon |
| P-5 ter | Ouvrir votre propre commerce : depuis le 2026-11-14, un commerce sans abonnement est **fermé** (seule la page Abonnement s'affiche). Un code d'accès ne se crée que sur une formule **active** (règle de la mission 08) : dans `/platform/plans`, activez la formule Standard (P-5 bis), créez dans `/platform` une série d'un code (durée voulue), désactivez aussitôt la formule, puis saisissez le code sur `/business/subscription` | validation | console de la plateforme, puis votre espace | aucun paiement ; la formule reste visible sur la page publique jusqu'à 10 min (cache) pendant l'opération, sans effet tant que les inscriptions sont réservées (P-3 bis). Décision possible : autoriser les codes sur une formule inactive (à demander à l'agent) |
| P-6 | Parcourir l'application connectée : créer une boutique, un produit, du stock, une vente, un paiement manuel, un crédit, une dépense, un fournisseur, consulter le tableau de bord, exporter, se déconnecter | validation | navigateur | l'agent ne peut pas passer Turnstile ; signalez toute erreur, il la corrige |
| P-7 | Rester sur l'usage personnel tant que l'offre Vercel est Hobby : pas de commerçant tiers, pas de paiement réel, pas de formule publiée | décision | — | conditions Vercel § 4 |

## C. Obligatoire avant ouverture aux commerçants

| # | Action | Type | Où | Détail |
| --- | --- | --- | --- | --- |
| C-1 | Passer l'équipe Vercel en **Pro** | compte (dépense) | Vercel → *Settings* → *Billing* | Hobby interdit l'usage commercial |
| C-2 | Passer Neon sur une offre avec restauration longue et sauvegardes (Launch au minimum) | compte (dépense) | Vercel → *Storage* → `qadr-data-base` | Free : 6 h de restauration |
| C-3 | Ouvrir les inscriptions : `QADR_REGISTRATION=open` (et retirer `QADR_REGISTRATION_ALLOWLIST`) | décision + clé | Vercel | seulement avec l'offre Pro (C-1) ; tant que l'offre est Hobby, la liste réserve l'application à vos adresses |
| C-4 | Domaine (achat) puis DNS Cloudflare en **nuage gris** ; mettre à jour `BETTER_AUTH_URL` et le domaine du widget Turnstile | compte (dépense) + DNS | registraire, Cloudflare, Vercel | aucun domaine n'est acheté |
| C-5 | Resend : domaine vérifié (enregistrements SPF, DKIM et DMARC à créer dans Cloudflare, donnés par Resend), `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | DNS + clé | Resend, Cloudflare, Vercel | `resend-dns.md` ; sans eux, ni réinitialisation de mot de passe ni invitation par e-mail |
| C-6 | GeniusPay live : clés posées par l'agent (secret **non vérifié**, la seule vérification crée un paiement). Reste : déclarer le webhook `https://web-phi-beryl-45.vercel.app/api/webhooks/geniuspay` (puis le domaine définitif) dans le tableau de bord GeniusPay, et décider d'un premier paiement réel de faible montant pour valider la chaîne | compte + validation | GeniusPay | aucun paiement n'a été créé |
| C-7 | Créer la formule **Standard** : 5 000 FCFA, 30 jours, toutes fonctions (D-04) | validation | `/platform/plans` | aucun tarif n'est écrit dans le code |
| C-8 | ~~`VAPID_SUBJECT`~~ | fait | — | posé le 2026-11-14 ; réception réelle non testée (L-5) |
| C-9 | ~~Politique pour un commerce sans abonnement~~ | fait | — | tranchée par le mandat CTO du 2026-11-14 : fermé jusqu'au paiement confirmé par le serveur, à un code d'accès ou à un abonnement accordé |
| C-10 | Relecture juridique de `/privacy` et des conditions d'utilisation | validation | — | |
| C-11 | Vérifier l'adresse IP vue par la limitation derrière Vercel (et Cloudflare si proxy) | validation | Preview ou production | `../rate-limiting.md` |

## M. Modèle commercial par codes (mission du 2026-11-16)

Déployé en production le 2026-11-16 (`b3dbc64`, migration `0026` appliquée sur `main`) ; rien n'est encore émis ni vendu.

| # | Action | Type | Où | Détail |
| --- | --- | --- | --- | --- |
| M-1 | ~~`QADR_WHATSAPP_NUMBER`~~ | fait | — | numéro fourni par le propriétaire le 2026-11-16, posé par l'agent sur le projet `web` (Production et Preview, format international `225…`) ; le bouton n'apparaît en production qu'après le déploiement de cette version |
| M-2 | `QADR_CODE_SECRET` (48 caractères aléatoires, *Sensitive*), une valeur différente par environnement | clé | Vercel | à défaut, `BETTER_AUTH_SECRET` sert de clé ; le changer plus tard rend inutilisables les codes non utilisés (`../commercial-access-codes.md` § 3) |
| M-3 | Laisser `QADR_COMMERCIAL_MODE` **absent** (mode `manual_code`, GeniusPay en pause) ; `geniuspay` seulement sur décision | décision | Vercel | `../billing-geniuspay.md` § 0 |
| M-4 | ~~Migration `0026` sur Neon `main`~~ | fait | — | 2026-11-16, sur votre accord : répétition réussie sur `repetition-0026-2026-11-16` (copie de `main`), point de retour `sauvegarde-main-avant-0026-2026-11-16` (branche Neon, pas un `pg_dump` : outils absents du poste, emplacement d'instantané Free déjà pris), puis `migrate-production.ts` : 27 migrations, une transaction. Les deux branches sont conservées ; à supprimer seulement sur votre décision |
| M-5 | Publier la formule Standard (`ensure-standard-plan.ts --publish` ou `/platform/plans`) | décision | console | un code ne se génère que sur une formule active |
| M-6 | Depuis le 2026-11-18, en production, un compte de commerçant exige un code `QADR-` valide, et lui seul (plus de liste). Chaque code que vous émettez ouvre donc l'application à un commerçant tiers : sous l'offre Hobby (usage non commercial), n'émettez de code qu'à vous-même tant que C-1 n'est pas fait | décision | `/platform` | les comptes d'employés créés par code `EQP-` ne passent ni par la liste ni par un code commercial |

## L. Peut attendre

| # | Action | Type | Détail |
| --- | --- | --- | --- |
| L-1 | Variables **Preview** du projet `web` : base de staging, secrets propres, clés GeniusPay **sandbox**, Turnstile de test | clés | `vercel-environments.md` § 3 ; sans elles, les Preview répondent 500 aux API |
| L-2 | Bucket R2 privé de production et jetons ; bucket de test pour `r2.integration.test.ts` | compte + clés | `../storage-r2.md` |
| L-3 | ~~DSN Sentry~~ | fait | — | posés le 2026-11-14 ; aucun événement observé |
| L-4 | Projet Vercel `qadrops` : le **déconnecter du dépôt** puis l'archiver | décision | sa `DATABASE_URL` vise un **autre** projet Neon (`soft-shadow-14690872`). Constat du 2026-11-14 : il **est** relié au dépôt par Git et construit chaque poussée (`f6573d1` sur `main`, `c1f636f` sur la branche de la mission CTO), alors que `web`, le projet canonique, ne construit pas les branches. Vercel → `qadrops` → *Settings* → *Git* → *Disconnect* |
| L-5 | Recevoir une vraie notification push sur un téléphone ; imprimer un vrai ticket | validation | rien de cela n'est vérifié |
| L-6 | Supprimer, si vous le souhaitez, la branche `restore-test-2026-11-12` et les bases `qadr_t_26b71d2dd995`, `qadr_t_2daf7bad4b7c`, `qadr_t_71046c3dca94` de staging | décision | l'agent ne supprime aucune donnée |
| L-7 | Décider du sort de la préparation Workers (`wrangler`, `@opennextjs/cloudflare`, scripts `cf:*`) | décision | elle porte les 4 alertes élevées de `npm audit` complet |
| L-8 | Revue mensuelle des accès (Vercel, Neon, GitHub, Cloudflare, Resend, GeniusPay) | validation | |
