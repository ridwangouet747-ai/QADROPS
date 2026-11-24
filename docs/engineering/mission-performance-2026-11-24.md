# Mission optimisation intégrale (2026-11-24)

> Rapport de l'agent. Toute valeur citée a été mesurée par un script nommé ici ; ce qui ne l'a pas été est dit comme
> tel. Branche `perf/ultimate-performance-optimization`, PR ridwangouet747-ai/QADROPS#2. **Aucune migration.**
> Les essais métier ont été faits sur la Preview de la branche, branchée sur la base de **test** `qadr_staging`
> (branche Neon `mission-14-staging`), jamais sur la base de production.

## A. Ce qui a changé

| Domaine | Changement | Fichiers principaux |
| --- | --- | --- |
| Mesure d'audience | **PostHog retiré** : paquet, catalogue d'événements, bandeau de consentement, appels `track()`, variables, hôtes CSP, mentions de confidentialité | `package.json`, `lib/security-headers.ts`, `docs/analytics.md`, `docs/privacy/` |
| Erreurs du navigateur | **Sentry chargé à la première erreur seulement** ; mêmes règles de nettoyage (`beforeSend`), sans intégrations par défaut | `instrumentation-client.ts`, `lib/observability/client-errors.ts`, `browser-sentry.ts` |
| Espace commerçant | **Mise en page persistante** `app/business/layout.tsx` + `BusinessFrame` : l'en-tête n'est plus remonté à chaque page ; session et appartenance lues une fois par requête | `app/business/layout.tsx`, `components/business/business-frame.tsx`, `lib/domain/business-page-access.ts` |
| Données à l'écran | **Cache en mémoire de l'onglet**, isolé par `compte:commerce` (voir § D) | `lib/client/data-cache.ts` |
| Caisse | grille mémorisée, catalogue rechargé en arrière-plan après une vente | `components/business/pos-workspace.tsx` |
| Divers | formateurs `Intl` mis en cache ; GSAP de la page publique chargé après inactivité et selon l'appareil | `lib/i18n/format.ts`, `components/landing/` |

Aucune fonction métier n'a été retirée : prix, abonnements, codes, liens WhatsApp, paiements et règles d'accès sont
inchangés.

## B. Méthode de mesure

- **Navigateur** : `preview-bench.mjs` (Chromium piloté par puppeteer-core, téléphone 360 × 740, processeur ralenti
  ×4, contexte vierge à chaque passage, profils « sans limite » et « 3G lente » 400 ms / 400 kbit/s). Médiane de
  3 passages. Avec 3 passages, un **p95 n'a pas de sens** : l'étendue (min–max) est donnée à la place.
- **Avant / après dans les mêmes conditions** : le build d'avant (`b504be8`, celui de la production) puis le build
  d'après (`9f5d74b`) ont été servis l'un après l'autre par **le même alias** de Preview, même région (`iad1`), même
  base de test, même commerce de test, même poste, le même jour.
- **Serveur** : temps d'attente de la réponse de vente (`receiveHeadersEnd − sendEnd`) et TTFB.
- **Base** : `neon-cold.mjs` (§ F).
- Les scripts cités (`preview-bench.mjs`, `ab-pages.mjs`, `ab-nav.mjs`, `ab-sale.mjs`, `cache-scenarios.mjs`,
  `neon-cold.mjs`, `prod-sentry-check.mjs`) sont des outils de mesure de l'agent, **hors dépôt** : ils lisent des
  identifiants de test privés et ne sont pas versionnés.

## C. Mesures avant / après

### C.1 Navigateur, chargement direct de chaque page (banc complet, 3 passages)

`preview-bench.mjs` (`preview-ultimate-avant.json`, `preview-ultimate-apres2.json`) ; `/business/opening` mesurée
sur les URL immuables des deux déploiements. TTFB = premier octet du HTML (serveur Vercel iad1 + réseau du poste).

