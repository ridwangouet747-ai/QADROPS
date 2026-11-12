# Limitation des tentatives partagée (mission 14)

## Pourquoi

La limitation intégrée de Better Auth garde ses compteurs **en mémoire de chaque instance**. Sur Vercel, plusieurs
instances tournent en parallèle : un attaquant qui répartit ses essais multiplie son quota par le nombre
d'instances. Les compteurs de Qadr Ops sont donc dans PostgreSQL, communs à toutes les instances, sans nouveau
prestataire (pas de Redis, aucune dépense).

## Fonctionnement (`src/lib/security/rate-limit.ts`, migration 0024)

- Table `rate_limit_bucket (key primaire, window_start, hits)`, une ligne par (règle, sujet).
- **Atomique** : `INSERT … ON CONFLICT (key) DO UPDATE SET hits = … RETURNING hits`. Deux instances qui comptent
  en même temps sont sérialisées par PostgreSQL sur la ligne : aucune tentative perdue, jamais plus que la
  limite autorisée (test : 40 tentatives simultanées, exactement la limite acceptée, compteur final 40).
- **Fenêtre fixe** alignée sur sa durée. Une instance dont l'horloge retarde ne remet jamais à zéro une fenêtre
  plus récente (`greatest(window_start)`). À cheval sur deux fenêtres, au plus deux fois la limite : borné.
- **Sujet jamais en clair** : la clé est `règle:HMAC-SHA256(secret, règle + sujet)` tronqué à 40 caractères ;
  ni adresse IP ni e-mail dans la table.
- **Réservation avant vérification** : la tentative est comptée avant de vérifier le mot de passe, si bien que
  des requêtes simultanées ne passent pas toutes. Une connexion réussie du propriétaire est ensuite rendue
  (`refundRateLimit`) : seuls les échecs épuisent son quota.
- **Purge** : le cron quotidien `/api/cron/subscriptions` supprime les fenêtres échues depuis plus d'un jour
  (`purgeRateLimitBuckets`, champ `rateLimit` de la réponse).
- Réponse au-delà de la limite : 429 avec `retry-after` = secondes restantes de la fenêtre.

## Règles

| Règle | Sujet | Limite |
| --- | --- | --- |
| Console : mot de passe | client (empreinte IP) / global | 5 / 30 par 15 min |
| Console : second facteur | client / global | 5 / 30 par 15 min |
| `POST /api/auth/sign-in/email` | adresse IP / **compte visé** (e-mail normalisé) | 60 / 10 par 15 min |
| `POST /api/auth/sign-up/email` | adresse IP | 30 par heure |
| `POST /api/auth/request-password-reset` | adresse IP / compte visé | 20 / 3 par heure |
| `POST /api/auth/reset-password` | adresse IP | 20 par 15 min |
| `POST /api/auth/send-verification-email` | adresse IP | 10 par heure |
| `POST /api/auth/sign-in/social` | adresse IP | 60 par 15 min |
| `POST /api/public/campaigns/check` (mission 18, `public.campaign_check.ip`) | adresse IP | 20 par 10 min, compté **après** un Turnstile réussi |
| `POST /api/auth/change-password` (2026-11-12, `auth.change_password.ip` / `auth.change_password.account`) | adresse IP / **compte de la session** (jamais une valeur du corps) | 20 / 5 par 15 min ; le 6e essai d'un compte reçoit 429 même avec le bon mot de passe actuel |

La vérification publique d'un code de campagne garde aussi sa barrière en mémoire (`publicCampaignCheckLimiter`), qui
coupe une rafale sur une même instance sans écrire en base ni appeler Siteverify ; le compteur partagé fait tenir la
limite sur toutes les instances (test « mission 18 : la limite tient sur plusieurs instances »).

**Ordre (mission 15)** : les limites par adresse sont comptées avant le défi Turnstile, les limites par compte
seulement après un défi réussi. Sinon, dix requêtes sans défi suffisaient à bloquer pendant 15 min le compte d'un
commerçant (test `rate-limit.http.test.ts`, « mission 15 »). Le `remoteip` transmis à Turnstile suit la même
politique d'en-têtes (`clientIpFrom`), et non plus `cf-connecting-ip`.

Les limites par adresse restent larges : en Côte d'Ivoire, beaucoup de clients mobiles partagent une adresse
publique (CGNAT). Le compte visé est protégé plus strictement, quelle que soit l'adresse utilisée. La limitation
intégrée de Better Auth reste active en plus (par instance).

Les règles s'appliquent aux requêtes HTTP (`context.request`) ; les appels serveur `auth.api.*` (scripts,
services) ne sont pas comptés.

