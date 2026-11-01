# Déploiement de l'application sur Cloudflare Workers

Décision du propriétaire (2026-11-01) : l'application `apps/web` (landing page, espace commerçant `/business`, console Super Admin `/platform`) est hébergée sur **Cloudflare Workers**, pas sur Vercel. Ce guide remplace le § 4 (Vercel) et le § 12 (crons) de `docs/production-setup-guide.md`.

**Rien n'a été déployé.** Aucun compte Cloudflare n'a été relié, aucun secret créé.

## 1. Choix technique : OpenNext

Next.js tourne sur Workers grâce à l'adaptateur **OpenNext** (`@opennextjs/cloudflare` 1.20.15, épinglé). Il transforme la sortie normale de `next build` en Worker.

Cloudflare recommande désormais **vinext** pour les *nouveaux* projets. vinext réimplémente Next.js sur Vite ; il n'exécute pas le vrai Next.js. Pour une application existante qui gère de l'argent, du stock et des comptes, OpenNext est plus sûr : c'est le build Next.js testé qui est déployé. `docs/cloudflare-evaluation.md` écartait déjà vinext (bêta). À réévaluer plus tard avec `npx vinext check`.

## 2. Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/web/wrangler.jsonc` | Nom du Worker (`qadr-ops`), date de compatibilité, fichiers statiques, journaux, horaires des crons |
| `apps/web/open-next.config.ts` | Options OpenNext (aucun cache incrémental : l'application est dynamique) |
| `apps/web/cloudflare/worker.ts` | Point d'entrée : le serveur Next.js (`fetch`) plus les tâches planifiées (`scheduled`) |
| `apps/web/src/lib/cron-schedule.ts` | Horaire → route appelée, avec `Authorization: Bearer <CRON_SECRET>` (testé) |
| `apps/web/src/lib/auth/client-ip-headers.ts` | Adresse IP du visiteur pour la limitation de débit : `cf-connecting-ip` sur Workers (testé) |
| `apps/web/vercel.json` | **Plus utilisé** sur Cloudflare. Conservé tant que vous n'avez pas décidé de le supprimer |

Scripts (depuis `apps/web`) :

| Script | Effet |
| --- | --- |
| `npm run cf:build` | Build Next.js puis conversion en Worker dans `.open-next/` |
| `npm run cf:preview` | Build puis exécution locale dans le vrai runtime Workers (`workerd`) |
| `npm run cf:deploy` | Build puis **mise en ligne**. Jamais sans votre accord explicite |

`npm run preview` reste l'aperçu de démonstration (PGlite en mémoire) ; il n'a rien à voir avec Cloudflare.

## 3. Windows : construire sous Linux

OpenNext affiche lui-même : « OpenNext is not fully compatible with Windows ». Le build local sous Windows sert à vérifier ; **le build de production doit se faire sous Linux** : Workers Builds (intégration Git de Cloudflare), GitHub Actions ou WSL.

**Ne jamais construire pour la production sur un poste qui a un `.env.local`.** OpenNext recopie les valeurs des fichiers `.env*` lus par Next.js dans le Worker (`.open-next/cloudflare/next-env.mjs`). Constaté le 2026-11-01 : le build local contenait le DSN Sentry et `SENTRY_TEST_ENABLED=true` de `.env.local`. Un secret placé dans ce fichier partirait donc dans le code mis en ligne. Les variables du Worker (secrets Cloudflare) restent prioritaires sur ces valeurs.

## 4. Ce que vous devez faire sur Cloudflare

1. Compte Cloudflare. *Workers Free* limite chaque requête à **10 ms de CPU** : c'est trop court pour rendre les pages Next.js de façon fiable. Prévoir *Workers Paid* (payant, tarif à vérifier sur la page officielle avant de s'engager) pour l'exploitation. Limites vérifiées le 2026-11-01 sur developers.cloudflare.com/workers/platform/limits : 64 Mio de Worker non compressé sur les deux offres, 1 s de démarrage, 5 Cron Triggers par compte en Free.
2. Se connecter en local : `npx wrangler login` (depuis `apps/web`).
3. Saisir les **secrets**, un par un (la valeur est demandée, jamais écrite dans un fichier) :
   ```
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put CRON_SECRET
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put SENTRY_DSN
   ```
