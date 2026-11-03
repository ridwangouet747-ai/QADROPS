# Mission 11 : audit de départ et plan d'exécution

Date : 2026-11-01. Branche : `feat/mission-11-fiabilisation`.

Cet audit a été mené par cinq agents spécialisés, en lecture seule :
- architecture et performance ;
- sécurité ;
- PWA et notifications push ;
- impression et exports ;
- import et interface.

Le coordinateur a relu leurs rapports. Chaque constat ci-dessous cite le code. Ceux marqués *(supposé)* reposent sur le comportement documenté d'un service, sans mesure.

## 1. État de référence (mesuré le 2026-11-01)

| Contrôle | Commande (depuis `apps/web` sauf mention) | Résultat |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Réussi |
| Lint | `npm run lint` | Réussi |
| Tests unitaires et d'intégration | `npx vitest run` | 37 fichiers sur 38 réussis, 246 tests réussis et 12 ignorés (tout le fichier en échec) |
| Fichier en échec | `account.integration.test.ts` | Délai de 30 s dépassé quand la machine est chargée ; **12/12 réussis** quand il est lancé seul. Test instable, pas une régression |
| Build de production | `npm run build` | Réussi |
| Agent d'impression | `node --test "test/**/*.test.mjs"` (`apps/print-agent`) | 8/8 réussis |
| MVP historique | `npm test` (racine) | Réussi |
| Dépendances de production | `npm audit --omit=dev` | 12 alertes : 8 modérées, 4 élevées. Les 4 élevées viennent de `@opennextjs/cloudflare` → `glob`, utilisé seulement au build |
| Base Neon | — | Jamais contactée. Aucun test de charge possible sans base de préproduction |

Inventaire :
- 76 routes API, 54 tables, migrations 0000 à 0012 ;
- 13 services métier dans `src/lib/domain` ;
- aucun commit poussé depuis `d5f1693`.

## 2. Constats par gravité

### Critique

- **A-1 Connexions à la base.**
  - Un pool `neon-serverless` est créé à chaque requête et n'est jamais fermé : `db/client.ts:12`, appelé dans `business-context.ts:42`, `account-context.ts:13` et `platform-context.ts:17`.
  - Better Auth, mis en cache au niveau du module, garde de son côté un pool global : `auth/server.ts:199-221`.
  - Sur Vercel (Fluid Compute), le modèle recommandé est un pool global unique attaché au cycle de vie de la fonction. *(supposé, à vérifier dans la doc Vercel et Neon au moment de corriger)*
  - En l'état, chaque requête laisse des connexions ouvertes vers Neon.

### Élevé

| Code | Constat | Preuve |
| --- | --- | --- |
| S-1 | Les routes `/api/auth/organization/*` de Better Auth contournent les règles métier. Un membre désactivé mais encore connecté peut supprimer un propriétaire, changer des rôles ou inviter des comptes, sans quota ni audit | `app/api/auth/[...all]/route.ts`, `auth/server.ts:124-194`, `account.ts:227` |
| P-1 | Application non installable : aucun manifest, aucune icône PNG. Les notifications push sont impossibles sur iPhone | `src/app`, `public/`, `layout.tsx:13-18` |
| P-2 | « Retirer » sur l'appareil courant coupe les notifications push sans permettre de les réactiver | `notifications-workspace.tsx:173` |
| P-3 | Appareil partagé : la déconnexion ne désabonne pas l'appareil. Une relance peut envoyer la notification de A au compte B | `logout.ts:6-11`, `notifications.ts:250-258,352-354` |
| I-1 | Une vente annulée ou remboursée s'imprime comme un ticket valide | `receipt.ts:14-16` |
| I-2 | Les paiements remboursés sont affichés comme des encaissements | `receipt-ticket.ts:74` |
| I-3 | Réessayer depuis la caisse après un échec d'impression n'imprime jamais | `pos-workspace.tsx:67`, `printing.ts:122-126`, `agent.mjs:99-101` |
| I-4 | Le ticket à l'écran est en français codé en dur, sans RTL, alors que l'interface le recommande pour l'arabe | `thermal-receipt.tsx`, `messages/printing.ts:33` |
| D-1 | Requêtes trop parallèles : le tableau de bord lance environ 26 requêtes à la fois | `business-data.ts:41`, `reports.ts:193` |
| D-2 | Transactions qui verrouillent le stock trop longtemps (3 allers-retours par ligne) ; validation d'inventaire sans limite de lignes | `commercial.ts:182`, `inventory.ts:207` |
| D-3 | Rapports : agrégats sur tout l'historique des paiements, sans borne de date | `reports.ts:205-209` |
| N-1 | Notifications envoyées une par une dans `after()` ; une annonce à tous les membres peut dépasser le temps alloué | `notifications.ts:62,172` |

