# Mission CTO, suite du 2026-11-18 : e-mail facultatif, code de secours, ticket, page publique, release

> Rapport de l'agent. Il sépare ce qui est prouvé (commande, résultat) de ce qui ne l'est pas.
> Aucun paiement réel, aucune vente, aucun client ni aucun compte n'a été créé en production.
> Branche `feat/mission-codes-2026-11-16`, commits `bda94f5` (page publique, ticket) et `5084c90` (comptes sans
> e-mail, code de secours). Migration ajoutée : `0028_account_recovery_code.sql` (additive).

**Verdict : DÉPLOYÉ, VALIDATION PARTIELLE.** Le code testé (`5084c90`, CI verte) est en production sur le projet Vercel `web`, la migration 0028 est appliquée sur `main` et sur staging. Les parcours connectés (inscription sans e-mail, récupération, caisse) ont été rejoués en local et par la suite automatisée, pas sur la production, où aucun compte de test n’a été créé.

## A. Accès Super Admin

- Seul accès visible : le lien de `/login`, renommé « Zone de l’administration » (en : « Administration area »,
  ar : « منطقة الإدارة »), vers `/platform/login`. Aucun autre lien vers `/platform` dans l'espace commerçant
  (inchangé depuis le 2026-11-17).
- La protection reste côté serveur (`getPlatformContext`, 404 pour tout autre compte, tous les rôles de commerce
  testés dans `platform-and-system.http.test.ts`, suite verte).

## B. Caisse

Livrée le 2026-11-17 (`docs/caisse-reglements.md`) et inchangée : montant remis, monnaie rendue, Mobile Money
déclaratif (Wave, Orange Money, MTN MoMo, Moov Money) confirmé à la saisie, paiements mixtes, idempotence. Le chiffre
d'affaires et la caisse attendue ne comptent jamais la monnaie rendue. Couverture : suite automatisée (verte).

## C. Ticket

- Le logo du commerce ramène à la page d'origine par une liste fermée (`lib/printing/receipt-return.ts`, `?from=`,
  défaut : la caisse) ; aucune adresse externe acceptée (testé).