4. Saisir les **variables non secrètes** dans *Workers & Pages → qadr-ops → Settings → Variables* : `BETTER_AUTH_URL`, `NEXT_PUBLIC_AUTH_URL`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `SENTRY_ENVIRONMENT=production`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`.
5. Les variables `NEXT_PUBLIC_*` sont **figées au moment du build** : elles doivent être présentes là où le build tourne (variables de build de Workers Builds, ou environnement de la CI), pas seulement dans les réglages du Worker : `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_AUTH_URL`.
6. Domaine : *Workers & Pages → qadr-ops → Settings → Domains & Routes → Add → Custom domain* (par exemple `app.votredomaine.ci`). Le domaine doit être géré par Cloudflare (DNS). `BETTER_AUTH_URL` doit être exactement cette adresse.
7. Turnstile : autoriser ce domaine dans le widget de production.

Liste complète et rôle de chaque variable : `docs/production-setup-guide.md` § 3.

## 5. Tâches planifiées

Les crons de Vercel sont remplacés par des **Cron Triggers** (heure UTC = heure d'Abidjan) :

| Horaire | Route appelée | Rôle |
| --- | --- | --- |
| `0 1 * * *` | `/api/cron/subscriptions` | Expire les abonnements échus |
| `0 7 * * *` | `/api/internal/notifications/process` | Rattrape la boîte d'envoi, prévient des fins d'abonnement |

`cloudflare/worker.ts` appelle ces routes à l'intérieur du Worker avec `CRON_SECRET` (au moins 32 caractères). Sans ce secret, rien n'est exécuté et un message apparaît dans les journaux. Une réponse en erreur marque l'exécution en échec (*Workers → qadr-ops → Triggers → Cron Events*). Pour changer un horaire : `wrangler.jsonc` **et** `src/lib/cron-schedule.ts` (un test vérifie qu'ils concordent).

## 6. Points propres à Workers

- **Adresse IP et limitation de débit.** Sur Workers, `x-forwarded-for` est absent. Better Auth lit donc `cf-connecting-ip`, que Cloudflare remplit et qu'un client ne peut pas falsifier (`client-ip-headers.ts`). Sans ce réglage, tous les visiteurs partageaient un seul compteur.
- **Proxy.** Le Worker *est* sur le réseau Cloudflare : la question « proxy orange ou DNS only » du guide de production (§ 8.2) ne se pose plus pour l'application.
- **`after()`** (e-mails et notifications après la réponse) est pris en charge par OpenNext via `waitUntil`.
- **Neon** : le pilote `@neondatabase/serverless` utilise le `WebSocket` natif de Workers. La base n'a encore jamais été contactée (voir le guide de production § 5).
- **`node:crypto`** (Web Push, jetons, hachages) est entièrement disponible avec `nodejs_compat`.
- **Taille** : 22,6 Mio non compressé (4,7 Mio gzip) avec `wrangler deploy --dry-run`, sous la limite de 64 Mio. PGlite (base d'aperçu) est inclus dans le paquet bien qu'inutile en production ; à retirer si le temps de démarrage (1 s maximum) pose problème.
- **Sentry : pas encore opérationnel sur Workers.** Avec `@sentry/nextjs` 10.78, une erreur 500 provoquée dans le Worker local n'est pas arrivée dans Sentry. La méthode prise en charge par Sentry pour OpenNext (envelopper le Worker avec `withSentry` de `@sentry/nextjs/cloudflare`) exige la version **11.6 ou plus** : montée de version majeure, non faite sans accord. En attendant, les erreurs restent visibles dans les journaux Workers (`observability` activé).

## 7. Vérifications

Fait le 2026-11-01 sous Windows (`wrangler dev`, runtime `workerd` local, sans base de données) :

| Contrôle | Résultat |
| --- | --- |
| `npm run cf:build` | Réussi |
| `/`, `/login` | 200 |
| `/business/dashboard`, `/platform` sans session | 307 vers `/login?next=…` |
| `/api/account/me` sans base | 500, message générique |
| Cron sans `CRON_SECRET` | Ignoré, message dans les journaux |
| Crons `0 1` et `0 7` avec un secret de test local | Route atteinte et autorisée (500 faute de base), exécution marquée en échec |
| Appel direct de la route du cron sans jeton | 401 |
| Erreur 500 transmise à Sentry | **Non** (voir § 6) |

À refaire avant la mise en ligne, sous Linux :

1. `npm run cf:build` sans erreur.
2. `npm run cf:preview`, puis vérifier : landing `/`, redirection de `/business/dashboard` vers `/login` sans session, inscription, connexion, une vente.
3. Une erreur serveur volontaire arrive dans Sentry depuis le Worker.
4. Une exécution manuelle de chaque Cron Trigger (Local Explorer : `/cdn-cgi/local/explorer` → *Cron Triggers*).
5. Deux commerces A et B : A ne voit aucune donnée de B.