### Moyen (extraits)

**Sécurité**
- S-2 : l'annuaire de l'équipe est lisible par tout membre via `list-members`.
- S-3 : `/organization/update` contourne la validation du logo et le blocage d'un commerce suspendu.
- S-4 : aucun en-tête de sécurité (CSP, HSTS, `frame-ancestors`).
- S-5 : limitation de débit en mémoire, et aucune limite sur `/api/business/*`.

**Base de données**
- D-4 : index manquants : `purchase_payment`, `purchase_line`, `sale(customer_id)`, `cash_session_id` sur quatre tables, `notification_delivery`.
- D-5 : scans inutiles (remboursements filtrés en JavaScript) et requêtes N+1 (`listInventorySessions`).
- D-6 : risques d'interblocage (`updateBusinessSettings`, `expireDueSubscriptions` appelé depuis une route GET).
- D-7 : listes non paginées (clients, fournisseurs, stock) ou tronquées à 200 lignes.

**Notifications push**
- P-4 : redirection ouverte possible au clic (`//` accepté).
- P-5 : pas de gestionnaire `pushsubscriptionchange`.
- P-6 : service worker enregistré seulement à l'activation.

**Impression**
- I-5 : deux rendus du ticket qui calculent chacun de leur côté.
- I-6 : fuseau horaire absent du ticket HTML.
- I-7 : « imprimé » signifie seulement « transmis ».
- I-8 : une réimpression en double clic produit deux tickets.
- I-9 : erreurs brutes affichées.

**Agent d'impression local**
- I-10 : pas de contrôle de l'en-tête `Host` ; jetons sans expiration.

**Exports**
- X-1 : `csvCell` transforme les nombres négatifs en texte. La protection contre les formules reste correcte.

### Points vérifiés comme corrects

- **Isolation.** Toutes les routes métier prennent le commerce dans la session. Aucun IDOR (accès à l'objet d'un autre commerce par son identifiant) trouvé dans les routes de l'application.
- **Entrées.** Zod partout, corps limité à 64 Ko, aucun `dangerouslySetInnerHTML`, `sql.raw` utilisé seulement avec des constantes.
- **Crons.** Secrets vérifiés en temps constant.
- **Données sensibles.** Sentry et PostHog sont épurés. Les notifications ne montrent ni montant ni nom de client sur l'écran verrouillé.
- **Push.** Liste blanche des services push, endpoints expirés désactivés, relances bornées.
- **Agent d'impression.** Écoute seulement en local, appairage solide.

## 3. Ce qui manque pour la mission (constaté)

- **Qadr Capture / Adapt** : rien n'existe. Pas d'import de fichier, pas de stockage objet, pas de bibliothèque de lecture (CSV, XLSX, PDF), pas de recherche approximative ni d'alias.
- **Services à réutiliser** : produit, stock d'ouverture, dettes de départ, achats, dépenses.
- **Leurs limites** :
  - pas d'idempotence pour produits, clients et fournisseurs ;
  - pas de date passée pour les achats et les dépenses ;
  - une transaction par appel ;
  - pas de colonne `source_reference`.
- **Exports** : un CSV pour les rapports et l'inventaire. Pas de XLSX ni de PDF serveur.
- **PWA** : ni manifest, ni cache, ni page hors ligne. Seul l'inventaire détecte la perte de réseau.
- **Documentation** : `docs/architecture.md` décrit encore le MVP. Les couleurs de `design-system/qadr-ops/MASTER.md` sont périmées ; `docs/design-system.md` fait foi.

## 4. Plan d'exécution