- Ligne « Caissier » à l'écran et en ESC/POS.
- Arabe : police arabe dédiée (la police à chasse fixe étirait le texte) et montants alignés comme en français
  (`<span class="ms-auto"><bdi dir="ltr">`, une marge dans un `bdi` ltr se résolvait à l'envers). Test de non-régression
  dans `thermal-receipt.test.ts`. Tests ticket et impression : 54/54.
- Non vérifié sur une imprimante réelle (B-2).

## D. Formulaire produit

Contrôlé à 360 px : 7 champs, aucun chevauchement (correction du 2026-11-17).

## E. Dettes des clients

Dette de départ et remboursements livrés le 2026-11-17 (`customer-opening-debt.http.test.ts`), inchangés.

## F. E-mail facultatif (priorité du mandat)

| Exigence | Réalisation |
| --- | --- |
| Inscription sans adresse | `/register` : champ e-mail marqué facultatif ; vide → nom d'utilisateur obligatoire (`[a-z0-9._]{3,30}`), `POST /api/account/sign-up/username` |
| Aucune fausse adresse | `user.email` reste `NULL` (vérifié en base de test et par `/api/account/me`) |
| Mêmes barrières | origine, Turnstile, limite `signUpIp`, liste de production (`registrationAllowsUsername` : entrée sans « @ » = nom d'utilisateur), laissez-passer du code d'accès ; la création directe contourne les `databaseHooks`, la route réapplique donc chaque barrière |
| Récupération sûre | code `SEC-…` montré une fois, haché (scrypt) dans `account_recovery_code` ; `/recover-account` : même 401 pour tout échec, limites par IP et par compte, usage unique, toutes les sessions fermées, nouveau code émis |
| Jamais par téléphone ni par un employé | aucun parcours de ce type ; Resend n'est pas requis |
| Nouveau code | carte « Code de secours » dans les réglages, mot de passe actuel exigé, l'ancien code devient invalide |

Tests : `account-without-email.http.test.ts` (14/14, cas 1 à 12 du mandat et variantes), `wizard.test.ts`,
`pglite-migrations.integration.test.ts`. Contrôle navigateur local à 320 px en fr/en/ar : inscription, code affiché,
case « J'ai noté » obligatoire, puis étape « Votre commerce ». Documentation : `docs/authentication.md` § 12.

## G. `/redeem-code` et `/recover-account`

Aucun débordement à 320 px en fr/en/ar (mesure des éléments hors écran, y compris à gauche en RTL).

## H. WhatsApp

Aucune modification (aucun fichier WhatsApp dans les deux commits).

## I. Page publique

Section « Sur téléphone » et captures (48 webp) regénérées : noms de test traduits (« Test shop », « متجر تجريبي »),
aucune mention « Démo », aucun montant coupé sous la navigation ; ticket arabe lisible. Tests de la page : 27/27.

## J. Contrôles, migrations, déploiement

| Point | Résultat |
| --- | --- |
| `npx vitest run` (suite complète) | 113 fichiers, **992 réussis**, 10 ignorés, 0 échec |
| `npm run typecheck`, `npm run lint` | 0 erreur |
| `npx drizzle-kit check` puis `generate` | « Everything's fine », « No schema changes » |
| `npm run build` | 95 pages ; premier essai arrêté par l'avis Next.js réservé aux agents (§ L), second essai réussi |
| `npm run audit:prod` | aucune alerte high/critical hors l'exception datée `picomatch` |
| CI `44208798622` (`5084c90`) | **succès** |
| Point de retour Neon | `sauvegarde-main-avant-0028-2026-11-18` (copie de `main`) ; répétition sur `repetition-0028-2026-11-18` : 28 → 29 |
| Staging (`qadr_staging`) | 29 migrations, table à 4 colonnes, clé étrangère `CASCADE`, 0 ligne |
| Production (`main`) | `migrate-production.ts` : « 28 appliquées, 1 en attente … Terminé en une transaction : 29 » ; contrôle : 4 colonnes, `CASCADE`, 0 ligne, 1 compte et 1 commerce inchangés |
| Fusion | avance rapide sans forçage `796a32f..5084c90` sur `main` |
| Production Vercel | `dpl_9rrzcX4Zq1mKTnpz3wP8aEiSRvSX`, **READY**, `githubCommitSha` = `5084c90`, alias `web-phi-beryl-45.vercel.app` ; `vercel logs --environment production --since 20m`, niveau erreur : 0 enregistrement |
| Pages | `/`, `/login`, `/register`, `/recover-account`, `/redeem-code`, `/join-business`, `/platform/login`, `/privacy` : 200 ; `/business/pos` : 307 sans session ; `/login` contient un seul lien `/platform/login` (« Zone de l’administration ») ; 4 liens `wa.me` vers le même numéro, comme avant ; `POST /api/account/recover` vide : 400, sans erreur serveur |

Aucune branche Neon supprimée (10 branches). Les fichiers d'adresse de base utilisés pour les migrations ont été
effacés du poste ; aucune valeur n'a été écrite dans le dépôt.

## K. Sécurité et données

- Code de secours jamais stocké en clair ni journalisé ; comparaison par `verifyPassword` ; même réponse pour un nom
  inconnu, un code faux ou déjà utilisé ; limites `recoveryCodeIp` (20/15 min) et `recoveryCodeAccount` (5/15 min).
- `account_recovery_code` n'a pas de `business_id` : hors RLS, lue seulement par les routes du compte connecté ou de
  récupération.
- **Dépôt GitHub `QADROPS` rendu public le 2026-11-18 par le propriétaire** pour permettre la lecture de la CI. Aucun
  secret n'est versionné (diff contrôlé), mais le code, les docs d'exploitation et les identifiants d'infrastructure
  (noms de branches Neon, identifiant d'équipe Vercel) sont lisibles par tous. Recommandation : le repasser en privé
  et donner à l'application GitHub du connecteur l'accès à ce seul dépôt.

## L. Limites et actions du propriétaire

1. **Production sur liste fermée** : en production, une inscription par nom d'utilisateur est refusée tant que ce nom
   n'est pas dans `QADR_REGISTRATION_ALLOWLIST` (ou `QADR_REGISTRATION=open`), comme pour une adresse e-mail.
2. **Code de secours perdu** : un compte sans e-mail qui perd mot de passe et code n'a aucune récupération ; c'est
   voulu (pas de réinitialisation par téléphone ni par un employé). Une procédure d'assistance vérifiée reste à définir.
3. **Next.js 16.4.6** (fait le 2026-11-18, `d195585`, accord du propriétaire) : correctif des deux alertes modérées
   GHSA-mfr8-8qww-v76h et GHSA-vc7v-qv4w-wrv8 (`'use cache'` avec paramètres racine, non utilisé ici). Seuls `next` et
   ses paquets `@next/*` changent au lockfile ; CI `44259103695` verte, production `dpl_9nDFMgxxZTEc8hXZ9JWqacLTpgq3`
   READY, pages 200 et 0 erreur dans les journaux.
4. **Non vérifié** : parcours connectés sur la production (aucun compte de test créé en production, à dessein),
   Turnstile réel, imprimante réelle, vrai téléphone.
5. Bloquants hérités : offre Vercel Hobby, offre Neon Free sans sauvegarde planifiée, domaine et clés Resend/Turnstile
   de production, exception `picomatch` jusqu'au 2026-12-17.
