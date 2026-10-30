# QADR OPS — fondation web

Cette application Next.js est un nouveau socle isolé dans `apps/web`. Le MVP historique à la racine du dépôt et son stockage JSON ne sont pas remplacés par cette application. Aucun import de données n'est prévu ici. La documentation d'architecture partagée se trouve dans `../../docs/`.

**Toutes les commandes de ce fichier se lancent depuis `apps/web`.** Les migrations Drizzle sont dans `apps/web/drizzle/` : le code les cherche dans `<dossier courant>/drizzle`.

## Démarrer en local

Prérequis : Node.js 24.x (champ `engines` du `package.json`). Dans un terminal, depuis `apps/web` :

```powershell
npm ci
npm run dev
```

`npm ci` installe exactement les versions du `package-lock.json` sans le modifier. N'utilisez `npm install` que pour changer volontairement une dépendance.

Ouvrir `http://localhost:3000`. La page d'accueil n'a besoin d'aucun compte externe ni base de données. Better Auth répondra `503 AUTH_CONFIGURATION_REQUIRED` tant que sa base PostgreSQL et son secret n'ont pas été configurés. Pour utiliser les intégrations, copier `.env.example` vers `.env.local`, puis fournir les variables depuis des sources de confiance. Ne jamais committer `.env.local`.

### Prévisualiser le logiciel commercial

Depuis `apps/web`, lancer `npm run preview` puis ouvrir `http://localhost:3001/business/dashboard` (ou `/business/pos`, `/business/products`, `/business/sales`, `/business/inventory`, `/business/reports` et les autres modules). Cette commande active explicitement un mode de démonstration local : elle retire `DATABASE_URL` du processus, applique les migrations à PGlite en mémoire et charge des données synthétiques. Les modifications faites pendant la visite sont réelles dans cette instance mais disparaissent à l'arrêt du serveur. Si le port 3001 est déjà pris, lancer `$env:PORT='3002'; npm run preview` et ouvrir le même chemin sur le port 3002. Le mode preview utilise `.next-preview` afin de ne pas prendre le verrou d'un autre serveur Next lancé dans ce projet.

Ce mode n'est pas une authentification et ne doit pas être exposé publiquement : il est accepté uniquement par le serveur de développement, et ses données sont fictives.

Commandes de qualité : `npm test`, `npm run lint`, `npm run typecheck`, puis `npm run build`. Ces vérifications locales ne requièrent pas de base ou compte Sentry/PostHog/Cloudflare. `npm run typecheck` lance d'abord `next typegen`, qui génère les types de routes (`RouteContext`) indispensables à `tsc` sur une copie fraîche. Pour vérifier que le schéma et les migrations concordent sans contacter de base : `npx drizzle-kit check`, puis `npx drizzle-kit generate`, qui doit répondre « No schema changes ».

Les tests Vitest utilisent PGlite en mémoire. Leur réussite ne prouve ni la connexion à Neon, ni le comportement de plusieurs connexions PostgreSQL simultanées.

`next.config.ts` exclut `@electric-sql/pglite` de l'empaquetage serveur (`serverExternalPackages`). Sans ce réglage, webpack casse le chargement des fichiers WASM de PGlite et toutes les routes du mode preview répondent 500 (`Received an instance of URL`), ce qui était le cas avant le 2026-10-30.

## Intégrité des opérations

**Clé d'opération (idempotence).** Les ventes (`POST /api/business/sales`), les achats reçus (`POST /api/business/purchases`), les dépenses (`POST /api/business/expenses`) et les règlements de créance (`POST /api/business/customers/payments`) exigent un champ `idempotencyKey` dans le corps JSON : 8 à 128 caractères parmi `A-Z a-z 0-9 : _ -`, en pratique un UUID généré par le client.
- Le client conserve la même clé tant qu'il renvoie la même opération, après une coupure réseau ou une réponse perdue. Voir `src/lib/client/operation-key.ts`.
- Le serveur renvoie alors le résultat de la première exécution avec `"replayed": true`, sans rien réécrire.
- La même clé avec un contenu différent est refusée (409). Une clé absente ou mal formée est refusée (400).
- Les clés sont isolées par commerce : la même clé dans un autre commerce est une autre opération.
- Pour les achats, les dépenses et les règlements, le résultat est conservé dans la table `idempotency_record` (migration `0007`), écrite dans la même transaction que l'opération. Les ventes conservent leur mécanisme d'origine (clé unique sur `sale`).
- La permission est vérifiée avant tout rejeu : un membre qui a perdu ses droits ne peut pas relire un résultat.