Ordre fixé par la règle du projet : sécurité, puis exactitude, puis utilité pour le commerçant, puis le reste. Chaque étape se termine par typecheck, lint, tests, build et un commit local.

### Phase 1 : socle (sécurité et données)

| Étape | Critère d'acceptation mesurable |
| --- | --- |
| 1.1 Bloquer les routes Better Auth `organization/*` qui écrivent, et réserver la lecture de l'équipe (S-1, S-2, S-3) | Un test d'intégration montre qu'un membre désactivé ne peut plus supprimer de membre ni changer de rôle (403), et que les routes de l'application fonctionnent toujours |
| 1.2 En-têtes de sécurité (S-4) | `next build` réussit ; un test vérifie la présence de `frame-ancestors 'none'`, HSTS, `nosniff` et `Referrer-Policy` |
| 1.3 Connexions Neon (A-1) selon la doc Vercel et Neon en vigueur | Une seule fabrique de pool ; plus aucun pool créé par requête sans fermeture ; tests verts sur PGlite |
| 1.4 Impression : statut de la vente, remboursements, relance depuis la caisse (I-1 à I-3) | Tests : vente annulée → bandeau ; paiement remboursé → libellé ; relance après échec → nouvelle tâche |
| 1.5 Push : retrait de l'appareil courant, déconnexion, propriétaire dans les relances, `//` refusé (P-2 à P-4) | Tests unitaires et d'intégration correspondants |

**État au 2026-11-01 : étapes 1.1 à 1.5 livrées** (commit local de la phase 1). Chaque test de régression a été vu en échec sans sa correction.