| Page | Profil | LCP avant (méd. ; min–max) | LCP après (méd. ; min–max) | JS avant → après | Transfert avant → après | TTFB avant → après | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing `/` | sans limite | 1 752 ms ; 1 672–3 864 | 1 704 ms ; 1 612–3 348 | 434 → 399 Ko | 653 → 616 Ko | 119 → 122 ms | 0 → 0 |
| Landing `/` | 3G lente | 6 752 ms ; 5 980–6 776 | 6 848 ms ; 6 164–6 972 | 436 → 400 Ko | 653 → 617 Ko | 123 → 125 ms | 0 → 0 |
| Connexion `/login` | sans limite | 1 244 ms ; 1 128–1 304 | 1 300 ms ; 1 088–2 136 | 210 → 177 Ko | 332 → 299 Ko | 122 → 122 ms | 0 → 0 |
| Connexion `/login` | 3G lente | 5 120 ms ; 3 988–5 132 | 4 200 ms ; 4 064–5 324 | 210 → 178 Ko | 332 → 299 Ko | 121 → 121 ms | 0 → 0 |
| Administration `/platform/login` | sans limite | 1 000 ms ; 972–1 004 | 1 116 ms ; 992–1 128 | 195 → 160 Ko | 309 → 273 Ko | 121 → 124 ms | 0 → 0 |
| Administration `/platform/login` | 3G lente | 4 884 ms ; 3 832–4 904 | 4 832 ms ; 4 008–4 988 | 195 → 160 Ko | 308 → 272 Ko | 123 → 127 ms | 0 → 0 |
| Tableau de bord | sans limite | 2 176 ms ; 1 564–2 420 | 2 396 ms ; 2 288–2 608 | 262 → 235 Ko | 385 → 358 Ko | 142 → 123 ms | 0 → 0 |
| Tableau de bord | 3G lente | 4 416 ms ; 4 116–4 876 | 4 736 ms ; 4 484–4 736 | 263 → 235 Ko | 385 → 358 Ko | 138 → 119 ms | 0 → 0 |
| Produits | sans limite | 1 376 ms ; 1 308–2 124 | 1 324 ms ; 1 316–1 652 | 262 → 235 Ko | 386 → 358 Ko | 120 → 119 ms | 0 → 0 |
| Produits | 3G lente | 4 380 ms ; 4 272–4 972 | 4 276 ms ; 4 220–4 756 | 263 → 235 Ko | 386 → 358 Ko | 130 → 120 ms | 0 → 0 |
| Ventes | sans limite | 1 328 ms ; 1 176–2 072 | 1 352 ms ; 1 148–1 532 | 263 → 235 Ko | 386 → 358 Ko | 128 → 121 ms | 0,025 → 0,025 |
| Ventes | 3G lente | 4 132 ms ; 4 104–4 896 | 4 244 ms ; 4 176–4 736 | 263 → 235 Ko | 386 → 358 Ko | 121 → 125 ms | 0,025 → 0,025 |
| Clients (soldes à crédit) | sans limite | 1 772 ms ; 1 192–2 280 | 1 328 ms ; 1 140–1 372 | 263 → 235 Ko | 385 → 357 Ko | 120 → 122 ms | 0 → 0 |
| Clients (soldes à crédit) | 3G lente | 4 560 ms ; 4 196–4 756 | 5 004 ms ; 4 172–6 224 | 263 → 235 Ko | 384 → 356 Ko | 119 → 125 ms | 0 → 0 |
| Dettes de départ `/business/opening` | sans limite | 1 784 ms ; 1 440–4 440 | 2 272 ms ; 1 928–3 820 | 214 → 187 Ko | 336 → 310 Ko | 121 → 120 ms | 0 → 0 |
| Dettes de départ `/business/opening` | 3G lente | 4 340 ms ; 4 248–5 280 | 4 996 ms ; 4 484–5 020 | 214 → 187 Ko | 337 → 310 Ko | 120 → 119 ms | 0 → 0 |
| Rapports | sans limite | 3 576 ms ; 3 308–4 316 | 4 660 ms ; 4 204–5 060 | 213 → 186 Ko | 336 → 309 Ko | 120 → 118 ms | **0,463 → 0,463** |
| Rapports | 3G lente | 10 140 ms ; 9 960–10 524 | 9 432 ms ; 9 152–11 432 | 213 → 186 Ko | 337 → 309 Ko | 121 → 119 ms | **0,463 → 0,463** |

