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
| `src/lib/domain/business-page-access.ts` (+ test), `components/business/business-shell.tsx`, 10 pages `app/business/**/page.tsx` | (2026-11-22, `3cb5147`) la garde serveur renvoie le rôle déjà lu ; l'en-tête l'affiche dès le premier rendu (CLS 0,192 → 0 sur la page des produits, § D bis) |
| `src/components/business/business-suite-workspace.tsx` | (2026-11-22, `a174374`) `prefetch={false}` sur les liens de chaque ligne de vente (fiche et ticket) : 26 requêtes RSC de préchargement → 1 à l'ouverture de la liste |

**Ce qui n'a pas été changé, volontairement :**

- **Service worker** : aucune mise en cache de `/_next/static`. Vercel sert ces fichiers avec un cache navigateur
  immuable d'un an ; les recopier dans le cache du service worker n'apporte rien tant qu'aucune page de
  l'application n'est servie hors ligne, et ajoute un risque de version périmée. `sw.js` est inchangé
  (`OFFLINE_CACHE` reste `qadr-offline-v3`, `offline.html` n'a pas changé).
- **Coquille du commerce** (`BusinessShell`) : elle reste dans chaque page. **Correction du 2026-11-22** : la
  mesure sur la Preview montre qu'elle est **remontée à chaque navigation** (le segment dynamique change), donc
  `/api/account/me` et `/api/notifications/unread-count` sont rappelés à chaque clic du menu (§ D bis). Laissé en
  attente : la déplacer dans un `layout.tsx` touche la garde de chaque page et l'état de la caisse ; à décider
  après la question de la région (chaque appel coûte surtout le trajet vers la base).
- **Rechargement du catalogue après une vente** : conservé. C'est la seule source du stock affiché ; un calcul local
  du stock contredirait la règle « jamais de stock diminué sur la foi d'une action locale ».
- **Index SQL** : aucun ajouté. `EXPLAIN ANALYZE` (lecture seule) de la requête de la liste des produits sur la
  base de test de staging, commerce de 250 articles : **0,33 ms d'exécution**, 0,25 ms de planification, tout en
  mémoire (43 blocs lus dans le cache). Les requêtes ne sont pas la cause des lenteurs ; le trajet réseau vers la
  base l'est (§ D bis). `pg_stat_statements` n'est pas installé sur `qadr_staging` : l'installer écrit dans la
  base, ce n'a pas été fait. Volumes de staging faibles (B-1) : à remesurer sur un gros commerce.

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
**non identifiée**, à remesurer sur la Preview. **Remesuré le 2026-11-22 sur la Preview** : CLS 0 sur
18 chargements de `/login` (6 contrôles dédiés + 12 du banc, deux builds après) ; le décalage local n'a pas été
reproduit sur Vercel. Cause toujours non identifiée, donc surveillée plutôt que déclarée corrigée.

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

## D bis. Mesures sur la Preview Vercel (2026-11-22)

**Environnement.** Projet Vercel `web`, alias de branche
`web-git-perf-global-performance-optimization-qadragency.vercel.app`, protection SSO conservée (accès du banc par
la clé de contournement d'automatisation, jamais publiée). Fonctions en `cpt1` (Le Cap, réglage du projet), base
**de test** : branche Neon `mission-14-staging`, base `qadr_staging` (us-east-1), reliée par des variables
**propres à la branche Git** `perf/global-performance-optimization` (Preview seulement ; les variables de
production et le déploiement de production `9ea0e31` sont inchangés). Commerce de test dédié (250 articles), compte
de test ouvert par l'API serveur de Better Auth avec le secret propre à la Preview ; Turnstile actif et inchangé.
Aucune donnée réelle n'a été lue ni écrite.

**Banc** (`preview-bench.mjs`, hors dépôt) : Chromium local, 360 × 740, processeur ×4, cache vidé avant chaque
chargement, 3 passages par page, profils « sans limite » et « 3G lente » (400 ms, 400 kbit/s). Avant = `d0cf61e`
(départ de la mission), après = `a174374` (fin de mission), même alias, même base, même commerce, même poste.

| Page | Profil | LCP médian avant → après | CLS avant → après | JS avant → après | Transfert avant → après |
| --- | --- | --- | --- | --- | --- |
| `/` | sans limite | 3 240 → 4 024 ms | 0 → 0 | 695 → 435 Ko | 870 → 652 Ko |
| `/` | 3G lente | 6 280 → 9 648 ms | 0 → 0 | 695 → 242 Ko | 870 → 460 Ko |
| `/login` | sans limite | 2 984 → 2 444 ms | 0 → 0 | 476 → 210 Ko | 552 → 331 Ko |
| `/login` | 3G lente | 3 940 → 4 852 ms | 0 → 0 | 475 → 210 Ko | 552 → 331 Ko |
| Tableau de bord | sans limite | 5 760 → 5 384 ms | 0,007 → 0 | 526 → 263 Ko | 606 → 385 Ko |
| Tableau de bord | 3G lente | 6 896 → 6 964 ms | 0,007 → 0 | 527 → 262 Ko | 606 → 384 Ko |
| Produits | sans limite | 5 920 → 4 876 ms | **0,192 → 0** | 527 → 263 Ko | 609 → 386 Ko |
| Produits | 3G lente | 7 696 → 7 212 ms | **0,192 → 0** | 527 → 263 Ko | 607 → 386 Ko |
| Historique des ventes | sans limite | 5 128 → 4 084 ms | 0,024 → 0,017 | 527 → 263 Ko | 611 → 386 Ko |
| Historique des ventes | 3G lente | 8 916 → 6 948 ms | 0,119 → 0,017 | 527 → 263 Ko | 609 → 386 Ko |

| Caisse | Profil | LCP médian | Recherche « vis 20 » jusqu'au résultat (médiane) | Pire frappe (médiane) |
| --- | --- | --- | --- | --- |
| avant → après | sans limite | 4 616 → 4 280 ms | 1 511 → 2 452 ms | 432 → 624 ms |
| avant → après | 3G lente | 7 560 → 7 212 ms | 1 744 → 1 637 ms | 424 → 272 ms |

| Vente (espèces, 1 article, statut 201 les 12 fois) | Profil | Clic → « Vente enregistrée » (médiane) | Attente du serveur (médiane) |
| --- | --- | --- | --- |
| avant → après | sans limite | 6 628 → 6 297 ms | 6 423 → 5 988 ms |
| avant → après | 3G lente | 6 675 → 6 416 ms | 6 424 → 6 182 ms |

**Lecture honnête.**

- **Robuste** : JS divisé par deux sur chaque page (−37 à −65 %), transfert −25 à −47 %, CLS des produits 0,192 → 0.
- **Dans le bruit** : les LCP. Le même build, au même endroit, mesuré deux fois de suite, donne pour les produits
  4 876 ms puis 11 500 ms (médianes). Trois passages ne suffisent pas à départager des écarts de quelques
  centaines de millisecondes ; aucune amélioration ni dégradation de LCP n'est donc revendiquée.
- **Cause dominante des lenteurs, hors du code** : une vente attend **≈ 6 s le serveur** dans les deux builds. Les
  fonctions tournent au Cap (`cpt1`) et la base en Virginie (us-east-1) : chaque aller-retour SQL coûte
  ≈ 220 à 300 ms, et une vente en enchaîne plusieurs dans sa transaction. La production a **le même réglage**.
  Essai de déploiement en `iad1` (à côté de la base) **non concluant** : le réglage de région par déploiement a été
  ignoré (`regions: ["cpt1"]` sur le déploiement d'essai). Changer la région du projet toucherait aussi la
  production : décision du propriétaire (§ H).

**Réponse perdue sur PostgreSQL réel** (coupure de la première réponse de `POST /api/business/sales` par le
protocole du navigateur, rechargement, même panier, nouvel « Encaisser ») :

| Build | Message « Pas de réponse du serveur » | 2ᵉ essai | Stock avant → après coupure → après 2ᵉ essai | Résultat |
| --- | --- | --- | --- | --- |
| avant (`d0cf61e`) | oui | **201** (nouvelle vente) | 27 → 26 → **25** | **vente en double** |
| après (`a174374`) | oui | **200** (vente déjà enregistrée) | 12 → 11 → **11** | une seule vente |

**Navigation hors ligne** (réseau coupé puis clic de menu) : le banc n'a pas trouvé le bandeau dans le texte de la
page, ni avant ni après ; un passage antérieur de l'ancien banc l'avait trouvé après. **Non concluant**, à vérifier
à la main sur un téléphone.

**Appels d'API.** Au chargement complet : tableau de bord 5, produits 4, ventes 4, caisse 6, connexion 2 (dont
`/api/version`, nouveau) ; aucun appel en double dans un même chargement. En navigation interne (clic de menu,
1 280 px) : chaque section rappelle `/api/account/me` et `/api/notifications/unread-count` (coquille remontée,
§ C) ; l'ouverture de l'historique des ventes déclenchait **26 requêtes RSC** de préchargement, **1** après
`a174374`.

**SQL** : la requête de la liste des produits s'exécute en 0,33 ms (§ C) ; aucune requête lente constatée.

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

**Qadr Ops ne fonctionne pas hors ligne.** Sans réseau, aucune vente, aucun paiement, aucun mouvement de stock ne
peut être enregistré, et l'application ne le prétend nulle part. État exact, capacité par capacité :

| Capacité | État | Preuve ou limite |
| --- | --- | --- |
| Application installable (PWA) | **oui** | `manifest.ts`, icônes, `sw.js` enregistré partout, page `/business/install` (mission 11 phase 2) ; installation non vérifiée sur un vrai téléphone Android pendant cette mission |
| Cache des ressources statiques | **par le navigateur seulement** | `/_next/static` servi par Vercel avec un cache immuable d'un an ; le service worker ne garde que `/offline.html` (`OFFLINE_CACHE` = `qadr-offline-v3`, inchangé) |
| Page hors ligne | **oui** | une navigation sans réseau vers une page jamais chargée affiche `/offline.html` |
| Conservation locale des données (catalogue, clients, ventes) | **non** | aucune donnée commerciale n'est copiée dans IndexedDB, `localStorage` ou le service worker |
| Conservation des formulaires | **partielle** | le panier de la caisse reste en mémoire tant que l'onglet est ouvert ; il est perdu au rechargement. Les autres formulaires ne sont pas conservés |
| Mise en attente des opérations | **non** | aucune file d'envoi. Seule exception, de sécurité : l'**empreinte** d'une vente sans réponse et sa clé d'idempotence (pas son contenu), dans `sessionStorage`, 2 h, effacées à la déconnexion |
| Synchronisation après reconnexion | **non** | rien n'est renvoyé automatiquement ; c'est la caissière qui appuie de nouveau sur « Encaisser », et le serveur rejoue la vente déjà enregistrée au lieu d'en créer une seconde (§ E) |

Sur un réseau dégradé, ce qui est garanti et testé en local (§ E) puis sur la Preview reliée à PostgreSQL (§ D bis) : une vente sans réponse
n'est annoncée ni comme enregistrée ni comme perdue (« Pas de réponse du serveur… ») ; après rechargement de la
page et nouvel essai, la vente n'est pas doublée et le stock n'est diminué qu'une fois.

**Pourquoi rien de plus n'est livré** : une file de ventes hors ligne demande des garanties qui n'existent pas
encore (conflits de stock entre plusieurs appareils, prix modifié entre la saisie et l'envoi, chiffrement local,
statut visible de chaque opération, effacement à la déconnexion). La livrer sans elles exposerait à des ventes
présentées comme faites alors que le serveur ne les a pas confirmées, ou à un stock diminué sur la foi d'une action
locale. Les deux sont interdits par les règles du projet.

**Progression proposée** (aucune étape n'est commencée ; chacune se décide après la précédente et après
observation sur le terrain) :

1. **Lecture hors ligne du catalogue** (sans risque financier) : copie du catalogue du commerce actif dans
   IndexedDB, rattachée au commerce et à l'utilisateur, effacée à la déconnexion et au changement de commerce,
   affichée comme « catalogue du JJ/MM à HH:MM ». Aucune écriture.
2. **Panier conservé** : le panier en cours survit au rechargement (même onglet, même commerce), sans rien envoyer.
3. **Brouillon de vente hors ligne, jamais une vente** : la caissière peut préparer une vente sans réseau ; elle
   reste « Non enregistrée, en attente de connexion » et n'est envoyée qu'après une action explicite, avec sa clé
   d'idempotence. Le serveur refuse si le prix ou le stock a changé, et la caissière voit le refus ligne par ligne.
   Pas de Mobile Money hors ligne : la réception d'un paiement Mobile Money ne peut pas être confirmée sans le
   serveur.
4. **Envoi automatique à la reconnexion** : seulement après des essais sur plusieurs appareils, coupures répétées
   et conflits de stock, sur de vrais téléphones Android.

## F bis. Statut des problèmes examinés

| Problème | Statut | Détail |
| --- | --- | --- |
| CLS intermittent de `/login` | **non reproduit sur Vercel**, surveillé | 0 sur 18 chargements de la Preview ; cause du cas local inconnue (§ D) |
| CLS des produits (0,192, présent avant la mission) | **corrigé** (`3cb5147`) | boutons réservés affichés dès le rendu serveur ; 0 sur 9 chargements de la Preview |
| Appels répétés de l'en-tête commun | **en attente** | `/api/account/me` + compteur de notifications à chaque navigation ; déplacer la coquille dans un `layout.tsx` est un changement plus large (§ C) |
| Allers-retours séquentiels des requêtes métier | **en partie corrigé** | contrôles d'accès de `getBusinessContext` lancés ensemble (mission du 2026-11-21) ; le rôle reste lu deux fois (garde + permission), conservé volontairement : les deux lectures partent ensemble et l'une sert de garde indépendante |
| Chargements redondants | **corrigé** pour l'historique des ventes (`a174374`, 26 → 1 requête RSC) ; aucun doublon d'appel d'API dans un chargement |
| Performance SQL | **sans problème constaté** | 0,33 ms pour la liste des produits ; la latence vient du trajet Le Cap ↔ Virginie |
| Région des fonctions ≠ région de la base | **corrigé le 2026-11-23** | région du projet passée à `iad1` par le propriétaire ; attente serveur d'une vente ≈ 6 s → ≈ 0,5 s sur la Preview (§ I) |

## G. Livraison

| Étape | État |
| --- | --- |
| Branche | `perf/global-performance-optimization` (partie de `d0cf61e`) : `3b7c798`, `3cb5147`, `a174374`, puis ce rapport |
| Pull Request | [ridwangouet747-ai/QADROPS#1](https://github.com/ridwangouet747-ai/QADROPS/pull/1), fusionnée le 2026-11-23 (`5e6e6eb`) |
| Intégration continue | 7 contrôles verts sur `3b7c798` (run 44997901058), `3cb5147` (run 45012193949) et `a174374` (run 45013008460) : TypeScript, ESLint, schéma/migrations, Vitest, build, audit |
| Suite complète en local | `npm test` (2026-11-22, `a174374` + rapport) : **123 fichiers, 1 065 tests réussis, 10 ignorés (R2), 0 échec** ; ventes, paiements mixtes, monnaie rendue, stock, crédits, authentification, isolation des commerces et idempotence y compris |
| Preview | alias de branche (protégé), base de test de staging, région `cpt1` |
| Migrations | aucune (`drizzle-kit check` : « Everything's fine » ; `generate` : « No schema changes ») |
| Production | **déployée le 2026-11-23** : `5e6e6eb`, `dpl_H7yhwjgug4WGLb7Dmq2VBFNANEKr`, région `iad1` (§ I) |
| Retour arrière | redéployer `9ea0e31` (`dpl_AsLe7m3bZWHFWmkNGubAQM8nL83K`, région `cpt1` : le retour arrière ramène aussi l'ancienne région) ; aucune donnée ni schéma à restaurer |

**À nettoyer après la mission (sur accord)** : les variables Vercel propres à la branche
`perf/global-performance-optimization` (base de test, secrets d'authentification de la Preview) ; sur
`qadr_staging`, le compte et le commerce de test, ses 250 articles, ses ventes de test et la formule
`perf-test-access-plan` ; les déploiements Preview de la branche.

**Tests R2 (10 ignorés)** : `src/lib/storage/r2.integration.test.ts` ne tourne qu'avec `QADR_TEST_R2_ACCOUNT_ID`,
`QADR_TEST_R2_BUCKET_NAME` (nom contenant `test`, `staging`, `dev` ou `preview`, par exemple
`qadr-ops-fichiers-staging`), `QADR_TEST_R2_ACCESS_KEY_ID`, `QADR_TEST_R2_SECRET_ACCESS_KEY` (et
`QADR_TEST_R2_JURISDICTION` si besoin). Seul le bucket `qadr` existe : il faut créer un bucket de test et un jeton
limité à ce bucket, puis lancer `npx vitest run src/lib/storage/r2.integration.test.ts` depuis `apps/web`.

## H. Risques restants

- **Région** : **réglée le 2026-11-23** (fonctions en `iad1`, à côté de la base us-east-1 ; § I). Reste la
  distance entre la Côte d'Ivoire et Washington pour chaque requête du navigateur, inévitable tant que base et
  fonctions sont aux États-Unis.
- **Temps réels** : sur 3G lente, le LCP reste de 4 à 6 s (le réseau lui-même) ; sans limite, `/` reste à ≈ 3 s,
  au-dessus de l'objectif de 2,5 s. L'INP n'a aucune mesure de terrain.
- **Pages métier en production** : vérifiées seulement sans session (redirections et refus) ; aucune connexion à
  un compte réel n'a été faite. Une connexion du propriétaire sur son vrai commerce reste à faire.
- **Téléphone Android réel** : rien n'a été vérifié sur un vrai appareil. Restent à faire : installation de
  l'application, page hors ligne et bandeau réseau, caisse (recherche, vente, réponse perdue) sur 3G réelle,
  impression, ticket en arabe.
- **Banc k6** : `load-tests/README.md` suppose que le jeton Turnstile factice passe en préproduction, alors que le
  code refuse les clés de test quand `NODE_ENV=production` (cas de toute Preview Vercel) ; à corriger avant tout
  essai de charge.
- **Grand catalogue** : la caisse charge encore tout le catalogue d'un coup (sans `?limit=`) ; au-delà de quelques
  milliers d'articles, le transfert et l'index (≈ 168 ms pour 5 000 articles sur ordinateur) deviendront visibles
  sur téléphone. Étape suivante possible : recherche côté serveur paginée.
- **Clé de vente en attente** : limitée à l'onglet (`sessionStorage`) ; un autre onglet ou un autre appareil
  n'en profite pas.
- **Hors ligne** : aucune vente hors ligne (§ F).
- **Avis de nouvelle version** : dépend de `VERCEL_DEPLOYMENT_ID` (ou du commit) au moment de l'exécution ; non
  vérifié sur un vrai changement de déploiement.
- **Journaux de production** : `vercel logs` ne renvoie aucune ligne pour le projet (ni par l'API ni par la CLI,
  2026-11-23) ; la surveillance repose sur Sentry (aucune erreur dans les 24 h suivant la mise en production).

## I. Mise en production du 2026-11-23

Autorisée par le propriétaire (fusion et déploiement), après son passage de la région du projet Vercel `web` à
`iad1` (Washington), à côté de la base Neon (us-east-1, Virginie).

| Étape | Résultat |
| --- | --- |
| Région | projet : `serverlessFunctionRegion` = `iad1`, `functionDefaultRegions` = `["iad1"]` ; aucune région dans `vercel.json` ni dans le code ; Preview `dpl_4M3UKw5XdPqzSxYshHezFEL4baib` et production `dpl_H7yhwjgug4WGLb7Dmq2VBFNANEKr` : `regions: ["iad1"]` (l'ancienne production `9ea0e31` était en `cpt1`) |
| CI | verte sur `36b32ed` (run 45018848282, 7 contrôles) |
| Fusion | PR #1 fusionnée : commit `5e6e6eb` (fusion `--no-ff`, arbre identique à `36b32ed`, aucun commit intermédiaire sur `main`). L'intégration GitHub de l'agent n'avait pas le droit de fusionner (403) : la même fusion a été poussée sur `main` sans forcer, GitHub a marqué la PR fusionnée |
| Déploiement | lancé par Vercel à la poussée sur `main` (un seul), `READY`, URL `web-mvuqst4bk-qadragency.vercel.app`, domaine `web-phi-beryl-45.vercel.app` (`web-qadragency.vercel.app` y renvoie en 307) |
| Migrations | aucune ; la base de production n'a pas été touchée |
| Pages publiques | `/`, `/login`, `/register`, `/redeem-code`, `/privacy`, `robots.txt`, manifeste, `offline.html`, `/api/version` : 200 ; les formules (5 000 et 10 000 F CFA) sont lues dans `subscription_plan` |
| Protections | `/business/dashboard` et `/platform` sans session → 307 `/login` ; `/api/account/me`, `/api/business/products`, cookie forgé → 401 |
| Erreurs | Sentry : aucune erreur non résolue dans les 24 h ; journaux Vercel non disponibles (§ H) |

**Preview en `iad1`** (même base de test, même commerce, même banc qu'au § D bis ; médianes de 3) :

| Mesure | `cpt1` (2026-11-22, `a174374`) | `iad1` (2026-11-23, `36b32ed`) |
| --- | --- | --- |
| Vente : attente du serveur | 5 988 ms (sans limite), 6 182 ms (3G) | **≈ 490 ms** (médiane des 10 ventes : 349 à 1 201 ms) |
| Vente : clic → « Vente enregistrée » | 6 297 / 6 416 ms | 525 à 1 417 ms |
| Tableau de bord, LCP sans limite / 3G | 5 384 / 6 964 ms | **1 492 / 4 160 ms** |
| Produits | 4 876 / 7 212 ms | **1 272 / 4 216 ms** |
| Historique des ventes | 4 084 / 6 948 ms | **1 268 / 4 172 ms** |
| `/login` | 2 444 / 4 852 ms | 1 256 / 4 316 ms |
| `/` | 4 024 / 9 648 ms | 2 324 / 6 128 ms |
| Caisse : LCP sans limite (3 chargements) | 4 280 ms | 1 480 à 5 112 ms |
| Recherche « vis 20 » jusqu'au résultat | 2 452 ms | 1 891 à 1 944 ms |
| TTFB des pages | non relevé | 113 à 142 ms |

Réponse perdue (iad1) : stock 54 → 53 → **53**, second essai **200** (vente déjà enregistrée), aucun doublon.
CLS des produits : 0 (2 chargements). Navigation interne : 1 requête RSC par clic, `/api/account/me` et le compteur
de notifications toujours rappelés à chaque section. Contrôles d'accès et de cache (12) : tous conformes, dont
`private, no-store` sur les API privées, 403 pour une écriture d'origine étrangère, 401 après déconnexion. Le
banc a réapprovisionné l'article de test par un achat reçu (fournisseur de test, 60 unités) sur `qadr_staging`.

**Production, pages publiques** (même banc qu'au § A, 2ᵉ passage ; le 1ᵉʳ a subi des TTFB de 2,6 à 6,3 s dus au
réseau du poste, écartés) :

| Page | Profil | Avant (2026-11-21, `9ea0e31`) | Après (2026-11-23, `5e6e6eb`) |
| --- | --- | --- | --- |
| `/` | sans limite | LCP 3 444 ms, JS 694 Ko | LCP 3 032 ms, JS 434 Ko |
| `/` | 4G lente | 4 200 ms | 3 700 ms |
| `/` | 3G lente | 5 980 ms, JS 695 Ko | 6 368 ms, JS 241 Ko |
| `/login` | sans limite | 1 744 ms, JS 503 Ko | 1 640 ms, JS 237 Ko |
| `/login` | 4G lente | 2 508 ms | 2 396 ms |
| `/login` | 3G lente | 3 740 ms | 4 500 ms |

Les écarts de LCP des pages publiques restent dans le bruit de mesure ; la baisse du JS est nette.
Le gain en production est attendu surtout sur les pages du commerce et les ventes (mesuré sur la Preview), qui
n'ont pas pu être mesurées en production sans compte.

**Conclusion : déployé avec réserves non bloquantes** (pages du commerce non vérifiées avec un vrai compte en
production, journaux Vercel indisponibles, essais Android à faire).
