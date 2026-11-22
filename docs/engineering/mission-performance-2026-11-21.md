# Mission performance, fluidité, PWA et résilience réseau (2026-11-21)

> Rapport de l'agent. Toute valeur citée a été mesurée par une commande nommée ici ; ce qui n'a pas pu l'être est
> dit comme tel. Branche `perf/global-performance-optimization`, partie de `d0cf61e`. **Aucune migration.**
> Rien n'a été écrit en production (ni donnée, ni variable, ni déploiement).

## A. État initial (mesuré)

Banc : Chromium local piloté par puppeteer-core, téléphone 360 × 740 (densité 2), **processeur ralenti ×4**,
contexte vierge à chaque passage (ni cache ni cookie), médiane de 3 passages classés par LCP. Profils réseau
explicites : « sans limite », « 4G lente » (150 ms, 1,6 Mbit/s descendant, 750 kbit/s montant), « 3G lente »
(400 ms, 400 kbit/s). Mesures de production prises le 2026-11-21 sur `https://web-phi-beryl-45.vercel.app`
(déploiement `9ea0e31`), pages publiques seulement (aucun compte de production n'a été utilisé).

| Page | Profil | TTFB | FCP = LCP | CLS | Fin du chargement | Requêtes | Transfert | dont JS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | sans limite | 384 ms | 3 444 ms | 0 | 7 292 ms | 31 | 871 Ko | 694 Ko |
| `/` | 4G lente | 394 ms | 4 200 ms | 0 | 5 476 ms | 31 | 871 Ko | 694 Ko |
| `/` | 3G lente | 534 ms | 5 980 ms | 0 | 16 895 ms | 31 | 871 Ko | 695 Ko |
| `/login` | sans limite | 414 ms | 1 744 ms | 0,009 | 3 105 ms | 37 | 582 Ko | 503 Ko |
| `/login` | 4G lente | 404 ms | 2 508 ms | 0,009 | 5 364 ms | 37 | 582 Ko | 503 Ko |
| `/login` | 3G lente | 533 ms | 3 740 ms | 0,009 | 14 327 ms | 37 | 582 Ko | 503 Ko |

Objectifs du mandat : LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1. Au départ, le LCP de `/` dépasse l'objectif sur tous
les profils, celui de `/login` dès la 4G lente ; le CLS est conforme partout.

**Inventaire du build** (`npm run build`, fragments JS de `.next/static/chunks`, gzip niveau par défaut) :

| Fragment | gzip | Contenu identifié | Chargé |
| --- | --- | --- | --- |
| `6938` | 143 Ko | Sentry navigateur (dont traçage) | toutes les pages |
| `689` | 117 Ko | **les traductions des trois langues** (fr + en + ar, toutes sections) | toutes les pages |
| `b468fba8` | 100 Ko | PostHog (+ rrweb, web-vitals) | toutes les pages, même sans consentement |
| `main` | 89 Ko | runtime + Sentry | toutes les pages |
| `bd904a5c`, `b536a0f1`, `f5ef5e1c` | 99 + 87 + 50 Ko | Three.js | page publique et inscription, à la demande |

## B. Problèmes trouvés

| # | Problème | Cause vérifiée | Impact | Correction | Priorité |
| --- | --- | --- | --- | --- | --- |
| 1 | 117 Ko de traductions sur chaque page | `I18nProvider` (client) importait `translate.ts`, qui importe les dictionnaires fr, en et ar | téléchargement et analyse JS sur toutes les pages, y compris la connexion | le serveur transmet au fournisseur le seul dictionnaire de la langue active | haute |
| 2 | PostHog (≈ 100 Ko) chargé sans consentement | import statique de `posthog-js` dans `lib/analytics/client.ts` | poids payé par 100 % des visiteurs pour une mesure facultative | import dynamique après l'accord seulement | haute |
| 3 | Code de traçage Sentry embarqué alors que `tracesSampleRate` vaut 0 | `@sentry/nextjs` ajoute `browserTracingIntegration` par défaut ; pas de `withSentryConfig` | ≈ 45 Ko gzip inutiles | constantes `__SENTRY_TRACING__` / `__SENTRY_DEBUG__` à `false` côté navigateur | moyenne |
| 4 | Ticket 3D (≈ 240 Ko) en concurrence avec le premier affichage | chargé dès que le ticket est visible, donc pendant le chargement de `/` | LCP et bande passante sur mobile | chargé après `load` + repos du navigateur ; jamais sur réseau annoncé 2G/3G | moyenne |
| 5 | Saisie lente dans la recherche de la caisse | chaque frappe renormalisait tout le catalogue et redessinait toutes les cartes | latence de saisie, surtout avec un grand catalogue | index calculé une fois, liste différée (`useDeferredValue`), grille mémorisée, 60 cartes puis « Afficher plus » | haute |
| 6 | Vente dupliquée possible après un rechargement | la clé d'idempotence d'une vente sans réponse ne vivait qu'en mémoire | double vente si la caissière recharge puis réencaisse | empreinte + clé gardées dans `sessionStorage` (onglet), réutilisées pour la même vente | haute (intégrité) |
| 7 | Trois allers-retours SQL en série à chaque requête métier | `getBusinessContext` attendait chaque contrôle avant le suivant | latence ajoutée à chaque appel d'API du commerce | contrôles lancés ensemble, évalués dans l'ordre d'origine | moyenne |
| 8 | Pas d'avis de nouvelle version | aucun mécanisme | un onglet ouvert reste sur l'ancienne version sans le savoir | `GET /api/version` + message, jamais de rechargement imposé | basse |


## C. Modifications

| Fichier | Changement |
| --- | --- |
| `src/lib/i18n/lookup.ts` (nouveau) | recherche et interpolation des messages sans aucun dictionnaire |
| `src/lib/i18n/translate.ts` | réutilise `lookup.ts` ; `createTranslator` (serveur) garde le repli sur le français |
| `src/components/i18n/i18n-provider.tsx` | reçoit `messages` (langue active seulement) ; plus d'import des dictionnaires côté navigateur |
| `src/app/layout.tsx` | transmet `dictionaries[locale]` ; monte `UpdateNotice` |
| `src/lib/analytics/client.ts` (+ test) | `posthog-js` importé à la demande après l'accord ; accord retiré pendant le téléchargement = rien n'est initialisé ni envoyé |
| `next.config.ts` | `DefinePlugin` côté navigateur : `__SENTRY_TRACING__` et `__SENTRY_DEBUG__` à `false` (les erreurs restent signalées ; serveur inchangé) |
| `src/components/landing/receipt-stage.tsx` | 3D chargée après `load` + repos du navigateur ; jamais sur réseau annoncé `slow-2g`/`2g`/`3g` (le ticket HTML reste) |
| `src/lib/pos/catalog-search.ts` (+ test) | index de recherche calculé une fois par chargement du catalogue |
| `src/components/business/pos-workspace.tsx` | recherche différée, grille mémorisée, 60 cartes puis « Afficher plus » ; clé de vente persistée |
| `src/lib/pos/pending-sale.ts` (+ test) | empreinte SHA-256 de la vente + clé d'idempotence + heure, dans `sessionStorage`, 2 h au plus |
| `src/lib/auth/logout.ts` | la déconnexion efface la vente en attente |
| `src/lib/domain/business-context.ts` | contrôles d'accès lancés ensemble, évalués dans l'ordre d'origine |
| `src/app/api/version/route.ts` (+ test), `src/components/pwa/update-notice.tsx`, `messages/pwa.ts` | avis de nouvelle version (fr/en/ar), sans rechargement imposé |

**Ce qui n'a pas été changé, volontairement :**

- **Service worker** : aucune mise en cache de `/_next/static`. Vercel sert ces fichiers avec un cache navigateur
  immuable d'un an ; les recopier dans le cache du service worker n'apporte rien tant qu'aucune page de
  l'application n'est servie hors ligne, et ajoute un risque de version périmée. `sw.js` est inchangé
  (`OFFLINE_CACHE` reste `qadr-offline-v3`, `offline.html` n'a pas changé).
- **Coquille du commerce** (`BusinessShell`) : elle reste dans chaque page. Entre deux sections de
  `/business/[section]`, React garde le même composant (pas de nouveau montage) ; la déplacer dans une mise en page
  toucherait la garde `requireBusinessPageAccess()` de chaque page, pour un gain non mesuré.
- **Rechargement du catalogue après une vente** : conservé. C'est la seule source du stock affiché ; un calcul local
  du stock contredirait la règle « jamais de stock diminué sur la foi d'une action locale ».
- **Index SQL** : aucun ajouté. Les volumes de staging sont trop faibles pour qu'un `EXPLAIN` y soit
  représentatif (B-1) et aucune lenteur de requête n'a été mesurée ; la mission 11 phase 6 a déjà posé les index
  des requêtes réelles (migration 0017).

## D. Avant / après (mesuré)

### Poids des pages : build de départ (`d0cf61e`) contre build modifié, même machine, `next start`

Deux builds `npm run build` (webpack) servis l'un après l'autre par `next start`, même banc qu'au § A (360 × 740,
processeur ×4, médiane de 3 passages). Sans base de données locale : la page `/` n'y trouve pas ses tarifs.

| Page | Profil | JS avant | JS après | Transfert avant | Transfert après |
| --- | --- | --- | --- | --- | --- |
| `/` | sans limite | 703 Ko | 445 Ko (−37 %) | 856 Ko | 643 Ko (−25 %) |
| `/` | 4G lente | 703 Ko | 445 Ko | 860 Ko | 645 Ko |
| `/` | 3G lente | 703 Ko | 445 Ko | 858 Ko | 645 Ko |
| `/login` | sans limite | 488 Ko | 224 Ko (−54 %) | 571 Ko | 356 Ko (−38 %) |
| `/login` | 4G lente | 488 Ko | 224 Ko | 566 Ko | 367 Ko |
| `/login` | 3G lente | 488 Ko | 224 Ko | 590 Ko | 368 Ko |

Temps d'affichage du même banc (indicatifs : serveur local de développement, TTFB instable de 50 à 1 568 ms selon
le passage ; seule la mesure sur un déploiement Vercel fera foi) :