Avec 3 passages, les écarts de LCP des pages connectées (± 500 ms) restent dans l'étendue. Les quatre pages où la
médiane monte (tableau de bord, clients en 3G, dettes de départ, rapports) ont été remesurées en **A/B entrelacé sur
7 passages** (`ab-pages.mjs`, sans limite, processeur ×4) :

| Page | LCP avant (méd. ; min–max) | LCP après (méd. ; min–max) | Requête de données : fin, avant → après (méd.) |
| --- | --- | --- | --- |
| Tableau de bord | 1 696 ms ; 1 388–5 208 | 1 632 ms ; 1 460–3 236 | 6 287 → 6 082 ms |
| Dettes de départ | 1 988 ms ; 1 588–4 808 | 1 716 ms ; 1 512–3 780 | — |
| Clients | 2 056 ms ; 1 680–3 680 | 2 560 ms ; 1 992–3 844 | 5 240 → 5 377 ms |
| Rapports | 7 112 ms ; 6 616–9 780 | 6 788 ms ; 5 500–9 392 | 6 115 → 5 774 ms |

Conclusion honnête : **au premier chargement d'une page, pas de gain établi sur le LCP** ; le gain est sur le poids
(JS −27 à −35 Ko gzip sur chaque page, −8 à −18 %). Aucune régression démontrée : la seule médiane en hausse sur
7 passages (Clients, +500 ms) a des étendues qui se recouvrent et une requête de données au même instant (+137 ms).
Le LCP de ces pages est le titre de la page : **les chiffres eux-mêmes n'arrivent que vers 5 à 6 s** sur ce téléphone
simulé, car la requête de données ne part qu'après l'exécution du JavaScript (≈ 4,5 s à processeur ×4), avant comme
après (§ G).

### C.2 Navigateur, navigation interne (clic sur un lien de l'en-tête → écran rempli)

`ab-nav.mjs`, 5 parcours entrelacés par build (produits → ventes → tableau de bord → produits → clients → tableau de
bord), sans limite, processeur ×4. C'est le gain de la mise en page persistante et du cache.

| Clic | Avant (méd. ; min–max) | Après (méd. ; min–max) |
| --- | --- | --- |
| → Produits (1re visite) | 3 043 ms ; 1 900–4 095 | 2 856 ms ; 2 334–3 110 |
| → Ventes (1re visite) | 1 296 ms ; 1 152–1 567 | 1 042 ms ; 991–1 149 |
| → Tableau de bord (déjà vu) | 1 983 ms ; 1 346–2 341 | 1 290 ms ; 1 167–1 456 |
| → Produits (déjà vu) | 1 701 ms ; 1 599–1 801 | 1 305 ms ; 1 080–1 469 |
| → Clients (1re visite) | 1 142 ms ; 1 037–3 396 | 873 ms ; 835–897 |
| → Tableau de bord (déjà vu) | 1 269 ms ; 1 246–1 425 | 963 ms ; 805–1 141 |
| **Les 30 clics** | **1 599 ms** ; p90 3 043 ; p95 3 767 ms | **1 149 ms** (−28 %) ; p90 2 705 ; p95 3 012 ms |

Appels d'API par navigation interne (`nav-calls.mjs`) : 3 avant (`/api/account/me`, compteur de notifications, données
de la page), **1 après** (les données de la page seulement).

### C.3 Caisse (banc complet, 3 passages par profil)

| Mesure | Profil | Avant (méd. ; min–max) | Après (méd. ; min–max) |
| --- | --- | --- | --- |
| Recherche « vis 20 » → résultat | sans limite | 1 445 ms ; 1 334–1 502 | **1 130 ms** ; 1 044–1 179 |
| Recherche « vis 20 » → résultat | 3G lente | 1 416 ms ; 1 367–1 533 | **1 065 ms** ; 1 060–1 093 |
| Pire frappe (INP approché) | sans limite | 256 ms ; 240–256 | 240 ms ; 216–272 |
| Pire frappe (INP approché) | 3G lente | 256 ms ; 256–264 | 248 ms ; 240–248 |
| Encaissement : clic → « Vente enregistrée » | sans limite | 517 ms ; 485–629 | 1 447 ms ; 481–1 495 |
| Encaissement : clic → « Vente enregistrée » | 3G lente | 654 ms ; 623–1 761 | 618 ms ; 616–642 |

