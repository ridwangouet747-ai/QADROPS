# Qadr Capture / Adapt : import d'un catalogue

**Statut au 2026-11-01 (mission 11, phase 3) : implémenté et testé sur PGlite.** Rien n'a été vérifié sur PostgreSQL/Neon réel. Les migrations `0014` et `0015` ne sont appliquées à aucune base distante.

## Ce que le commerçant peut faire

1. Envoyer un fichier CSV ou Excel (`.xlsx`) depuis **Catalogue → Importer** (`/business/imports`).
2. Relire l'interprétation (`/business/imports/{id}`) :
   - confirmer les colonnes ;
   - voir chaque ligne du fichier à côté de ce que QADR OPS a compris ;
   - décider ligne par ligne : nouveau produit, produit existant ou ignorer ;
   - corriger une valeur sans modifier la cellule d'origine.
3. Fermer la page et reprendre plus tard : chaque décision est enregistrée aussitôt.
4. Confirmer explicitement l'import. Rien n'est écrit au catalogue avant cette confirmation.

Le même fichier (même empreinte SHA-256) envoyé une deuxième fois rouvre l'import existant au lieu d'en créer un autre.

## Lecture des fichiers (`src/lib/imports/spreadsheet.ts`)

| Limite | Valeur |
| --- | --- |
| Taille du fichier | 2 Mo |
| Lignes de données | 1 000 |
| Colonnes | 30 |
| Caractères par cellule | 300 (au-delà, tronqué) |
| XLSX : taille décompressée totale | 25 Mo (protection contre les bombes zip, taille déclarée et réelle) |
| XLSX : entrées de l'archive | 300 |
| Imports en relecture par commerce | 20 |

- **CSV** : UTF-8 (avec ou sans BOM), UTF-16 et Windows-1252. Le séparateur (`;`, `,`, tabulation, `|`) est détecté.
- **XLSX** : lu avec `read-excel-file` 9.3.12, version exacte, licence MIT. Seule la première feuille remplie est lue, et l'écran indique combien d'autres feuilles sont ignorées. Les nombres sont conservés sous forme de texte « machine », sans passer par un flottant.
- **Refusés avec un code stable** :
  - `.xls` ancien format : `import_legacy_xls` ;
  - classeur avec macros (archive contenant `vbaProject.bin`, comme un `.xlsm`) : `import_macros`. Les macros ne sont jamais exécutées ;
  - archive corrompue ou fichier binaire : `import_corrupt`, `import_binary` ;
  - fichier vide : `import_empty`.
- **PDF, photos (JPEG, PNG, WebP, HEIC) et cahiers** : reconnus par leurs premiers octets, pas par l'extension. Ils sont refusés avec le code `import_document_reader_disabled` (voir « Documents scannés »).
- Le type du fichier est déterminé par son contenu, jamais par son nom. Le nom est nettoyé : chemin et caractères de contrôle retirés.

## Interprétation (`src/lib/imports/adapt.ts`)

- **Colonnes**
  - Les titres sont reconnus à l'aide d'un dictionnaire français, anglais et arabe : « Désignation », « P.V », « Qté », « Selling price », « سعر البيع », etc.
  - Sans titres, le nom, l'unité et la référence sont déduits des valeurs. **Une colonne de nombres sans titre n'est jamais devinée** : le commerçant dit s'il s'agit d'un prix ou d'une quantité.
  - « Prix » seul est « probable » : il faut confirmer qu'il s'agit du prix de vente.
  - Chaque colonne porte une confiance : `certain`, `probable` ou `ambiguous`.
- **Montants XOF** : `5 500`, `5 500 F CFA`, `12.500`, `1.250.000` et les chiffres arabes `١٢٠٠` sont lus. Ne sont jamais devinés :
  - `2,5` et `12.5` : ambigus ;
  - `environ 3000` et `12,5O0` : illisibles ;
  - un montant négatif est refusé.