- 1.1 : les routes HTTP `/api/auth/organization/*` répondent 404 ; les services de `account.ts` (appels serveur sans requête) passent toujours. Test : `auth-delivery.integration.test.ts`.
- 1.2 : `src/lib/security-headers.ts` branché dans `next.config.ts` (CSP `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS en production seulement ; `/sw.js` sans cache). Vérifié dans le navigateur d'aperçu.
- 1.3 : `getDatabase()` (`src/lib/db/client.ts`) garde un pool par URL et par processus, attaché par `attachDatabasePool` (`@vercel/functions`). **Non vérifié contre Neon** (blocage B-1).
- 1.4 : bandeau « VENTE ANNULÉE / REMBOURSÉE » sur le ticket ESC/POS et le ticket à l'écran, sans « reste à payer » ; paiements remboursés libellés ; relance après échec = réimpression liée.
- 1.5 : retrait de l'appareil courant, désabonnement à la déconnexion, relances limitées au propriétaire actuel de l'appareil, adresse active d'un autre compte refusée (409), liens `//` refusés (Zod, contrainte SQL, service worker). Migration locale `0013_push_link_paths.sql` (contraintes seulement), non appliquée à Neon.
- Reportés : P-5 (`pushsubscriptionchange`) et P-6 (service worker enregistré partout) vont avec la phase 2 (PWA) ; S-5 (limitation de débit partagée) reste ouvert.

### Phase 2 : PWA et onboarding « All-in »

Aucune définition d'« All-in » n'existe dans le dépôt. On retient donc celle de la mission : un parcours guidé de la découverte à l'installation.

| Étape | Critère |
| --- | --- |
| 2.1 Manifest, icônes PNG (192, 512, maskable, Apple 180), service worker enregistré partout, `/sw.js` en `no-cache` | Critères d'installabilité de Chrome remplis (vérification Lighthouse locale) |
| 2.2 Parcours d'installation (Android, iOS, ordinateur), retrouvable dans les réglages, jamais bloquant | Testé dans le navigateur intégré en fr, en et ar (RTL) |
| 2.3 Indicateur réseau global, page hors ligne honnête | Coupure simulée → message clair, aucune vente indiquée comme « enregistrée » sans réponse du serveur |

La vente hors ligne avec synchronisation n'est **pas** dans cette phase. Elle demande une conception écrite à part (conflits de stock, chiffrement local).

**État au 2026-11-01 : étapes 2.1 à 2.3 livrées** (commit local de la phase 2), avec P-5 et P-6. Détail : `docs/pwa.md`.

- 2.1 : manifest, quatre icônes PNG (tailles vérifiées par test), service worker enregistré sur toutes les pages (P-6), `pushsubscriptionchange` (P-5). Dans l'aperçu : manifest en `application/manifest+json`, service worker actif sur `/`, `/sw.js` sans cache. **Lighthouse non lancé** (outil absent) : les critères d'installabilité sont vérifiés par test et dans le navigateur, pas par l'audit.
- 2.2 : invitation refusable sous l'en-tête, page `/business/install` pour tous les rôles (menu « Plus » et page « Modules »). Vue en fr, en et ar (RTL, 375 px).
- 2.3 : bandeau réseau (commerce et plateforme) ; page hors ligne servie seulement si une navigation échoue. Serveur d'aperçu arrêté pendant un encaissement : « Pas de réponse du serveur… », aucune vente annoncée, panier et clé d'idempotence conservés.
- Non vérifié : installation sur un vrai téléphone, renouvellement push par un vrai navigateur.

### Phase 3 : Qadr Capture / Adapt, premier périmètre fiable

| Étape | Critère |
| --- | --- |
| 3.1 Tables `import_batch` et `import_row` (clés étrangères composées avec `business_id`), `product_alias`, `source_reference` ; migration locale uniquement | `drizzle-kit check` puis `generate` → « No schema changes » après génération |
| 3.2 Lecture déterministe CSV et XLSX (bibliothèque vérifiée : maintenance, licence, failles), sans macros | Tests : fichier vide, mal formé, colonnes sans titre, doublons, fichier envoyé deux fois |
| 3.3 Qadr Adapt : correspondance des colonnes par dictionnaire fr/en/ar et par les valeurs, alias propres à chaque commerce, statuts certain / probable / ambigu / illisible | Jeu d'essai annoté ; précision et faux rapprochements mesurés et publiés |
| 3.4 Écran de revue : source à côté des valeurs, correction ligne par ligne, reprise plus tard, confirmation explicite | Parcours testé de bout en bout sur PGlite |
| 3.5 Application via les services existants, idempotente par ligne, avec audit | Test : rejouer un import ne crée aucun doublon ; isolation entre deux commerces |
| 3.6 Photos et PDF scannés : adaptateur `DocumentTextExtractor`, désactivé sans fournisseur validé | Décision D-03 requise avant toute activation |

**État au 2026-11-01 : étapes 3.1 à 3.6 livrées** (commit local de la phase 3), pour un seul type d'import, le catalogue avec stock de départ. Détail et limites : `docs/imports.md`.

- 3.1 : migrations `0014` (tables `import_batch`, `import_row` et `product_alias`) et `0015` (opération `import.apply`). **Écart** : pas de table `source_reference`. Pour les tableurs, la provenance (numéro de ligne, cellules d'origine) est portée par `import_row`. La table sera à créer avec les documents scannés.
- 3.2 : `read-excel-file` 9.3.12 (MIT). 17 tests de lecture, dont une bombe zip, des macros, un CSV mal formé et des encodages arabe et Windows-1252.
- 3.3 : jeu d'essai synthétique de 63 cas. Résultat : 0 faux rapprochement certain, 1 fausse proposition sur 16, soumise au commerçant. Ce jeu a été écrit après l'algorithme : il est donc biaisé et ne remplace pas une évaluation sur de vrais fichiers.
- 3.4 : parcours envoi, revue, correction, reprise et application vérifié dans l'aperçu (PGlite) en fr, en et ar, en RTL et à 375 px. La fenêtre était masquée, donc les actions ont été déclenchées par script sur les vrais boutons et formulaires, pas à la souris. Ce parcours est aussi couvert par 11 tests d'intégration sur PGlite.
- 3.5 : application par paquets idempotents de 200 lignes, avec verrou par ligne et audit. Tests : rejeu avec la même clé et avec une autre clé, isolation A/B, permissions.
- 3.6 : `src/lib/imports/document-text.ts`, adaptateur désactivé, sans aucune lecture de variable d'environnement. Les PDF et les photos sont reconnus par leur contenu et refusés avec un message clair.

### Phase 4 : exports

- XLSX : feuilles Ventes, Produits, Stock, Clients, Dettes, Fournisseurs, Achats, Dépenses, Paiements, Synthèse.
- PDF des rapports.
- `csvCell` partagé et corrigé.
- Critère : fichiers ouverts sans alerte, aucune formule active, isolation testée.

**État au 2026-11-01 : exports livrés** (commit local de la phase 4), sans dépendance ni migration. Détail et limites : `docs/exports.md`.

- XLSX : classeur écrit par le dépôt (`src/lib/exports/xlsx.ts`, zip par `node:zlib`), sans aucun élément de formule. Montants en entiers, quantités `numeric` sans perte, négatifs conservés en nombres, texte « à risque » écrit en texte avec `quotePrefix`, feuilles en RTL pour l'arabe. Chaque feuille exige la permission de lecture de son domaine, en plus de `report:read`. **Écarts** : la Synthèse est la première feuille, pas la dernière ; au-delà de 5 000 lignes, une feuille de la période (ventes, stock, achats, dépenses, paiements) refuse l'export (422) au lieu d'être tronquée, alors que les listes de référence sont tronquées et le signalent.
- PDF : `src/lib/exports/pdf.ts`, polices standard, **français et anglais seulement**. En arabe, le serveur répond 422 et l'écran propose le PDF en français ou l'impression du navigateur.
- X-1 corrigé : `csvCell` partagé (`src/lib/exports/csv.ts`) par le résumé CSV et l'export d'inventaire ; un nombre négatif reste un nombre.
- Tests : unitaires (csv, xlsx relu par `read-excel-file`, pdf ; le zip est aussi utilisé par les tests de lecture des imports) et 8 tests d'intégration PGlite (commerces A et B, identifiants de requête ignorés, sommes égales aux totaux du rapport, caissier 403, sans session 401, périodes invalides, plafond). **Non vérifié** : ouverture dans Excel, LibreOffice ou un lecteur PDF réel, et l'écran dans un navigateur.

### Phase 5 : impression, consolidation

Un modèle unique `ReceiptDocument`, des profils d'imprimante (colonnes, code page), un ticket à l'écran traduit avec RTL, et l'arabe et le logo en trame ESC/POS. Le matériel réel doit être testé sur place par le propriétaire.

**État au 2026-11-01 : livrée en logiciel, non vérifiée sur une imprimante réelle (B-2).** Détail et liste des contrôles à faire sur place : `docs/printing.md` § 7.

- I-4 : ticket à l'écran traduit en fr, en et ar (`?lang=`), `dir="rtl"` en arabe, montants et références isolés (`<bdi>`, LRI/PDI), aperçu 58 / 80 mm. Test de rendu (`thermal-receipt.test.ts`).
- I-5 : `buildReceiptDocument` construit un seul document côté serveur. L'écran, l'ESC/POS texte et l'image affichent `layoutReceipt(document)` sans recalcul. Un test d'intégration vérifie que la tâche d'impression et le ticket à l'écran ont les mêmes blocs.
- I-6 : date au fuseau du commerce (`Africa/Abidjan` par défaut ou si le fuseau est invalide), suivie de « GMT ».
- I-7 : le statut `printed` s'affiche « Transmis », avec la mention que seul le papier prouve la sortie.
- I-8 : réimpression par `runIdempotent` (opération `print.reprint`, migration 0016). La clé est obligatoire sur la route, et un double clic ne crée qu'une tâche et qu'un audit.
- I-9 : erreurs renvoyées par un code stable et traduites (fr/en/ar). Un code inconnu affiche « erreur inconnue ».
- I-10 : le service local 0.2.0 contrôle l'en-tête `Host` (421) et limite la durée des appairages (`tokenTtlDays`, 90 jours, `401 pairing_expired`). Les anciens appairages reçoivent une échéance d'au moins 30 jours, annoncée dans la console. Couvert par 6 tests `node --test`.
- Profils : 58 mm (32 colonnes) et 80 mm (48 colonnes), pages de codes PC858, PC850 et WPC1252, mode d'écriture auto, texte ou image (migration `0016_printer_profiles`).
- Arabe et logo : trame GS v 0 par bandes de 128 lignes. Le logo est tramé selon Atkinson. Les fonctions pures d'image sont testées octet par octet. **Écart** : le dessin sur canvas (`raster-canvas.ts`) n'est couvert par aucun test automatique, car Vitest n'a pas de canvas.
- Vérifications : `tsc` et `lint` sans erreur. Vitest complet : 50 fichiers et 396 tests réussis. Service local : 14 tests réussis. `drizzle-kit check`, puis un second `generate`, répond « No schema changes ». **`npm run build` non concluant** : deux essais ont échoué en téléchargeant la police `Plus Jakarta Sans` depuis Google Fonts (« socket hang up », puis `NextFontError: Failed to fetch`), avant la compilation du code. C'est une panne réseau, pas une erreur du code ; le build est à relancer quand le réseau sera rétabli.

### Phase 6 : performance et base

- Migration d'index (D-4).
- Requêtes groupées (D-1, D-3, D-5).
- Pagination (D-7).
- Verrous (D-2, D-6).
- Mesures avant et après sur PGlite, puis sur Neon de préproduction.

### Phase 7 : campagne de validation

- Tests multi-commerce au niveau des routes HTTP.
- Tests de bout en bout.
- Tests de charge k6 progressifs (100 → 1 000 utilisateurs virtuels) **sur une préproduction seulement**.

**État au 2026-11-03** (détail dans `docs/validation.md`) :

- **Fait : tests multi-commerce au niveau des routes HTTP.**
  - Harnais `apps/web/src/test/http-harness.ts` : PGlite migré, vraies sessions Better Auth, un
    seul simulacre (la connexion à la base).
  - Les 81 fichiers `route.ts` et chacune de leurs méthodes sont appelés.
  - Couvert : isolation A/B, rôles, membre désactivé, commerce suspendu, expiré ou en essai échu.
  - Aucune faille d'isolation trouvée.
  - Un écart est documenté par un `it.fails` (E-1) : un client d'un autre commerce dans une vente
    donne un 500 au lieu d'un 404, sans fuite.
  - Une observation reste à trancher (O-1) : la configuration d'imprimante n'est pas bloquée pour
    un commerce suspendu.
- **Fait, sur PGlite : parcours de bout en bout par HTTP** (`merchant-journey.http.test.ts`), de
  l'inscription aux exports, avec totaux et stock vérifiés à chaque étape.
  - **Bloqué (B-1) :** le même parcours sur Neon et Vercel.
  - **Hors périmètre :** un parcours dans un navigateur, faute de Playwright.
- **Préparé, jamais exécuté : tests de charge k6** (`apps/web/load-tests/`).
  - Le garde-fou refuse toute cible sans marqueur de préproduction.
  - **Bloqué (B-1)** tant qu'aucune préproduction n'existe.
- **Vérifications :**
  - `typecheck` et `lint` sans erreur ;
  - Vitest complet, lancé en trois groupes : 60 fichiers, 466 tests réussis et 1 échec attendu.

## 5. Décisions et blocages

| Code | Sujet | État |
| --- | --- | --- |
| D-01 | Hébergement | **Tranché** : Vercel, avec Cloudflare devant |
| D-02 | Commits | **Tranché** : commits locaux autorisés, jamais de push |
| D-03 | OCR et IA | **Tranché** : CSV, XLSX et PDF texte en local. Photos et manuscrit par un fournisseur externe, désactivé tant que le fournisseur, le budget et la clé ne sont pas fixés |
| D-04 | Proxy Cloudflare devant Vercel (DNS seul ou proxy) | À trancher au moment de relier le domaine |
| D-05 | Files d'attente gérées (Vercel Queues ou Cloudflare Queues) | Pas avant mesure ; table de tâches Neon d'abord |
| D-06 | Retirer `@opennextjs/cloudflare` et les fichiers Workers | Décision du propriétaire (aucune suppression sans accord) |
| B-1 | Préproduction Neon et Vercel | **Bloquant** pour les tests de charge, les tests de bout en bout réels, et la vérification des sauvegardes et de la restauration |
| B-2 | Imprimantes physiques | **Bloquant** pour certifier la compatibilité matérielle |
| B-3 | Jeu de cahiers réels autorisés et anonymisés | **Bloquant** pour mesurer la lecture du manuscrit |