L'encaissement « après » sans limite a eu 2 passages sur 3 à ≈ 1,3 s d'attente **serveur** (le navigateur n'y est
pour rien). Vérification par **appels directs entrelacés**, 10 ventes par build (`ab-sale.mjs`, envoi → réponse,
depuis le poste) : **avant 404 ms** (p90 2 017 ms, une vente lente), **après 406 ms** (p90 423 ms). Pas de régression
serveur ; ces pics isolés (≈ 1,3 à 2 s) existent des deux côtés (§ F, § G).

Vente interrompue (réponse coupée au retour) : message affiché, nouvelle tentative **non rejouée**, stock décrémenté
une seule fois (117 → 116 → 116). Navigation hors ligne : bandeau ou page hors ligne affichés.

## D. Cache et navigation : aucune donnée ancienne ni d'un autre commerce

Règles (`lib/client/data-cache.ts`, 11 tests unitaires) :

1. chaque entrée porte la portée `compte:commerce` posée par la mise en page commerçant ; une autre portée vide tout ;
2. **toute écriture vers `/api`** (vente, produit, stock, réglages, compte…) vide tout au départ et à l'arrivée,
   quelle que soit la réponse (une vente sans réponse a peut-être été enregistrée) ;
3. un refus **401 ou 403** vide tout et **révoque** la portée de l'onglet ; tout autre refus n'oublie que l'entrée ;
4. connexion, choix du commerce et déconnexion le disent aux **autres onglets** (`BroadcastChannel`), qui révoquent
   leur portée ;
5. rien n'est écrit sur le disque (ni `localStorage`, ni IndexedDB, ni service worker).

Essais dans un vrai navigateur sur la Preview (`cache-scenarios.mjs`) : navigation par les liens de l'en-tête, et
réponse de l'API **retenue 3 s** au retour sur l'écran, pour laisser au cache l'occasion de montrer ce qu'il garde.
Un échantillonneur relève toutes les 30 ms tout texte interdit (noms de produits, nom de commerce) affiché.

