# Application installable (PWA)

Mission 11, phase 2 (2026-11-01). QADR OPS s'installe depuis le navigateur sur Android, iPhone/iPad et ordinateur. **Aucun fonctionnement hors ligne** : sans réseau, rien ne s'enregistre, et l'interface le dit.

## Ce qui est en place

| Élément | Fichier | Rôle |
| --- | --- | --- |
| Manifest | `apps/web/src/app/manifest.ts` → `/manifest.webmanifest` | Nom, démarrage sur `/business/dashboard`, plein écran (`standalone`), raccourcis Caisse et Stock |
| Icônes | `apps/web/public/icons/` (192, 512, maskable 512, Apple 180) | Générées par `node scripts/generate-pwa-icons.mjs` (depuis `apps/web`) avec `sharp`, déjà présent comme dépendance facultative de Next.js. Les PNG sont versionnés : ne relancer le script que si le dessin change |
| Métadonnées iOS | `apps/web/src/app/layout.tsx` (`icons.apple`, `appleWebApp`) | Icône d'écran d'accueil et ouverture plein écran sur iPhone |
| Service worker | `apps/web/public/sw.js`, enregistré sur toutes les pages par `components/pwa/pwa-registrar.tsx` | Push, page hors ligne, renouvellement d'abonnement push. Servi sans cache (`security-headers.ts`) |
| Page hors ligne | `apps/web/public/offline.html` | Statique, trilingue, sans script ni donnée du commerce |
| Bandeau réseau | `components/pwa/network-status.tsx` | Dans les cadres commerce et plateforme : « Pas de connexion… », puis « Connexion rétablie » 4 s |
| Invitation | `components/pwa/install-invite.tsx` | Sous l'en-tête du commerce. Refusable (« Plus tard », retenu sur l'appareil) |
| Page « Installer » | `/business/install` (`components/pwa/install-workspace.tsx`) | Pour tous les rôles, dans « Plus » (ordinateur) et « Modules » (téléphone) |
| Logique client | `src/lib/pwa/client.ts` | Détection de plateforme, invite `beforeinstallprompt`, état réseau, mémoire du refus |

Textes : `src/lib/i18n/messages/pwa.ts` (fr, en, ar). Le manifest reste en français (une seule langue par manifest) ; le nom de marque est le même partout.

## Service worker : règles

- **Seules les navigations** passent par le service worker, réseau d'abord. Les appels d'API, scripts, images et polices ne sont jamais interceptés ni mis en cache.
- **Un seul élément en cache** : `/offline.html` (cache `qadr-offline-vN`). Il n'est servi que si la navigation échoue.
- **Toute modification de `offline.html` exige d'incrémenter `OFFLINE_CACHE`** dans `sw.js` : sinon le navigateur ne met pas à jour le service worker et garde l'ancienne page. L'activation supprime les anciens caches `qadr-*`.
- `pushsubscriptionchange` : enregistre la nouvelle adresse pour la session commerçant, sinon pour la console (`?scope=platform`), puis oublie l'ancienne. Sans session, rien n'est enregistré ni oublié.

## Invitation et page d'installation

- L'invitation apparaît seulement si l'application n'est pas déjà installée, si elle n'a pas été refusée sur cet appareil, et si le navigateur propose l'installation (`beforeinstallprompt`) ou si l'appareil est un téléphone ou une tablette (étapes à suivre).
- Bouton direct quand le navigateur le permet (Chrome, Edge, Android). Sur iPhone/iPad, Safari n'offre aucun bouton : la page montre le geste « Partager → Sur l'écran d'accueil ».
- Rien n'est bloquant : l'application fonctionne pareil dans le navigateur.

## Réseau coupé

- `navigator.onLine` faux affiche le bandeau. Vrai ne garantit rien : un serveur injoignable n'est détecté qu'à l'échec d'une requête.
- **Caisse** : une requête sans réponse affiche « Pas de réponse du serveur : nous ne savons pas si la vente est enregistrée… ». Le panier reste à l'écran et la clé d'idempotence est conservée, donc appuyer de nouveau sur « Encaisser » ne crée jamais une seconde vente.
- Inventaire : boutons d'écriture désactivés hors ligne (hook partagé `useOnline`).

## Vérifications (2026-11-01)

- Tests : `src/lib/pwa/pwa.test.ts` (manifest, taille réelle de chaque icône, plateforme détectée) et `src/lib/notifications/service-worker.test.ts` (page hors ligne, aucune interception d'API, nettoyage des caches, `pushsubscriptionchange`).
- Navigateur d'aperçu : manifest servi en `application/manifest+json`, service worker actif sur la portée `/`, `/sw.js` en `no-cache`. Serveur arrêté pendant un encaissement : message ci-dessus, aucun « Failed to fetch », aucune vente annoncée. Navigation serveur arrêté : page hors ligne, adresse conservée. Page « Installer » vue en fr, en et ar (RTL, largeur 375 px sans débordement).
- **Non vérifié** : audit Lighthouse (outil absent du projet), installation réelle sur un téléphone Android ou un iPhone, notifications push renouvelées par un vrai navigateur.

## Limites

- Pas de vente hors ligne ni de synchronisation : conception à écrire à part (conflits de stock, chiffrement local).
- La page « Modules » du téléphone (`business-suite-workspace.tsx`) reste en français seulement, comme avant.
- Sur ordinateur, au premier affichage de la page « Installer », le choix d'appareil passe d'« Android » à l'appareil détecté (détection côté navigateur).