### Récupération de compte (revue mission 16)

| Abus | Protection | Vérifié par |
| --- | --- | --- |
| Inonder une boîte de réception de liens | 3 demandes par heure et par adresse visée (comptées après Turnstile), 20 par heure et par adresse IP, Turnstile obligatoire en production | `rate-limit.http.test.ts` (« trois par heure et par compte ») |
| Énumérer les comptes par la demande | réponse identique (200, même corps) pour une adresse connue, inconnue ou à second facteur ; envoi après la réponse (`backgroundTasks`) | `auth-security.http.test.ts`, `auth-delivery.integration.test.ts` |
| Deviner un jeton | 24 caractères alphanumériques aléatoires (≈ 143 bits), valable 1 h, usage unique, stocké en empreinte SHA-256 ; `POST /reset-password` limité à 20 essais par 15 min et par adresse IP | `auth-security.http.test.ts` |
| Détourner le lien vers un autre site | `redirectTo` et `callbackURL` vérifiés contre `trustedOrigins` (403 `INVALID_REDIRECT_URL`) ; contrôle forcé aussi en test (`disableOriginCheck: false`) | `auth-security.http.test.ts` |
| Reprendre le compte du propriétaire de la plateforme par sa boîte de réception | aucun lien envoyé à un compte à second facteur (changement par `scripts/platform-owner.ts` seulement) | `auth-security.http.test.ts` |

Limite : le blocage par compte (3 par heure) peut être déclenché volontairement par un tiers qui connaît l'adresse
et réussit le défi Turnstile ; la victime attend alors au plus une heure (l'écran affiche `auth.forgot.throttled`).

## Adresse du client

Même politique que Better Auth (`src/lib/auth/client-ip-headers.ts`) : `x-forwarded-for` (posé par
l'hébergeur) hors Cloudflare Workers, `cf-connecting-ip` seulement sur Workers. Sans en-tête, le sujet est
« inconnu » : toutes ces requêtes partagent un compteur (plus strict, jamais plus permissif).

### Chaîne de confiance (audit mission 14.1, documentation Vercel relue le 2026-11-09)

| Montage | `x-forwarded-for` reçu par l'application | Falsifiable par le client ? | Effet sur la limitation |
| --- | --- | --- | --- |
| Visiteur → Vercel (Cloudflare en **DNS seul**, nuage gris) | adresse publique du visiteur, **réécrite par Vercel** (« we currently overwrite the X-Forwarded-For header ») | non | correct : une adresse par visiteur (ou par CGNAT) |
| Visiteur → Cloudflare **proxy** (nuage orange) → Vercel | adresse **du nœud Cloudflare** : Vercel ne relaie pas l'adresse d'origine sans *Verified Proxy* (offre Enterprise) | non | **dégradé** : des visiteurs sans lien partagent un compteur ; les limites par adresse peuvent bloquer des innocents (la limite par compte reste juste) |
| Lire `cf-connecting-ip` sur Vercel | — | **oui** : l'adresse `*.vercel.app` reste joignable sans Cloudflare, et n'importe qui peut y poser cet en-tête | refusé : ce n'est jamais fait hors Workers |

Conclusion : le code est sûr (il ne lit qu'un en-tête que l'hébergeur écrase), mais il n'est **juste qu'en mode
DNS seul**, celui que recommande `docs/production-setup-guide.md` § 8.2 (décision D-04 encore à prendre). La
vérification réelle demande un déploiement Preview : afficher, sur une route de diagnostic temporaire et protégée,
le premier élément de `x-forwarded-for` et le comparer à l'adresse publique du poste, en mode nuage gris puis orange.

## Limites connues

- Une ligne écrite par tentative sur ces routes : coût négligeable au volume visé, mais à surveiller.
- Un attaquant peut volontairement épuiser le quota d'un compte (blocage temporaire de 15 min à 1 h) : c'est le
  prix d'une protection par compte ; la victime peut toujours réinitialiser son mot de passe.
- Adresse réellement reçue sur Vercel : **non vérifiée** sans déploiement Preview (voir la chaîne de confiance
  ci-dessus) ; en proxy Cloudflare, les limites par adresse deviennent partagées.
- Tests : `src/test/rate-limit.http.test.ts` (atomicité, fenêtres, horloges décalées, remboursement, purge,
  limite par compte à travers plusieurs adresses et deux instances Better Auth), exécutables sur PGlite et sur
  la branche Neon de staging (`QADR_TEST_POSTGRES_URL`, voir `docs/validation.md`).