| Scénario | Résultat | Preuve relevée |
| --- | --- | --- |
| Témoin : retour au tableau de bord sans écriture | **cache servi** (0 squelette pendant la retenue) | montre que les essais suivants peuvent échouer |
| 1. Vente (écran de caisse) puis retour au tableau de bord | **conforme** | vente 201 ; pendant la retenue, squelettes et non l'ancien affichage ; ventes du jour 20 → 21 après la réponse |
| 2. Modification d'un produit puis retour à la liste | **conforme** | PATCH 200 ; ancien nom jamais affiché ; nouveau nom affiché après la réponse ; nom d'origine restauré |
| 3. Modification du stock (réception d'achat) | **conforme** | achat 201 ; stock 118 → 123 ; ancienne liste jamais affichée |
| 4. Changement de commerce A1 → A2, onglet actif **et second onglet resté sur A1** | **conforme** | aucun produit de A1 affiché dans aucun des deux onglets |
| 5. Déconnexion (bouton de l'en-tête) puis connexion avec un autre compte | **conforme** | session A refusée (401) après déconnexion ; aucune donnée ni nom de commerce de A chez B |
| 6. Expiration de session (session fermée côté serveur, écran ouvert) | **conforme** | retour à `/login` ; aucune donnée affichée ; API 401 |

Deux défauts trouvés pendant cette vérification ont été corrigés avant mesure (commit `9f5d74b`) : un retour sur un
écran juste après une écriture pouvait montrer un instant les anciens chiffres ; un second onglet gardait son cache
après un changement de commerce ou de compte fait ailleurs.

Limites : Turnstile protège l'écran de connexion de la Preview et n'est jamais contourné : la **saisie** des
identifiants n'a donc pas été automatisée ; les sessions des comptes de test ont été ouvertes côté serveur (même
route Better Auth) puis posées dans le navigateur. Une donnée modifiée **depuis un autre appareil** peut s'afficher
depuis le cache jusqu'à ce que la réponse en cours arrive (une fraction de seconde en temps normal) : le serveur
reste la référence et chaque visite le réinterroge.

## E. PostHog et Sentry

**PostHog** (vérifié le 2026-11-24 sur `9f5d74b`) :

- 0 occurrence de « posthog » dans `apps/web/package.json`, `apps/web/package-lock.json` et `apps/web/src` ;
  `node_modules/posthog-js` absent ;
- dépendances qu'il amenait, absentes du lockfile : `posthog-js`, `@posthog/core`, `web-vitals`, `preact`,
  `dompurify`, `core-js`. `fflate` reste, mais pour `read-excel-file` (import XLSX) et `@types/three`, pas pour PostHog ;
- 0 requête vers un hôte PostHog dans tous les passages du banc (les hôtes ne sont plus dans la CSP) ;
- fonctions métier non touchées : les 6 scénarios du § D, la vente, la vente interrompue et la navigation hors ligne
  passent, et la suite Vitest complète (isolation multi-commerce comprise) passe en CI.

**Sentry du navigateur** : le SDK (≈ 31 Ko gzip, fragments `6921`/`7999` du build) n'est **plus dans le JavaScript
commun** (132 Ko gzip au lieu de 163). Il est téléchargé à la première erreur non rattrapée ou promesse rejetée
(`listenForClientErrors`), ou à une erreur affichée par `global-error.tsx` ; les erreurs survenues pendant le
téléchargement sont gardées (20 au plus) puis envoyées dans l'ordre. Les règles d'envoi sont inchangées : aucune
donnée personnelle, ni message ni contexte, seuls le type et la pile partent. Tests : `client-errors.test.ts`.
Le DSN n'existe qu'en production : le chargement à la demande et l'envoi sont vérifiés en production (§ H).
**Sentry du serveur** inchangé (`sentry.server.config.ts`, `errorResponse` → `captureException` pour toute 500).

## F. Base Neon : calculateur de 0,25 CU et mise en veille

Constat (lecture seule, 2026-11-24) : la production (`main`, `ep-rough-bird-bc9xzcbh`) et le staging
(`ep-rough-math-bcky2nij`) ont un calculateur **fixe de 0,25 CU** (min = max, pas d'autoscaling) et la mise en veille
par défaut (**5 min** sans requête). La production était en veille au moment du relevé (dernière activité 16:28 UTC,
mise en veille 16:34 UTC) : avec le trafic actuel, la plupart des premières visites trouvent la base endormie.

Mesures sur **staging** (même configuration ; la production n'a pas été sollicitée), `neon-cold.mjs` :

| Mesure | Après ≥ 5 min de calme | Ensuite (à chaud) | Surcoût |
| --- | --- | --- | --- |
| Fonction Vercel froide (même route, sans session, sans base) | 2 750 ms puis 682 ms | — | ≈ 2 s sur la 1re requête (démarrage de la fonction, en partie la connexion TLS du poste) |
| Lecture du tableau de bord (fonction iad1 → Neon), fonction déjà chaude | **1 319 ms** | **315–366 ms** (méd. 321) | **≈ +1 s : réveil de la base** |
| Base seule depuis le poste (`select count(*) from product`) | **2 745 ms** | 177–303 ms (méd. 194) | ≈ +2,5 s, dont l'ouverture de la connexion depuis le poste (Abidjan → us-east-1) : majorant, la ligne précédente est la mesure utile |

Effet du 0,25 CU à chaud : la vente répond en ≈ 400 ms et le tableau de bord en ≈ 320 ms vus du poste ; les requêtes
du tableau de bord tournent sur une petite machine partagée, et les pics isolés de 1,3 à 2 s (§ C.3) peuvent venir de
là comme du démarrage d'une fonction ; non attribué faute de journaux de requêtes (`pg_stat_statements` n'est pas
installé en production : l'installer écrit dans la base, ce n'est pas fait sans accord).

Options, **non appliquées** (ressources payantes de production : accord du propriétaire nécessaire) :

- l'offre Free **ne permet pas** de couper la mise en veille (5 min fixes) ; l'offre Launch le permet, l'offre Scale
  la règle de 1 min à « toujours actif » (documentation Neon « Scale to zero », consultée le 2026-11-24). Garder le
  calculateur éveillé supprime le surcoût d'≈ 1 s mais facture le calculateur en continu ;
- passer à un calculateur plus gros ou à l'autoscaling n'améliore que les requêtes lourdes (rapports), pas le réveil.

Le prix exact n'est pas cité ici : il dépend de l'offre et doit être lu sur la page de tarifs Neon le jour de la
décision.

## G. Ce qui reste lent ou non testé

1. **Premier chargement d'une page commerçant** : les chiffres n'arrivent qu'après l'exécution du JavaScript ; sur un
   téléphone simulé (processeur ×4), la requête de données part vers 4,5 s et les chiffres s'affichent vers 5 à 6 s,
   avant comme après. La piste suivante : faire lire les données de premier affichage par le serveur (composant serveur)
   pour qu'elles arrivent avec la page. Non fait ici (changement d'architecture des écrans).
2. **Rapports** : LCP ≈ 6,8 s (sans limite, ×4) et ≈ 9,4 s (3G lente), **CLS 0,463** (au-delà de 0,1), présents avant
   cette mission. C'est la page la plus lente.
3. **Page publique en 3G lente** : LCP ≈ 6,8 s (inchangé ; images d'ambiance et police).
4. **Réveil de la base** (§ F) : la première requête après une période calme paie le réveil du calculateur.
5. **Pics serveur isolés** de 1,3 à 2 s sur une vente (avant comme après), non expliqués à ce stade (instance de
   fonction froide ou base) : à suivre dans Sentry et Vercel.
6. **Non testé** : vrai téléphone Android d'entrée de gamme (simulation ×4 seulement), réseau mobile réel de Côte
   d'Ivoire, saisie automatisée des identifiants à l'écran de connexion (Turnstile), fonctionnement hors ligne (il
   n'existe pas, inchangé), mesures navigateur en production sur les pages connectées (aucun compte de production n'est
   utilisé pour des mesures).

## H. Non-régression, fusion et production

- CI de la PR (`Intégration continue`, commit `9f5d74b`) : contrôle TypeScript, ESLint, schéma et migrations sans
  base, **suite Vitest complète** (permissions, isolation multi-commerce HTTP, idempotence), build de production et
  audit des dépendances : tout vert.
- Localement : `npm run lint`, `npm run typecheck`, tests du cache (`src/lib/client`, 24 tests) : verts.
- Fusion dans `main` en avance rapide (sans force, sans contourner de protection) ; une seule mise en production par
  poussée sur `main`, région de fonctions `iad1` à vérifier sur le déploiement.
- Relevé de la production **avant** fusion (`b504be8`, pages publiques, `prod-sentry-check.mjs`, sans erreur
  déclenchée) : le SDK Sentry (fragment `7771`) et le code PostHog (fragment `4635`) sont téléchargés sur `/` et
  `/login` ; aucun hôte PostHog contacté (pas de consentement).
- Les vérifications **après** mise en production (routes, région, Sentry à la demande avec une erreur d'essai
  reconnaissable `EssaiRemonteeSentryPerf`, erreurs Vercel et Sentry) sont consignées dans le compte rendu final de la
  mission (PR ridwangouet747-ai/QADROPS#2), faute de pouvoir les écrire ici avant la fusion.

## Données de test créées

Sur la base de **test** `qadr_staging` seulement : ventes et réceptions d'achat du commerce de test « Boutique de
test perf » (scénarios et bancs), un 2e commerce de test pour le compte A et un compte de test B avec son commerce.
Le produit renommé pendant le scénario 2 a retrouvé son nom. Rien n'a été écrit en production.