- **Quantités** : `1,250` peut valoir 1,25 ou 1 250. La quantité est donc signalée comme ambiguë.
- **Rapprochement avec le catalogue**, dans le seul commerce concerné :
  - critères : même référence, même nom normalisé, alias déjà confirmé, ou nom proche ;
  - la normalisation ignore accents, casse, ponctuation et unités collées, et unifie les graphies arabes (أ/إ/ا, ة/ه, signes diacritiques) ;
  - niveaux : `certain`, `probable`, `ambiguous`, `none`.
- **Décision proposée**
  - Le rattachement n'est automatique que si la correspondance est **certaine**.
  - Une correspondance probable ou ambiguë pose une question (« Un produit proche existe déjà »).
  - Sans candidat, la ligne propose un nouveau produit.
  - Une décision du commerçant n'est jamais écrasée.
- **Contrôles sur le fichier entier**
  - Doublons : même nom normalisé, même référence ou même produit rattaché qu'une ligne précédente. Seules les lignes suivantes sont signalées.
  - Lignes trop larges (`extra_cells`) : une ligne qui a plus de cases que le reste du fichier et que la ligne de titres (cas typique : `Savon,1,250,3`, un séparateur de milliers non protégé dans un CSV) attend une décision ou une correction du commerçant. Elle n'est jamais appliquée d'office.
  - `stock_existing` : avertissement non bloquant. Le produit rattaché a déjà du stock, donc la quantité du fichier n'est pas appliquée ; un inventaire sert à la corriger.

### Jeu d'essai du rapprochement (synthétique)

`src/lib/imports/matching-eval.fixture.ts` : catalogue de 32 produits de quincaillerie et de boutique (dont 2 en arabe et 1 alias), et 63 cas annotés à la main. Les mesures ci-dessous sont vérifiées par `adapt.test.ts`, qui échoue si elles se dégradent.

| Mesure | Résultat |
| --- | --- |
| Rapprochements « certains » (appliqués sans question) | 25, tous justes : **0 faux rapprochement certain** |
| Propositions (« probable » ou « ambigu », toujours soumises au commerçant) | 16 : 15 justes, 1 fausse (« Peinture bleue 5 L » proposée pour une autre couleur) |
| Produits du catalogue manqués | 0 |
| Articles absents du catalogue reconnus comme nouveaux | 22 sur 22 |

**Limites de cette mesure.** Le jeu d'essai est synthétique. Il a été écrit après l'algorithme, par la même personne, donc il est biaisé en sa faveur. Il ne remplace pas une évaluation sur de vrais fichiers de commerçants, anonymisés et autorisés. Il ne contient ni faute de frappe lourde, ni abréviation locale, ni document mixte réel.

## Application (`src/lib/domain/imports.ts`)

- **Permissions**
  - `product:create` est exigée pour tout l'import.
  - `inventory:adjust` est exigée si une quantité de départ est appliquée.
  - `product:update` est exigée si une ligne est rattachée à un produit existant.
  - Toute lecture et toute écriture filtrent par le commerce de la session.
- **Transaction et idempotence**
  - Les lignes prêtes sont appliquées par paquets de 200, dans une transaction avec `assertBusinessOperational`.
  - Chaque paquet est une opération idempotente `import.apply`, de clé `{clé}:{n}`.
  - Le découpage est stable, et les lignes sont verrouillées (`FOR UPDATE`) puis marquées `applied`. Rejouer avec la même clé, ou avec une autre, ne crée donc aucun doublon.
- **Produits**
  - Les produits sont créés par `insertProduct`, le service de `createProduct`, qui applique quota, catégorie et audit.
  - Un produit existant n'est jamais modifié : ni son nom, ni son prix.
- **Stock**
  - Les quantités passent par `writeStockOpening` : c'est un **stock de départ**, ni une vente ni un achat.
  - Les quantités ne s'appliquent qu'aux produits qui n'ont pas encore de stock.
- **Alias** : quand une ligne est rattachée sous un autre nom, ce nom devient un alias du produit pour ce commerce seulement. Le rapprochement sera « certain » au prochain import.
- **Audit** : `import.created`, `import.rows_applied`, `import.applied`, `import.discarded`.
- **Abandon** : les cellules lues des lignes non appliquées sont effacées, et le fichier peut être envoyé de nouveau. L'original conservé (ci-dessous) est supprimé aussitôt (`deletion_reason = import_discarded`).