| Page | Profil | LCP avant | LCP après | Fin du chargement avant | après |
| --- | --- | --- | --- | --- | --- |
| `/` | sans limite | 9 916 ms | 8 728 ms | 9 978 ms | 8 556 ms |
| `/` | 4G lente | 9 988 ms | 7 132 ms | 13 784 ms | 6 882 ms |
| `/` | 3G lente | 13 132 ms | 10 324 ms | 17 762 ms | 10 916 ms |
| `/login` | sans limite | 3 180 ms | 1 440 ms | 6 931 ms | 4 214 ms |
| `/login` | 4G lente | 3 024 ms | 2 160 ms | 8 152 ms | 4 216 ms |
| `/login` | 3G lente | 5 892 ms | 5 396 ms | 15 544 ms | 9 226 ms |

Le LCP local de `/` (≈ 9 s) est bien plus long qu'en production (3,4 s) : sans base, la section des tarifs attend
l'échec de sa requête. Il ne sert qu'à comparer les deux builds entre eux. **CLS** : 0 partout avant ; après, un
décalage rare sur `/login`, observé deux fois (0,19 dans la comparaison, 0,081 dans un contrôle dédié) et absent
des 15 autres chargements contrôlés un à un ; c'est le bloc centré du formulaire qui bouge (0 sur 6 avant). La police n'en est pas la cause (aucun décalage quand elle arrive après le premier affichage) ; cause
**non identifiée**, à remesurer sur la Preview.

