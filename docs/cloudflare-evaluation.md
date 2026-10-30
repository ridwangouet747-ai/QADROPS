# Évaluation Cloudflare pour Qadr Ops

Mission 03, rédigée le 2026-10-30. Sources : la documentation officielle Cloudflare, consultée le 2026-10-30 (les pages R2 Pricing et Presigned URLs ont été mises à jour le 2026-10-26, la page Next.js on Workers le 2026-08-25). Les prix et les quotas peuvent changer : vérifiez-les à nouveau avant toute décision financière.

**Aucun service Cloudflare n'a été activé, configuré ou facturé pendant cette mission.**

## Résumé de la recommandation

| Service | Rôle pour Qadr Ops | Recommandation | Coût de départ |
| --- | --- | --- | --- |
| DNS | Zone du domaine commercial | Oui, dès l'achat du domaine | Offre gratuite |
| CDN / proxy | Cache des fichiers statiques Next.js, TLS, réduction de la latence en Afrique de l'Ouest | Oui, devant l'hébergeur actuel. Ne jamais mettre en cache les routes `/api/*` ni les pages authentifiées | Offre gratuite |
| WAF | Règles gérées et limitation de débit sur `/api/auth/*` | Oui, avec les règles gratuites d'abord ; les règles avancées demandent un forfait payant | Gratuit, puis payant selon le besoin |
| Turnstile | Anti-robot à l'inscription et à la connexion | Déjà prévu dans le code (`src/lib/auth/turnstile.ts`, vérification côté serveur). À brancher sur les futurs écrans d'inscription et de connexion | Offre gratuite |
| R2 | Documents de Qadr Capture, logos, reçus PDF | Oui, quand le module d'import existera (voir ci-dessous) | 10 Go-mois gratuits, puis 0,015 $ par Go-mois |
| Workers | Calculs en périphérie, futurs traitements asynchrones | Pas maintenant : aucun besoin identifié | — |
| Hébergement Next.js sur Workers (vinext) | Remplacer l'hébergement actuel | **Non, pas maintenant** (voir ci-dessous) | — |

## R2 pour Qadr Capture

Faits relevés dans la documentation :
- Les buckets sont **privés par défaut**. Ne jamais activer l'URL publique `r2.dev`, que Cloudflare réserve au développement.
- Les **URL présignées** autorisent une seule opération (`GET`, `HEAD`, `PUT` ou `DELETE`) sur un seul objet, pendant une durée de 1 seconde à 7 jours. Elles fonctionnent comme un jeton au porteur : toute personne qui détient l'URL peut agir jusqu'à son expiration.
- Les URL présignées fonctionnent uniquement sur le domaine S3 (`<ACCOUNT_ID>.r2.cloudflarestorage.com`), pas sur un domaine personnalisé.
- Les envois depuis le navigateur exigent une règle CORS sur le bucket.
- Gratuit chaque mois : 10 Go-mois de stockage Standard, 1 million d'opérations de classe A et 10 millions de classe B. Les sorties de données (egress) sont gratuites. Au-delà : 0,015 $ par Go-mois, 4,50 $ par million d'opérations A, 0,36 $ par million d'opérations B. Le stockage Infrequent Access n'a pas de palier gratuit.

Conception proposée, à implémenter avec le module d'import :
1. Le serveur vérifie la session, la permission et le commerce actif, puis crée un enregistrement `import_document` (`business_id`, statut `pending_upload`, type déclaré, taille maximale).
2. Il génère une URL `PUT` présignée de **5 minutes au plus**, avec un `Content-Type` imposé et une clé d'objet préfixée par le commerce : `business/<business_id>/imports/<uuid>`. Le client ne choisit jamais la clé.
3. Après l'envoi, le serveur vérifie l'objet (`HEAD` : taille, type), puis analyse son vrai contenu côté serveur avant tout traitement.
4. Les lectures passent par une URL `GET` présignée de courte durée, générée seulement après un contrôle d'autorisation, et jamais stockée en base.
5. La rétention suit une règle de cycle de vie R2 et une suppression contrôlée, cohérente avec les besoins d'audit.
6. Les clés R2 restent dans des variables d'environnement serveur. Aucune clé ne figure dans `.env.example` avec une valeur réelle.

Dépendance à prévoir le moment venu : un client S3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, ou `aws4fetch`, plus léger). À choisir et vérifier lors de la mission d'import.

## Hébergement Next.js sur Cloudflare Workers (vinext)

Faits relevés : Cloudflare recommande vinext pour faire tourner Next.js sur Workers. vinext est un plugin Vite qui **réimplémente** l'API de Next.js, et la documentation le décrit lui-même comme **en bêta**. Cloudflare conseille de lancer `npx vinext check` et de consulter son tableau de compatibilité avant toute adoption en production. OpenNext reste documenté pour les applications existantes.

Pourquoi ne pas migrer maintenant :
- Qadr Ops dépend de comportements précis de Next.js 16 : Better Auth sur `app/api/auth/[...all]`, 31 route handlers métier, Sentry, `next/font` et le mode prévisualisation PGlite. Une réimplémentation de l'API peut différer subtilement sur les en-têtes, les cookies ou le streaming.
- Le pool Neon (`neon-serverless`, transactions interactives) doit être revalidé dans le runtime Workers.
- Aucun gain métier immédiat : le DNS, le CDN, le WAF, Turnstile et R2 s'utilisent sans changer d'hébergeur.

Conditions préalables à une future décision, toutes à remplir et à documenter :
1. Audit de compatibilité (`vinext check`, lancé dans une branche de test, sans modifier `main`).
2. Vérification des 41 routes : pages et routes API.
3. Tests de Better Auth : inscription, connexion, cookies, organisations, invitations.
4. Tests de toutes les routes API (codes de retour, en-têtes, idempotence).
5. Tests des services métier (Vitest, y compris l'intégration PGlite).
6. Tests de Neon depuis Workers : connexion, transactions, latence.
7. Build et tests de non-régression, puis comparaison des performances avec l'hébergement actuel.
8. Rapport de décision signé par le propriétaire.

## Coûts et risques

- Tant que Qadr Ops reste dans les paliers gratuits de DNS, CDN, Turnstile et R2, le coût est nul. Une fois les paliers dépassés, il devient variable : à surveiller depuis le tableau de bord Cloudflare, avec une alerte de facturation.
- Dépendance au fournisseur : R2 reste compatible avec l'API S3, donc une sortie vers un autre stockage S3 est possible. Turnstile peut être remplacé par un autre CAPTCHA côté serveur.
- Confidentialité : les documents de Qadr Capture restent dans un bucket privé, sans URL publique. Avant d'y stocker des documents réels de commerçants, choisir la juridiction de stockage (indice de localisation, ou juridiction UE si nécessaire).