### Fichier d'origine (mission 12, lot L2, `docs/storage-r2.md`)

- Quand un stockage privé est configuré (Cloudflare R2 en production, mémoire en test et en aperçu), l'original CSV/XLSX est gardé **tel quel** et rattaché à l'import (`import_batch.source_file_id` → `stored_file`, clé composée `(business_id, id)`).
- Le type est vérifié par son contenu (signature), jamais par l'extension ; un exécutable renommé ou un classeur à macros est refusé par le stockage.
- Conservation par défaut : **90 jours** (`QADR_STORAGE_IMPORT_RETENTION_DAYS`), puis suppression par le passage planifié quotidien. Taille maximale conservée : **2 Mio** (`QADR_STORAGE_IMPORT_MAX_BYTES`), la même que celle de l'import.
- **L'import ne dépend jamais du stockage.** Sans stockage configuré, ou si l'envoi échoue, l'import est créé normalement, l'original n'est pas gardé et l'écran l'indique (« Fichier d'origine non conservé »). Une ligne restée `pending` après un envoi échoué est nettoyée par le passage planifié au bout d'une heure.
- Téléchargement : `GET /api/business/imports/{id}/original`, permission `product:create` et commerce de la session. Réponse identique (404 « Fichier introuvable. ») pour un import d'un autre commerce, un import inconnu, un original non gardé, échu ou supprimé.

API :
- `GET`/`POST /api/business/imports` (envoi en `multipart/form-data`, champ `file`) ;
- `GET`/`PATCH /api/business/imports/{id}` (colonnes) ;
- `PATCH /api/business/imports/{id}/rows/{rowId}` ;
- `POST /api/business/imports/{id}/apply` ;
- `POST /api/business/imports/{id}/discard` ;
- `GET /api/business/imports/{id}/original` (fichier d'origine, s'il a été conservé).

## Documents scannés et photos (décision D-03)

`src/lib/imports/document-text.ts` définit l'interface `DocumentTextExtractor`, dont la seule implémentation est **désactivée**.

- Aucune variable d'environnement n'est lue : une clé déclarée ne suffit pas à activer un envoi vers un fournisseur.
- L'activation demande trois décisions du propriétaire : le choix du fournisseur (conservation, entraînement, localisation), le budget et la clé.
- Elle demande aussi un benchmark sur des cahiers représentatifs anonymisés.
- Tant qu'elle n'est pas faite, les PDF et les photos sont refusés avec un message clair, et aucun document ne quitte le serveur.

## Limites connues

- **Provenance**
  - Les cellules lues sont stockées (`import_row.cells`), avec le numéro de ligne d'origine ; l'original n'est gardé que si un stockage est configuré (voir plus haut).
  - La table `source_reference` prévue au plan 3.1 n'a pas été créée : `import_row` porte cette information pour les tableurs.
  - Le stockage R2 n'a **jamais été contacté en réel** (voir `docs/storage-r2.md` § Limites).
- **Pas de purge automatique** des imports abandonnés ou anciens (seul l'original stocké a une échéance). La durée de rétention des lignes reste à fixer.
- Un seul type d'import : le **catalogue**, avec le stock de départ. Dettes, fournisseurs et achats ne sont pas encore importables.
- Une seule feuille par classeur.
- **Données non appliquées**
  - Le prix d'achat d'une ligne sans quantité est ignoré, car le coût n'existe que sur un mouvement de stock.
  - Une catégorie archivée portant le même nom n'est pas réactivée en silence : le produit est créé sans catégorie.
- **Interface**
  - Sur un écran de 375 px en arabe, le dernier filtre des lignes (« Ignorées ») est dans une zone qui défile horizontalement, sans indication visuelle (composant partagé `SegmentedControl`, non modifié).
  - Les ressources de traduction ne gèrent pas les pluriels. Les résumés sont donc rédigés au format « libellé : nombre ».
- **Sécurité des envois** : l'envoi multipart s'appuie sur le cookie de session `SameSite=Lax`. Aucun contrôle supplémentaire de `Sec-Fetch-Site` n'est fait.
