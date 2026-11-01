# Répartition des responsabilités : Vercel, Cloudflare, Neon

Décision du propriétaire du 2026-11-01 (mission 11) : **l'application Next.js `apps/web` est hébergée sur Vercel. Cloudflare se place devant elle**, pour les DNS, le pare-feu applicatif (WAF), Turnstile et le stockage de fichiers R2. Cette décision remplace celle du matin même, qui prévoyait Cloudflare Workers via OpenNext (voir § 7).

Rien n'est encore déployé ni configuré sur Vercel ou Cloudflare. Ce document décrit la cible ; chaque élément porte son état réel.

## 1. Principe

Une seule copie de l'application, une seule base. On ne déploie pas deux fois l'application, on n'écrit jamais dans deux bases, et un second hébergeur n'apporte pas de redondance automatique.

| Plateforme | Rôle | Ne fait pas |
| --- | --- | --- |
| **Vercel** | Exécute Next.js : pages, Server Components, routes API, crons, déploiements de prévisualisation, variables d'environnement, retour arrière | Stockage de fichiers clients, DNS |
| **Cloudflare** | DNS du domaine, TLS côté visiteur, WAF et limitation de débit, protection DDoS, Turnstile, stockage R2 privé des documents importés et des exports | Exécution de l'application, cache des pages ou API authentifiées |
| **Neon** | PostgreSQL, **seule source de vérité** des données métier (ventes, stock, paiements, dettes, utilisateurs, abonnements, imports, audit) | — |

## 2. Flux réseau

```
Navigateur ──HTTPS──▶ Cloudflare (DNS, WAF, rate limiting) ──HTTPS──▶ Vercel (Next.js, Node.js 24)
                                                                       │
                                     ┌─────────────────────────────────┼──────────────────────┐
                                     ▼                                 ▼                      ▼
                              Neon PostgreSQL                 R2 (API S3, URL signées)   Resend, Sentry,
                              (pool + transactions)           documents privés          PostHog, services push
```

- **Proxy Cloudflare (nuage orange) devant Vercel** : Vercel le déconseille, car il masque l'adresse du visiteur et double le cache. Deux options, à trancher au moment de relier le domaine (décision D-04) :
  1. **DNS seul (nuage gris)** : Vercel gère TLS et son propre pare-feu ; Cloudflare ne sert que pour les DNS, Turnstile et R2. C'est le plus simple.
  2. **Proxy activé** : il faut alors faire confiance à `cf-connecting-ip`, désactiver le cache Cloudflare sur tout sauf `/_next/static/*`, et refuser le trafic qui n'arrive pas par Cloudflare. Plus de protection, mais aussi plus de configuration à maintenir.
- **Adresse IP du visiteur** : `src/lib/auth/client-ip-headers.ts` lit `cf-connecting-ip` puis `x-forwarded-for`. Elle est utilisée par la limitation de débit de Better Auth. Avec l'option 1, c'est `x-forwarded-for` (fourni par Vercel) qui s'applique.

## 3. Cache

- Ne jamais mettre en cache public une réponse authentifiée ni une route `/api/*`.
- Cache long réservé aux fichiers versionnés `/_next/static/*` et aux icônes.
- `/sw.js` (service worker) : `Cache-Control: no-cache`, pour qu'une mise à jour soit vue tout de suite.

## 4. Stockage des fichiers (Qadr Capture, exports)

- Cible : un **bucket R2 privé**, accès uniquement par URL signée de courte durée, générée côté serveur après vérification du commerce et de la permission. Les clés d'objet sont préfixées par le commerce (`business/<businessId>/…`), mais l'autorisation repose sur la base, pas sur le préfixe.
- La base garde les métadonnées (commerce, type réel, taille, empreinte, statut, date d'expiration). Le fichier n'est jamais servi directement par Vercel.
- Les corps de requête Vercel sont limités à 4,5 Mo : les photos et PDF sont donc envoyés **directement du navigateur vers R2** avec une URL signée d'envoi.
- État : **non implémenté**. Aucun bucket ni clé n'existe. Coût R2 à vérifier sur la page officielle avant création (offre gratuite limitée, pas de frais de sortie).

## 5. Traitements asynchrones

- Pas de nouvelle infrastructure tant qu'elle n'est pas nécessaire : une **table de tâches dans Neon** (par commerce, avec statut, essais et verrou `FOR UPDATE SKIP LOCKED`), traitée par les routes cron et par `after()`.
- Vercel Queues ou Cloudflare Queues ne seront évaluées que si le volume le justifie, mesures à l'appui (décision D-05).
- Les modèles lourds (lecture du manuscrit) ne tournent pas dans une fonction Vercel. Ils passent par un fournisseur externe, derrière un adaptateur et désactivé par défaut (D-03).

## 6. Secrets et environnements

- Secrets dans les variables d'environnement Vercel (Production, Preview, Development distincts). Liste complète : `docs/production-setup-guide.md` § 3.
- **Les déploiements de prévisualisation ne doivent jamais pointer vers la base de production** : une branche Neon dédiée pour Preview.
- Crons Vercel : `apps/web/vercel.json` (`0 1 * * *` abonnements, `0 7 * * *` notifications), appel avec `Authorization: Bearer <CRON_SECRET>`, vérifié en temps constant (`src/lib/cron-auth.ts`).

## 7. Préparation Cloudflare Workers mise de côté

Les fichiers `apps/web/wrangler.jsonc`, `open-next.config.ts`, `cloudflare/worker.ts` et les scripts `cf:*` sont **conservés mais inutilisés**. Ils ne sont pas supprimés sans accord. Ce que cette préparation a appris reste utile : `docs/cloudflare-deployment.md`.

Points à retirer ou garder, décision du propriétaire (D-06) : la dépendance `@opennextjs/cloudflare` remonte 4 alertes `npm audit` de gravité élevée (via `glob`, outillage de build uniquement).

## 8. Points à vérifier avant mise en ligne

| Élément | État |
| --- | --- |
| DNS et HTTPS du domaine | Non fait (aucun domaine relié) |
| `BETTER_AUTH_URL` = domaine public en HTTPS | Contrôlé par `env.ts` en production |
| Cookies `Secure`, `HttpOnly`, `SameSite=Lax` | Valeurs par défaut de Better Auth, non observées en production |
| En-têtes de sécurité (CSP, HSTS, frame-ancestors) | **Absents**, à ajouter (mission 11, phase 1) |
| Région Vercel proche de la région Neon | À choisir à la création des deux projets |
| Pool Neon sur Vercel (Fluid Compute) | À adapter (voir `docs/engineering/mission-11-plan.md`, constat A-1) |
| Webhooks entrants | Aucun pour l'instant |
| CORS | Aucune route n'a besoin d'être appelée depuis une autre origine |
