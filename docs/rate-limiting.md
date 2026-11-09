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

Les limites par adresse restent larges : en Côte d'Ivoire, beaucoup de clients mobiles partagent une adresse
publique (CGNAT). Le compte visé est protégé plus strictement, quelle que soit l'adresse utilisée. La limitation
intégrée de Better Auth reste active en plus (par instance).

Les règles s'appliquent aux requêtes HTTP (`context.request`) ; les appels serveur `auth.api.*` (scripts,
services) ne sont pas comptés.

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