**Commerce suspendu ou expiré.** Toute écriture commerciale passe par `assertBusinessOperational` (`src/lib/domain/operation-guard.ts`), exécutée dans la transaction avec un verrou `FOR SHARE` sur le profil du commerce. Elle répond 403 quand :
- le profil est `suspended` ou `expired` ;
- le commerce a déjà eu un abonnement en vigueur et n'en a plus aucun `active` dont la fin est dans le futur.

Les lectures restent autorisées. Le rejeu d'une opération déjà enregistrée avant la suspension reste servi, puisqu'elle a bien eu lieu.

**Politique non tranchée :** un commerce sans abonnement, ou dont le seul abonnement est `pending`, n'est pas bloqué. L'application d'un code promo laisse l'abonnement `pending` : le bloquer empêcherait toute activation.

## Stack de référence vérifiée

Les versions sont épinglées dans `package.json`; elles ont été vérifiées comme versions stables disponibles dans les sources éditeur/registre au moment de la fondation. Une mise à jour doit être accompagnée d'un contrôle de compatibilité, du lockfile et des tests.

- Next.js 16.4.2, React 19.3.1, TypeScript 5.9.3.
- Better Auth 1.7.7 avec son adaptateur Drizzle intégré.
- Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, driver Neon Serverless 1.2.0.
- Sentry Next.js SDK 10.73.0, PostHog JS 1.438.2, Zod 4.1.12.