### Fragments partagés (gzip)

| | Avant | Après |
| --- | --- | --- |
| Traductions (fr + en + ar) | 117 Ko sur chaque page | 0 (le dictionnaire actif arrive avec la page) |
| PostHog | 100 Ko sur chaque page | 0 sans consentement ; chargé après l'accord |
| Sentry (fragment principal) | 143 Ko | 98 Ko |
| Total des fragments du build | 1 288 Ko | 1 128 Ko |

### Caisse (aperçu local en mode développement, 242 articles en stock, processeur ×4)

| | Avant | Après |
| --- | --- | --- |
| Cartes dessinées | 250 | 60 (+ « Afficher plus ») |
| Pire frappe dans la recherche (3 passages) | 7 808 / 8 072 / 9 848 ms | 2 344 / 2 880 / 2 504 ms |
| Frappe au 75ᵉ centile | 736 / 1 112 / 1 296 ms | 1 480 / 1 320 / 800 ms (pas d'amélioration mesurable) |
| Appels d'API au chargement | 6 (×2 en développement : React StrictMode) | 6 (dont `/api/version`, nouveau) |

Le mode développement de React multiplie ces temps ; la caisse ne peut pas tourner en build de production sans
base (l'aperçu est réservé au développement). Coût du filtre seul, par frappe (Node 24, sans ralentissement) :

| Articles | Ancien filtre | Nouveau filtre | Index (une fois) |
| --- | --- | --- | --- |
| 250 | 2,73 ms | 0,06 ms | 5,6 ms |
| 2 000 | 19,96 ms | 1,72 ms | 46,7 ms |
| 5 000 | 58,86 ms | 1,46 ms | 167,9 ms |

**Non mesuré** : l'INP réel (pas de données de terrain), l'effet en production du regroupement des contrôles
d'accès (`getBusinessContext`) : PGlite exécute les requêtes l'une après l'autre, seule une mesure sur Neon le
montrera.

## E. Validation métier

Aperçu local (PGlite en mémoire, commerce de démonstration ; aucune base distante), 2026-11-22 :

- **Vente normale** (téléphone 360 px) : article ajouté, « Montant exact », « Encaisser » : vente
  `V-MWR3KEDU-…` enregistrée (2 239 F CFA), stock de l'article 50 → 49 relu ensuite sur le serveur.
- **Réponse perdue puis rechargement** (le cas visé) : la requête de vente part, sa réponse est volontairement
  perdue (`TypeError` simulé dans la page) : la caisse affiche « Pas de réponse du serveur : nous ne savons pas si
  la vente est enregistrée… ». Le serveur a enregistré la vente (201, stock 50 → 49). Page rechargée (le simulacre
  disparaît), même panier ressaisi, « Encaisser » : **même clé** (`45b7d0c3-…`), réponse **200 `replayed: true`**,
  stock **toujours 49**, clé effacée. Avant cette mission, la clé ne vivait qu'en mémoire : le rechargement en
  créait une nouvelle, donc une seconde vente.
- **Recherche** : « câble » → 13 articles ; « Afficher 60 de plus » → 120 cartes ; aucune barre de défilement
  horizontale à 320 et 360 px.
- Mobile Money, crédit, remboursement, impression, export : **non modifiés** ; couverts par la suite Vitest (§ D).

## F. Mode hors ligne et réseau dégradé

- **Aucune vente hors ligne n'est implémentée.** Une file d'envoi (« outbox ») de ventes demanderait : chiffrement
  local, résolution des conflits de stock entre appareils, et une règle sur les prix qui changent entre la saisie et
  l'envoi. Rien de cela n'existe ni n'a été testé ; la mettre en place sans ces garanties risquerait des ventes
  présentées comme faites alors que le serveur ne les a pas confirmées. Elle n'est donc pas livrée.
- **Ce qui est sûr et livré** : une vente sans réponse n'est jamais annoncée comme enregistrée ni comme perdue ; sa
  clé survit au rechargement de l'onglet, et un nouvel essai ne peut pas la doubler (§ E). La page hors ligne et le
  bandeau réseau existants sont inchangés.
- **Conception proposée pour plus tard** (non implémentée) : file IndexedDB par commerce et par utilisateur
  (effacée à la déconnexion), opérations idempotentes uniquement, envoi à la reconnexion, état visible
  « en attente / confirmée / refusée » ligne par ligne, refus serveur si le stock ou le prix a changé. À décider
  après observation terrain.

## G. Livraison

| Étape | État |
| --- | --- |
| Branche | `perf/global-performance-optimization` (partie de `d0cf61e`) |
| Migrations | aucune (`drizzle-kit check` : « Everything's fine » ; `generate` : « No schema changes ») |
| Production | **non déployée** : attend la validation explicite du propriétaire |
| Retour arrière | redéployer `9ea0e31` (`dpl_AsLe7m3bZWHFWmkNGubAQM8nL83K`) ; aucune donnée ni schéma à restaurer |

## H. Risques restants

- **CLS de `/login`** : décalage rare observé localement après la mission (§ D), cause non identifiée ; à remesurer
  sur la Preview avant toute mise en production.
- **Temps réels** : les LCP comparés viennent d'un serveur local ; l'objectif LCP ≤ 2,5 s n'est **pas démontré**
  pour `/` (3,4 s en production avant la mission). L'INP n'a aucune mesure de terrain.
- **Grand catalogue** : la caisse charge encore tout le catalogue d'un coup (sans `?limit=`) ; au-delà de quelques
  milliers d'articles, le transfert et l'index (≈ 168 ms pour 5 000 articles sur ordinateur) deviendront visibles
  sur téléphone. Étape suivante possible : recherche côté serveur paginée.
- **Clé de vente en attente** : limitée à l'onglet (`sessionStorage`) ; un autre onglet ou un autre appareil
  n'en profite pas.
- **Hors ligne** : aucune vente hors ligne (§ F).
- **Avis de nouvelle version** : dépend de `VERCEL_DEPLOYMENT_ID` (ou du commit) au moment de l'exécution ; non
  vérifié sur un vrai changement de déploiement.