Références officielles : [Next.js instrumentation](https://nextjs.org/docs/app/guides/instrumentation), [Next.js instrumentation-client](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client), [Better Auth installation](https://better-auth.com/docs/installation), [Better Auth + Next.js](https://better-auth.com/docs/integrations/next), [Better Auth Drizzle](https://better-auth.com/docs/adapters/drizzle), [Drizzle + Neon](https://orm.drizzle.team/docs/connect-neon), [Sentry Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/), [PostHog Next.js](https://posthog.com/docs/libraries/next-js), [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/), [Vercel domains](https://vercel.com/docs/domains/set-up-custom-domain), [Vercel Firewall](https://vercel.com/docs/vercel-firewall).

## Authentification et base

Le parcours préparé est e-mail + mot de passe. Le modèle Drizzle actuel ne couvre que les tables Better Auth (`user`, `session`, `account`, `verification`), sans entreprises, memberships, permissions, produits ni ventes. La vérification d'e-mail et la réinitialisation de mot de passe ne sont pas activées : il faut choisir/configurer un expéditeur transactionnel et tester les liens avant d'activer ces flux ou d'ouvrir l'inscription en production. Le schéma est préparatoire ; aucun compte n'a été créé et aucune migration n'a été appliquée.

Le nouveau schéma inclut maintenant les tables Better Auth Organization et le domaine commercial. Il est appliqué automatiquement à la base PGlite en mémoire du mode preview, mais aucune base Neon distante n'a été ciblée. La validation d'authentification réelle exige `DATABASE_URL` et un `BETTER_AUTH_SECRET` aléatoire d'au moins 32 caractères. L'URL doit pointer explicitement vers une base de développement isolée. Ne pas utiliser une URL de production pour générer ou appliquer une migration. Les routes d'authentification Better Auth existent, mais les pages de connexion, d'inscription et de sélection de commerce restent à construire.

- Connexion en lecture seule : `npm run db:check` exécute seulement `SELECT 1`.
- Générer un fichier de migration local : `npm run db:generate` (n'écrit pas dans la base).
- Appliquer les migrations : dans PowerShell, définir `$env:QADR_DB_TARGET = "development"`, vérifier indépendamment la cible, puis lancer `npm run db:migrate` ; le script exige aussi de saisir la phrase de confirmation affichée. Cette commande écrit dans la base. Elle n'a pas été exécutée durant cette mission.

Utiliser des environnements et bases distincts pour développement, preview et production, des sauvegardes vérifiées et un plan de restauration avant tout changement. Le prompt de migration confirme une cible déclarée, mais ne prouve pas que l'opérateur a choisi le bon projet Neon : vérifier le nom de projet, branche et base dans Neon avant confirmation.

## Sentry

L'intégration SDK est préparée pour le navigateur, Node.js et Edge via `instrumentation-client.ts`, `instrumentation.ts`, `sentry.server.config.ts` et `sentry.edge.config.ts`. Elle est désactivée si le DSN correspondant est absent. `sendDefaultPii` est désactivé, les transactions, breadcrumbs, utilisateur, requête, extra, tags et contextes sont supprimés des erreurs capturées et le message d'exception est remplacé par un libellé générique. Ne pas ajouter de payload métier aux messages, tags, breadcrumbs ou contextes.

Configurer des DSN/projets séparés pour le développement, la preview et la production via les environnements locaux et Vercel. Garder `SENTRY_ENVIRONMENT` cohérent. Aucun projet/DSN n'est fourni dans ce dépôt ; le code n'est donc pas déclaré opérationnel ni confirmé comme ayant envoyé un événement.

Test contrôlé : dans une instance locale de développement seulement, définir `SENTRY_DSN` et `SENTRY_TEST_ENABLED=true`, démarrer Next, puis envoyer `POST http://localhost:3000/api/observability/sentry-test`. Le point de contrôle est désactivé/404 hors développement, refuse le test sans DSN, et envoie uniquement une erreur synthétique « QADR OPS Sentry setup test ». Vérifier l'événement dans le projet Sentry de développement. Ne pas tester avec données client.

## PostHog

Le SDK n'est initialisé que lorsque `NEXT_PUBLIC_POSTHOG_KEY` et `NEXT_PUBLIC_POSTHOG_HOST` sont présents. Autocapture, pageview automatique, pageleave et enregistrement de session sont désactivés ; la persistance est en mémoire. Les helpers n'acceptent que ces événements sans propriétés métier : `saas_signup_completed`, `first_product_created`, `first_sale_recorded`, ainsi que `feature_used` avec une catégorie limitée (`inventory`, `sales`, `reports`, `team`). L'identification attend un identifiant interne opaque et stable, jamais un e-mail ou téléphone. `signOutAndResetAnalytics()` efface l'identité après déconnexion.

Ne jamais envoyer les montants, clients, produits individualisés, reçus, coordonnées, détails de paiement ou informations d'authentification. Aucun projet PostHog n'est configuré ici. Pour tester après configuration, contrôler les appels réseau et l'événement reçu dans le projet de développement ; vérifier qu'aucune propriété interdite n'est présente. En absence des variables, aucune capture n'est initialisée.

## Cloudflare avec Vercel

- DNS : configurer le domaine dans Vercel puis créer uniquement les enregistrements indiqués par le projet Vercel. Si Cloudflare héberge le DNS, commencer avec le proxy Cloudflare désactivé (DNS-only) pour établir domaine et TLS ; ne passer au proxy/WAF Cloudflare qu'après validation, en vérifiant les éventuels conflits de proxy avec Vercel. Aucun domaine n'est configuré et aucun enregistrement DNS n'a été modifié.
- Protection web : Vercel Firewall est le point de contrôle initial pour une application hébergée sur Vercel. Cloudflare WAF/proxy peut être évalué pour un besoin concret, mais éviter le double proxy ou des règles contradictoires ; tester cache, TLS, headers, IP source, callbacks et limites de débit dans un domaine de préproduction. Aucun Worker/règle/WAF n'est déployé ici.
- Turnstile : les routes Better Auth de création de compte et de connexion vérifient le jeton auprès de `siteverify` côté serveur. En production, une configuration incomplète ou un échec réseau refuse l'opération. En développement, l'absence simultanée des deux clés désactive le challenge afin que l'application reste testable ; dès qu'une clé est fournie, les deux deviennent obligatoires. Les pages/formulaires de connexion et le widget restent à construire ; tout formulaire futur doit obtenir un token et l'envoyer dans `turnstileToken`. Les jetons sont à usage unique et temporaires. Tester les succès, jetons invalides/expirés, réponses Cloudflare non disponibles et configuration absente.
- R2 : non intégré. À envisager uniquement avec un module réel d'import de logo/document, en utilisant un bucket privé, des URL signées de durée courte, limites de taille/type côté serveur, vérification du contenu réel et règles de suppression/rétention. Aucune clé ou bucket R2 n'est requis maintenant.

## Limites actuelles

Le logiciel commercial et ses opérations sont utilisables dans la prévisualisation PGlite locale. Les routes d'API appliquent le contexte d'organisation Better Auth et les permissions métier côté serveur ; les intégrations Neon, les pages de connexion/inscription, la sélection d'entreprise et la gestion d'équipe ne sont pas encore validées de bout en bout. Les paiements numériques sont enregistrés en attente et nécessitent une confirmation manuelle explicite ; aucun fournisseur de paiement n'est connecté. Les pages d'impression utilisent l'impression du navigateur ; aucune imprimante physique n'a été testée. Aucun compte Cloudflare/Vercel/Neon/PostHog/Sentry ni domaine n'est présumé. Aucune base distante n'a été contactée, aucune migration distante n'a été appliquée, aucun Worker/DNS/déploiement public n'a été effectué.

Dans le rapport de mission, distinguer :

1. **Code intégré** : fichiers et configuration présents dans ce répertoire.
2. **Service configuré** : variables et projet réels présents dans l'environnement ciblé.
3. **Fonctionnement vérifié** : test réalisé dans cet environnement et résultat observé.

Les deux derniers points ne sont pas acquis par la seule présence du code.
