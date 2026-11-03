# Qadr Capture : étude des modèles et protocole d'évaluation

**Statut : étude technique (mission 12, lot L4), rédigée le 2026-11-03.** Ce document ne livre aucun code, aucune dépendance, aucune migration. Aucun document n'a été envoyé à un service externe et aucun modèle n'a été exécuté : **aucune latence ni précision n'a été mesurée par Qadr Ops**. Les chiffres cités viennent des sources indiquées entre crochets (liste au § 8, toutes consultées le 2026-11-03). Ce que les sources ne confirment pas est marqué **non vérifié**.

Documents liés : `docs/imports.md` (import CSV/XLSX livré), `docs/engineering/decisions.md` (D-03), `docs/engineering/mission-12-plan.md` (lots L2, L4, L5).

## 0. Point de départ et écart à signaler

Ce qui existe dans `apps/web/src/lib/imports/` :

- `spreadsheet.ts` : lecture CSV/XLSX, limites (2 Mo, 1 000 lignes), détection du type par les premiers octets.
- `adapt.ts` : dictionnaire de colonnes fr/en/ar, lecture des montants XOF et des quantités sans deviner les cas ambigus, rapprochement déterministe (référence, nom normalisé, alias du commerce, similarité de Dice sur bigrammes ≥ 0,78 **et** mêmes nombres).
- `matching-eval.fixture.ts` + `adapt.test.ts` : 32 produits, 63 cas synthétiques, 0 faux rapprochement « certain ».
- `document-text.ts` : interface `DocumentTextExtractor`, seule implémentation **désactivée** ; PDF et photos refusés (`import_document_reader_disabled`).

**Écart entre deux textes du dépôt.** `decisions.md` (D-03, 2026-11-01) dit : « Lecture locale pour CSV, XLSX et PDF texte. Photos et manuscrit via un fournisseur externe, derrière un adaptateur, désactivé tant que le fournisseur, le budget et la clé ne sont pas validés. » Le plan de la mission 12 (§ 4, point 5) résume D-03 par « local d'abord ». Ce document suit la lettre de D-03 pour le manuscrit (fournisseur externe possible, après accord) et propose, **sans le décider**, d'essayer d'abord un OCR local pour l'imprimé. Le propriétaire tranche (proposition ajoutée au plan, § 4).

## 1. Chaîne cible

Chaque étape produit une sortie conservée et relisible ; aucune étape n'écrit dans le catalogue, le stock ou les dettes. Seule la dernière passe par les services métier.

```
 1. Acquisition       envoi (direct vers R2 par URL signée, lot L2), type réel par octets, taille, pages,
                      dimensions, commerce de la session, SHA-256 (même fichier = même import)
 2. Prétraitement     orientation, rotation, redressement, contraste, détection flou/coupe/page manquante
                      → avertissement « photo trop floue », jamais un rejet silencieux
 3. Extraction        3a. texte natif PDF (pas d'OCR si la page a une couche texte)
                      3b. OCR imprimé (pages scannées, photos de documents imprimés)
                      3c. HTR manuscrit (cahiers, registres) — seulement après benchmark (§ 4)
                      3d. structure : lignes, colonnes, cellules de tableau, ordre de lecture (RTL compris)
 4. Provenance        page, boîte englobante, n° de ligne, texte brut reconnu, moteur + version, confiance
                      brute du moteur (non calibrée tant que non évaluée)
 5. Classification    type proposé : catalogue, stock de départ, dettes, achats, dépenses… (question si doute)
 6. Normalisation     chiffres arabes, séparateurs, unités, abréviations ; l'original reste intact à côté
 7. Mapping           colonnes → champs métier (réutilise inferMapping/matchHeader d'adapt.ts)
 8. Rapprochement     a. exact (référence, nom normalisé)    b. alias confirmés du commerce
                      c. flou (Dice actuel)                 d. vectoriel éventuel (§ 2.6), jamais « certain »
                      toujours filtré par business_id
 9. Revue humaine     image source à côté de la valeur extraite, correction par ligne, reprise plus tard
10. Import            services existants (insertProduct, writeStockOpening…), transaction, runIdempotent,
                      assertBusinessOperational, audit
```

Rappels :

- **Les embeddings ne lisent pas les images.** Un modèle comme BGE-M3 transforme un *texte* en vecteur. Il intervient à l'étape 8, après qu'un OCR ou un HTR a produit du texte. Il ne remplace ni l'OCR ni la revue.
- Les étapes 2 à 6 sont des **hypothèses** : la valeur extraite n'a jamais plus d'autorité que la cellule d'un tableur aujourd'hui (même cycle `needs_review` / décision `user` jamais écrasée).
- Un PDF « texte » peut contenir des pages scannées : la décision 3a/3b se prend **par page**.

## 2. Comparatif des candidats

Légende : « Langues » indique ce que la source affirme ; « fr » et « ar » sont cochés seulement si la source les nomme. Aucune latence n'a été trouvée dans une source officielle pour du matériel comparable au nôtre : la colonne donne un ordre de grandeur **non vérifié** ou « non publié ».

### 2.1 Texte natif des PDF (étape 3a), dans Node

| Candidat | Licence | Dépendances, taille | Points vérifiés | Remarques |
| --- | --- | --- | --- | --- |
| `unpdf` 2.1.0 | MIT [S20] | aucune dépendance npm déclarée, ~3,2 Mo décompressés, `node >= 24` [S20] | Embarque une version serverless de PDF.js (v6.4.299), worker inclus ; extrait texte et éléments **positionnés** ; `inspectPages` signale les pages probablement scannées [S19] | Le projet est en Node 24 : compatible. Le rendu d'une page en image demande `@napi-rs/canvas` (optionnel) [S19]. |
| `pdfjs-dist` 6.5.438 | Apache-2.0 [S18][S20] | ~37,6 Mo décompressés [S20] | Paquet npm précompilé de PDF.js [S18] | Plus lourd ; usage Node non décrit sur la page du dépôt [S18] (**non vérifié**). |
| Écrire un lecteur maison | — | — | — | Déconseillé : flux compressés, polices, encodages CID, texte arabe (ordre visuel vs logique). Le générateur PDF maison des exports (`src/lib/exports/`) n'écrit que du WinAnsi ; il ne prouve rien pour la lecture. |

Point d'attention commun : dans un PDF, l'arabe peut être stocké en ordre **visuel** ou avec des formes de présentation. La remise en ordre logique est à tester sur le corpus (§ 4) ; **non vérifié**.

### 2.2 OCR de texte imprimé (étape 3b)

| Candidat | Licence code | Licence poids | Commercial | fr / ar imprimé | Manuscrit | Taille | Matériel | Version vue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **PaddleOCR** (PP-OCRv5 multilingue) | Apache-2.0 [S1][S21] | Apache-2.0 sur Hugging Face pour `arabic_PP-OCRv5_mobile_rec` et `latin_PP-OCRv5_mobile_rec` [S3][S4] | oui (Apache-2.0) | Latin : français nommé dans la doc multilingue [S2] ; arabe : modèle dédié [S2][S3] | non annoncé pour PP-OCRv5 | « 2M parameters » pour le modèle multilingue [S1] ; ~7,7 Mo par modèle ONNX selon un miroir tiers [S2b] (**non vérifié** officiellement) | CPU listé (accélération OpenVINO citée) [S1] | v3.7.0 du 2026-06-11 [S21] |
| PaddleOCR PP-OCRv6 | Apache-2.0 [S1] | **non vérifié** | **non vérifié** | 46 langues latines (français non nommé) [S1] ; arabe **non annoncé** | non | 1,5M / 7,7M / 34,5M [S1] | CPU listé [S1] | annoncé dans le README [S1], absent de la dernière *release* GitHub (v3.7.0) [S21] |
| **Tesseract** 5.5.4 | Apache-2.0 [S5] | `tessdata_best` (`fra`, `ara` présents) : Apache-2.0 [S7] | oui | « more than 100 languages » [S5] ; fra et ara fournis [S7] | FAQ : « it won't work very well, as Tesseract is designed for printed text » [S6] | quelques Mo par langue (**non vérifié**) | CPU (moteur LSTM) [S5] | 5.5.4 du 2026-10-28 [S22] |
| `tesseract.js` 7.0.0 | Apache-2.0 [S8][S20] | mêmes fichiers `traineddata` | oui | idem Tesseract | idem | ~1,4 Mo + cœur WASM [S20] | WASM, Node et navigateur [S8] | 7.0.0 [S21] |
| **docTR** 1.1.0 | Apache-2.0 [S9][S21] | **non vérifié** (hébergement et licence des poids non indiqués sur la page) | **non vérifié** | vocabulaires `french`, `arabic`, `multilingual` existent [S10] ; ce sur quoi les modèles pré-entraînés sont entraînés n'est pas indiqué [S10] | non annoncé | non publié | PyTorch ; images Docker « GPU-ready » [S9] | v1.1.0 du 2026-08-21 [S21] |
| **Surya** 0.23.0 | Apache-2.0 [S11] | « modified AI Pubs Open Rail-M » : libre pour recherche, usage personnel et « startups under $5M funding/revenue », sinon licence commerciale [S11] | **sous condition** de chiffre d'affaires / financement | 91 langues évaluées ; arabe : 45,4 % de réussite au banc de l'éditeur [S11] | non revendiqué ; l'éditeur renvoie vers son API pour les documents difficiles [S11] | non publié | GPU (vLLM) ou CPU (llama.cpp) [S11] | v0.23.0 du 2026-10-29 [S21] |

Lecture : PaddleOCR (modèles mobiles latin + arabe) et Tesseract sont les deux candidats locaux dont **code et poids** sont sous licence permissive vérifiée. docTR reste candidat sous réserve de vérifier la licence des poids. Surya est écarté par défaut (licence des poids conditionnelle, score arabe publié faible).

Les précisions publiées par PaddleOCR (84,7 % latin, 81,27 % arabe, « une ligne est fausse si un seul caractère l'est ») [S2][S3][S4] portent sur **leurs** jeux de test. Elles ne disent rien de nos cahiers, de nos photos ni de nos montants.

### 2.3 Manuscrit (HTR, étape 3c)

| Candidat | Licence | fr | ar | Point bloquant |
| --- | --- | --- | --- | --- |
| **Kraken** 7.1 + **eScriptorium** | Kraken Apache-2.0 [S12][S21] ; eScriptorium MIT [S13] | à entraîner | à entraîner ; RTL et BiDi pris en charge [S12b] (l'arabe n'est pas nommé [S12b]) | Pensé pour le matériel historique et les écritures non latines [S12]. Modèles publics sur Zenodo (HTRMoPo) [S12b], **aucun modèle vérifié pour un cahier de commerce moderne**. Utile surtout comme **outil d'annotation et d'entraînement** (eScriptorium). Linux/macOS seulement [S12]. |
| **TrOCR** `microsoft/trocr-base-handwritten` | MIT [S14] | **non** : affiné sur IAM [S14] (anglais, langue non précisée sur la page) | non | Une seule ligne par image [S14] : demande une détection de lignes en amont. 0,3B paramètres [S14]. |
| `agomberto/trocr-large-handwritten-fr` | MIT déclaré (via recherche) [S15] | oui (recensement français, archives) | non | Données d'archives (noms, métiers, villes), pas de montants ni de cahiers de boutique ; licence des jeux d'entraînement à vérifier [S15]. **Non vérifié** sur la page du modèle. |
| Modèles arabes entraînés sur **KHATT** (ex. `FixFips/arabicocr-khatt`, MIT déclaré) | variable [S16] | — | oui (lignes manuscrites) | La licence du **jeu KHATT** semble limitée à la recherche [S16] : usage commercial **non vérifié**, revue juridique nécessaire. Un modèle voisin (`Karez/KHLR`) est CC BY-NC [S16]. |
| **PaddleOCR-VL** (0,9B, « 1.0B params » selon les métadonnées) | Apache-2.0 (poids) [S17] | non nommé (« 109 languages ») [S17] | nommé [S17] | Se dit adapté au « handwritten text » [S1][S17] sans chiffre pour le manuscrit. Un GPU est réaliste (exemple CUDA ; repli CPU possible dans l'exemple Transformers) [S17]. Service vLLM documenté [S17]. **Seul candidat ouvert à licence permissive vérifiée qui revendique le manuscrit arabe** : à tester en priorité au banc. |

Conclusion HTR : **aucun modèle ouvert n'a de résultat publié sur des cahiers de commerce en français ou en arabe**. Toute promesse serait inventée. Le manuscrit reste désactivé jusqu'au benchmark du § 4.

### 2.4 Modèles de vision et de compréhension documentaire (pièges de licence)

| Modèle | Licence des poids | Commercial | Note |
| --- | --- | --- | --- |
| PaddleOCR-VL | Apache-2.0 [S17] | oui | voir § 2.3 |
| Qwen2.5-VL-**3B**-Instruct | **Qwen RESEARCH LICENSE** : « FOR NON-COMMERCIAL PURPOSES ONLY » [S23b] | **non** sans licence | page du modèle sans licence affichée [S23] ; il faut lire le fichier `LICENSE` |
| Qwen2.5-VL-**7B**-Instruct | Apache-2.0 [S24] | oui | « 8B params » selon les métadonnées [S24] ; GPU nécessaire en pratique (**non vérifié**) |
| Surya | Open Rail-M modifiée [S11] | sous condition | voir § 2.2 |

Leçon : dans une même famille, la licence change selon la taille. **La licence se lit dans le fichier `LICENSE` de chaque dépôt de poids**, jamais dans un article ou un comparatif.

Un modèle de vision généraliste ne doit jamais remplir directement un champ métier : sa sortie suit le même chemin que l'OCR (provenance, normalisation, revue). Les hallucinations sur un montant (chiffre inventé, unité ajoutée) sont le risque principal ; aucune source consultée ne le quantifie.

### 2.5 API hébergées (soumises à l'accord du propriétaire, D-03)

Aucune n'est activée. Toute activation demande : décision écrite, budget plafonné et clé. Les conditions ci-dessous viennent des pages officielles lues le 2026-11-03.

| Service | fr imprimé | ar imprimé | fr manuscrit | ar manuscrit | Prix publié | Conservation / entraînement |
| --- | --- | --- | --- | --- | --- | --- |
| **Azure Document Intelligence** (Read/Layout v4.0) | oui | oui | oui | oui (v4.0 ; absent de la v3.1) [S25] | 500 pages/mois gratuites (F0) ; prix payant **non affiché** par la page lue [S26] | entrées et résultats conservés **24 h** puis supprimés, suppression anticipée possible par API ; traitement dans la région de la ressource [S27]. Entraînement : la page ne le dit pas (**non vérifié**). |
| **Google Document AI** (Enterprise Document OCR) | oui | oui | oui | oui [S28] | 1,50 $ / 1 000 pages jusqu'à 5 M pages/mois, 0,60 $ au-delà ; modules complémentaires 6 $ / 1 000 pages (lu via un extrait du moteur de recherche de la page officielle [S29], la page n'a pas pu être rendue : **à reconfirmer**) | requêtes en ligne : traitées en mémoire, non écrites sur disque ; lots : supprimés en général tout de suite, durée maximale un jour ; « never use[s] customer data to train our Document AI models » [S30] |
| **Mistral OCR** | « more than 40 languages » (liste non lue) [S31] | **non vérifié** | **non vérifié** | **non vérifié** | non affiché sur la page officielle [S32] ; sources tierces contradictoires (2 à 4 $ / 1 000 pages) : **non vérifié** | rétention zéro (ZDR) sur demande, pour les appels compatibles, plans payants ; refus de l'entraînement distinct de la ZDR [S33]. Valeur par défaut pour l'API : **non vérifiée** (sources tierces divergentes). |
| **Amazon Textract** | oui | **non** : « English, Spanish, German, Italian, French, and Portuguese » [S34] | non vérifié | **non** | non lu | non lu |

Textract est écarté (pas d'arabe). Toute API implique un transfert de documents de commerces ivoiriens hors du pays : **revue juridique nécessaire** (protection des données personnelles en Côte d'Ivoire), non faite ici.

### 2.6 Embeddings et recherche vectorielle (étape 8d)

| Candidat | Licence | Taille | Dimension | Langues | Note |
| --- | --- | --- | --- | --- | --- |
| **BGE-M3** (`BAAI/bge-m3`) | MIT [S35] | XLM-RoBERTa, 24 couches, 1 024 de largeur [S36] (≈ 0,57 Md de paramètres déduits de cette architecture, **non publié** sur la page) | 1 024 [S35] | « more than 100 working languages », fr et ar **non nommés** [S35] | dense, creux et multi-vecteurs ; 8 192 jetons [S35] |
| `intfloat/multilingual-e5-small` | MIT [S37] | non lu | non lu | 93 codes de langue déclarés [S37] (présence de `fr`/`ar` **non vérifiée** ligne à ligne) | plus petit, à comparer à BGE-M3 |
| **pgvector** sur Neon | PostgreSQL License [S38b] | — | HNSW : 2 000 dims (`vector`), 4 000 (`halfvec`) [S38][S39] | — | disponible sur toutes les offres Neon, sans supplément ; `CREATE EXTENSION vector` par base ; 0.8.0 donné en exemple chez Neon [S38], 0.8.7 sur le dépôt [S39] |

1 024 dimensions tiennent dans la limite HNSW de `vector`. Les vecteurs doivent porter `business_id`, et toute requête doit filtrer par commerce **avant** le tri de similarité.

Où calculer les vecteurs ? Le modèle ne lit pas d'images, mais il reste un réseau de plusieurs centaines de Mo : même service séparé que l'OCR (§ 3). Une API d'embeddings serait aussi un envoi de données à un tiers (noms de produits) : décision D-03 également.

**Recommandation : ne pas ajouter de vecteurs maintenant.** Le rapprochement actuel n'a raté aucun produit du jeu synthétique (`docs/imports.md`) ; on ne sait pas encore s'il échoue sur de vrais fichiers. Le vectoriel ne sera ajouté que si le protocole du § 4 montre des produits manqués que le flou ne retrouve pas (synonymes, langues croisées fr↔ar). Même alors, un résultat vectoriel ne vaut jamais plus que « probable ».

### 2.7 Hébergement : ce que Vercel permet

D'après la documentation Vercel [S40] : fonctions Node jusqu'à 4 Go / 2 vCPU (Pro), 2 Go / 1 vCPU (Hobby) ; durée maximale 300 s (Hobby), 800 s (Pro) ; paquet de 250 Mo décompressés (jusqu'à 5 Go en bêta « large functions ») ; corps de requête limité à **4,5 Mo**. **Aucun GPU n'est mentionné.**

Conséquences :

- **3a (texte natif PDF) peut tourner dans Vercel** : `unpdf` pèse ~3 Mo, sans dépendance.
- **OCR, HTR, vision et embeddings : service séparé.** Un OCR CPU léger (Tesseract WASM) tiendrait peut-être dans une fonction, mais chaque page consommerait du temps CPU facturé, avec un risque de délai dépassé sur un document de plusieurs pages ; **non mesuré**. Un modèle de vision (PaddleOCR-VL) demande un GPU : impossible sur Vercel.
- Les photos dépassent souvent 4,5 Mo : l'envoi doit aller directement vers R2 par URL signée (lot L2), le service d'OCR lit ensuite l'objet.

Options pour le service séparé (prix lus le 2026-11-03, sans compte créé) :

| Option | Coût minimal | Remarques |
| --- | --- | --- |
| **Google Cloud Run** (conteneur CPU) | gratuit sous 180 000 vCPU-s, 360 000 Gio-s et 2 M requêtes par mois, puis ~0,000024 $/vCPU-s et ~0,0000025 $/Gio-s (niveau 1) [S41] : chiffres lus via extraits de la page officielle, à **reconfirmer** | mise à zéro possible (pas de coût à vide), démarrage à froid ; compte de facturation obligatoire ; ce n'est pas l'API Document AI (aucun document ne sort vers un service d'IA tiers, mais il est hébergé chez Google) |
| **Hetzner Cloud** (VPS) | à partir de 6,49 € HT/mois (« Regular Performance ») [S42] ; configuration (vCPU, RAM) non lue | coût fixe et prévisible, Allemagne/Finlande ; à administrer (mises à jour, sauvegardes) |
| GPU (pour PaddleOCR-VL ou HTR) | **non chiffré** | seulement si le benchmark le justifie ; à étudier à ce moment-là |

## 3. Recommandation par étapes

Chaque étape est indépendante, désactivable, et ne change pas le cycle de revue existant.

**Étape 1 : PDF textuels natifs (sans OCR)**

- Où : dans Vercel, dans la même route d'import.
- Comment : `unpdf` (MIT) ou `pdfjs-dist` (Apache-2.0), à choisir au moment du lot L5 ; dépendance à inscrire dans `dependencies-and-skills.md`.
- Texte positionné → lignes et colonnes → mêmes `inferMapping` et `matchProduct` qu'un tableur.
- Pages sans couche texte : refusées, avec le message actuel (« lecture des PDF scannés pas activée »).
- Coût : aucun fournisseur ; temps CPU Vercel **non mesuré**.
- Prérequis : lot L2 (conservation de l'original dans R2).

**Étape 2 : OCR imprimé local, après un mini-banc**

- Candidats : PaddleOCR PP-OCRv5 (modèles latin + arabe, Apache-2.0) contre Tesseract 5.5.4 (`fra`+`ara`, Apache-2.0).
- Le banc (§ 4, strates « imprimé ») départage, avec docTR en troisième si la licence de ses poids est confirmée.
- Où : un conteneur HTTP privé (Cloud Run ou VPS) qui reçoit une référence d'objet R2 et le `businessId`, et renvoie lignes + boîtes + confiance brute.
- Travail asynchrone via une table de tâches dans Neon (décision du 2026-11-01).
- Coût mensuel minimal, avec ces **hypothèses** :
  - Cloud Run : ≈ 0 € tant que le volume reste dans l'offre gratuite. Calcul de dimensionnement, à remplacer par la mesure : à 5 s par page sur 2 vCPU / 4 Gio, une page coûte 10 vCPU-s et 20 Gio-s, donc l'offre gratuite couvre environ 18 000 pages/mois. Les 5 s sont une **hypothèse**, pas une mesure.
  - Ou VPS : ≥ 6,49 € HT/mois, quel que soit le volume.

**Étape 3 : manuscrit (HTR)**

- Rien n'est livré avant le benchmark.
- Banc à quatre bras, sur le même corpus manuscrit :
  1. PaddleOCR-VL (ouvert, Apache-2.0) ;
  2. Azure Read v4.0 (fr + ar manuscrits annoncés) ;
  3. Google Enterprise Document OCR (fr + ar manuscrits annoncés) ;
  4. référence humaine (saisie directe).
- Les bras 2 et 3 exigent d'abord l'accord D-03 : budget plafonné et corpus **synthétique seulement**, jamais de document de client pour un premier essai.
- Si aucun bras n'atteint les seuils fixés après mesure, le manuscrit reste désactivé. L'interface propose alors la saisie assistée (le commerçant tape, le rapprochement aide).

**Étape 4 (conditionnelle) : vectoriel.** pgvector + BGE-M3 ou multilingual-e5, seulement si le § 4 montre des produits manqués que le flou ne retrouve pas.

**Stratégie de sortie.**

- Tout passe par les interfaces du § 5 : le format de sortie (lignes, boîtes, provenance) est le nôtre, pas celui du fournisseur.
- Les modèles retenus sont sous Apache-2.0 ou MIT : on peut les héberger ailleurs.
- Une API se remplace par une autre derrière le même `PrintedTextRecognizer` / `HandwritingRecognizer`, sans migration de données.

**Service indisponible, quota épuisé, clé absente.**

- Le document reste stocké, l'import passe à « en attente de lecture » et la progression est conservée.
- Le commerçant peut saisir les lignes à la main dans le même écran de revue.
- Aucun basculement automatique vers une API payante ; aucun message technique affiché.
- Un plafond mensuel de pages par commerce et global coupe les appels payants (télémétrie : nombre de pages, durée, coût estimé, **sans contenu**).

## 4. Protocole d'évaluation

### 4.1 Métriques (calculées séparément par langue fr / en / ar / mixte et par type de document)

| Métrique | Définition | Remarque |
| --- | --- | --- |
| CER / WER | erreurs de caractères / mots sur le texte de chaque ligne, après normalisation documentée (espaces, chiffres arabes → occidentaux) | diagnostic du moteur, pas un critère métier |
| Détection des lignes | rappel et précision des lignes du document (une ligne manquée = un article oublié) | une ligne manquée est plus grave qu'une ligne en trop |
| Exactitude des champs | égalité exacte après normalisation, champ par champ : quantité, prix de vente, prix d'achat, date, unité, signe | rapportée **par champ** ; un montant faux de 1 chiffre est faux |
| Abstention | part des champs marqués « illisible » ou « ambigu » au lieu d'une valeur | une abstention juste vaut mieux qu'une valeur fausse ; on mesure les deux |
| Valeurs fausses non signalées | champs faux présentés **sans** avertissement | métrique de sécurité principale |
| Rapprochement | précision des rapprochements « certains » ; rappel top-1 et top-5 des propositions | sur le catalogue synthétique du commerce |
| Faux positifs de fusion | lignes rattachées à tort à un produit existant (« certain » ou accepté tel quel) | règle de trois : 0 erreur sur n cas donne une borne haute à 95 % de 3/n |
| Lignes acceptées sans correction | part des lignes confirmées sans aucune modification par l'annotateur | mesurée dans l'écran de revue réel |
| Temps de correction | médiane et 90e centile par page, mesurés par horodatage dans l'écran de revue | comparé à la saisie manuelle de la même page |
| Coût par page | secondes CPU/GPU × prix, ou prix API ; plus le temps humain de correction | hypothèses écrites à côté |
| Calibration | seulement si une confiance sert à décider : diagramme de fiabilité, erreur de calibration | sinon la confiance n'est **jamais** affichée comme une probabilité |

### 4.2 Taille minimale du corpus

Ces tailles découlent de la précision statistique voulue. Ce ne sont pas des seuils de qualité.

- **Proportions** (exactitude d'un champ, lignes acceptées) : pour une marge de ±5 points à 95 % dans le pire cas (p = 0,5), il faut ≈ 385 observations ; pour ±10 points, ≈ 97. Proposition : **≥ 400 lignes annotées par strate** (langue × type de document × imprimé/manuscrit), soit ≥ 30 pages par strate.
- **Faux positifs de fusion** : pour affirmer un taux inférieur à 1 % avec zéro erreur observée, il faut **≥ 300 cas « produit différent mais proche »** (règle de trois). Pour 0,5 % : ≥ 600 cas.
- Strates minimales : {fr, ar, mixte fr/ar} × {PDF natif, imprimé scanné, photo d'imprimé, manuscrit}. L'anglais est mesuré, mais il est moins prioritaire pour le marché ivoirien.

### 4.3 Corpus synthétique

Tout est fabriqué, et chaque fichier est marqué `SYNTHÉTIQUE` dans son nom et ses métadonnées. **Aucun ne doit être présenté comme un document réel.**

1. **Catalogues de référence** : prolonger `matching-eval.fixture.ts`.
   - Quatre commerces fictifs (quincaillerie, alimentation générale, téléphonie, vêtements), 150 à 300 articles chacun, avec variantes proches (50 kg / 25 kg, 3 m / 4 m, couleurs, capacités).
   - Environ 15 % des noms en arabe, 10 % d'alias.
2. **Générateur de documents**, depuis ces catalogues et des quantités/prix tirés au hasard avec une graine fixe :
   - listes de prix, états de stock, factures fournisseurs et listes de dettes ;
   - en fr, ar, en et mixte ;
   - avec les formats observés dans `adapt.ts` : `5 500 F CFA`, `12.500`, chiffres arabes `١٢٠٠`, `1,250` ambigu, abréviations « Qté », « P.V », unités collées ;
   - colonnes sans titre, lignes dans le désordre, totaux de bas de page à ne pas importer.
   La vérité terrain JSON (une entrée par ligne et par champ, valeur attendue ou `ambiguous`) est produite par le générateur.
3. **PDF natifs** : rendus directement depuis le générateur, avec et sans couche texte, dont l'arabe en ordre logique et en formes de présentation.
4. **Images dégradées** : rendu des PDF en images, puis rotations ±1 à 8°, flou, compression JPEG forte, faible contraste, ombre, perspective, plis et coupe partielle.
   Paramètres enregistrés par image, pour relier chaque erreur au défaut qui la cause.
5. **Photos réelles de documents fictifs** : documents du générateur imprimés sur papier ordinaire et ticket thermique, photographiés par l'équipe avec plusieurs téléphones d'entrée de gamme, sous plusieurs éclairages.
6. **Manuscrit fictif** :
   - contenus du générateur recopiés à la main dans des cahiers d'écolier et sur des registres ;
   - écrits par des volontaires adultes de l'équipe ou de leur entourage, après consentement écrit (fr et ar) ;
   - au moins 5 scripteurs par langue, car les écritures varient plus d'une personne à l'autre que d'une page à l'autre ;
   - la vérité terrain est celle du générateur ; les erreurs de recopie sont corrigées lors d'une relecture humaine.

Limite à écrire dans chaque rapport : ce corpus reproduit des formes que l'équipe connaît déjà. Comme le jeu d'essai de rapprochement, il ne remplace pas des documents de commerçants.

### 4.4 Documents réels : anonymisation et autorisation

- Documents de commerçants utilisés seulement avec un **accord écrit** du commerçant (but, durée, droit de retrait) et l'accord du propriétaire de Qadr Ops.
- **Masquage avant annotation** : noms et téléphones de clients, numéros de compte, montants de dette nominatifs. Le masquage est fait par une personne habilitée, dans un espace privé (R2 privé, lot L2), jamais dans Git.
- **Aucun envoi à une API tierce**, même pour l'évaluation, sans décision D-03 couvrant ce cas.
- Accès nominatif et journalisé. Durée de conservation fixée d'avance ; suppression à l'issue, avec preuve.
- Fiche du jeu d'essai : taille, provenance (secteurs, villes, langues), méthode de masquage, limites, date.

### 4.5 Seuils

**Aucun seuil n'est fixé dans ce document.** Les seuils d'activation (par exemple un plafond de valeurs fausses non signalées sur les montants, ou un gain de temps minimal face à la saisie manuelle) sont proposés **après** une première mesure, puis validés par le propriétaire. `adapt.test.ts` montre la pratique à suivre : une fois mesurés et acceptés, les résultats deviennent des tests qui échouent s'ils se dégradent.

## 5. Interfaces proposées (non implémentées)

Elles suivent les conventions de `document-text.ts` : `provider` et `enabled` en lecture seule, erreur à `code` stable, commerce transmis à chaque appel, aucune variable d'environnement lue par l'interface elle-même. `DocumentTextExtractor` existe déjà ; il deviendrait l'orchestrateur, appuyé sur les briques ci-dessous.

```ts
// Provenance commune à toute valeur extraite (étape 4).
type SourceSpan = { page: number; line: number; box: [x0: number, y0: number, x1: number, y1: number] | null };
type RecognizedLine = {
  span: SourceSpan;
  text: string;                     // texte brut, jamais corrigé ici
  direction: "ltr" | "rtl" | "mixed";
  engineConfidence: number | null;  // brute, non calibrée tant que § 4.1 ne l'a pas évaluée
};
type EngineRun = { provider: string; model: string; modelVersion: string; durationMs: number; pages: number; estimatedCostXof: string | null };

/** 3a — couche texte native ; dit aussi quelles pages n'en ont pas. */
interface NativePdfTextExtractor {
  readonly provider: string;
  extract(input: { businessId: string; bytes: Buffer }): Promise<{ lines: RecognizedLine[]; pagesWithoutText: number[]; run: EngineRun }>;
}

/** 3b — imprimé. */
interface PrintedTextRecognizer {
  readonly provider: string; readonly enabled: boolean;
  readonly languages: readonly ("fr" | "en" | "ar")[];
  recognize(input: { businessId: string; objectKey: string; pages?: number[] }): Promise<{ lines: RecognizedLine[]; run: EngineRun }>;
}

/** 3c — manuscrit ; distinct de l'imprimé pour être activé, évalué et facturé à part. */
interface HandwritingRecognizer extends PrintedTextRecognizer {}

/** 3d — lignes, colonnes, cellules. */
interface LayoutAnalyzer {
  readonly provider: string;
  analyze(input: { businessId: string; lines: RecognizedLine[] }): Promise<{ rows: { span: SourceSpan; cells: { text: string; span: SourceSpan }[] }[] }>;
}

/** 5 — type de document proposé ; « unknown » pose une question au commerçant. */
interface DocumentClassifier {
  classify(input: { rows: string[][] }): { kind: "catalog" | "stock_opening" | "debts" | "purchases" | "expenses" | "unknown"; confidence: "certain" | "probable" | "ambiguous" };
}

/** 8d — texte vers vecteur ; ne lit jamais d'image. */
interface EmbeddingProvider {
  readonly provider: string; readonly model: string; readonly dimensions: number; readonly enabled: boolean;
  embed(input: { businessId: string; texts: string[] }): Promise<number[][]>;
}

/** 8 — rapprochement ; l'implémentation actuelle est matchProduct (adapt.ts). */
interface CandidateMatcher {
  match(input: { businessId: string; name: string; sku: string | null }): Promise<MatchResult>; // MatchResult d'adapt.ts
}
```

Règles attachées :

- `CandidateMatcher` combine, dans l'ordre : exact, alias du commerce, flou, vectoriel. Un candidat vectoriel seul ne peut jamais produire `level: "certain"`.
- Tout `businessId` vient de la session côté serveur. Une tâche asynchrone le relit et revérifie l'appartenance à chaque étape.
- `EngineRun` alimente la télémétrie de coût sans contenu du document.
- Les erreurs suivent le modèle de `DocumentReaderUnavailableError` : `document_reader_disabled`, `document_reader_quota`, `document_reader_unavailable`.

## 6. Ce qui n'est pas vérifié

- Toute latence ou précision sur nos documents : rien n'a été exécuté.
- Licence et hébergement des poids docTR ; licence des poids PP-OCRv6 ; présence du français dans PP-OCRv6.
- Prix payants d'Azure Document Intelligence et de Mistral OCR (pages officielles sans montant lisible) ; le prix Google n'a été lu que via un extrait de recherche.
- Paramètres par défaut de Mistral sur l'entraînement à partir des données d'API ; politique d'entraînement d'Azure (la page lue n'en parle pas).
- Licence commerciale du jeu KHATT et des données d'entraînement du TrOCR français.
- Présence de `fr`/`ar` nommée pour BGE-M3 ; caractéristiques détaillées de multilingual-e5-small.
- Offre gratuite Cloud Run en vigueur (extraits contradictoires selon le mode de facturation) ; configuration exacte du VPS Hetzner à 6,49 €.
- Régime juridique des transferts de données hors de Côte d'Ivoire.

## 7. Décision demandée au propriétaire

Ajoutée au plan de mission 12 (§ 4) comme proposition **non validée** :

1. Confirmer l'ordre des étapes 1 → 2 → 3.
2. Dire si l'OCR imprimé local (étape 2) est compatible avec D-03 tel qu'écrit, ou s'il faut amender D-03.
3. Autoriser (ou non), pour le seul banc manuscrit, un budget plafonné sur une API hébergée, avec corpus synthétique uniquement.

## 8. Sources (toutes consultées le 2026-11-03)

- [S1] https://github.com/PaddlePaddle/PaddleOCR (README)
- [S2] https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html (via recherche)
- [S2b] https://docs.rs/crate/oar-ocr/latest/source/docs/models.md (miroir tiers, non officiel)
- [S3] https://huggingface.co/PaddlePaddle/arabic_PP-OCRv5_mobile_rec
- [S4] https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec
- [S5] https://github.com/tesseract-ocr/tesseract
- [S6] https://tesseract-ocr.github.io/tessdoc/FAQ.html
- [S7] https://github.com/tesseract-ocr/tessdata_best
- [S8] https://github.com/naptha/tesseract.js
- [S9] https://github.com/mindee/doctr
- [S10] https://mindee.github.io/doctr/modules/datasets.html
- [S11] https://github.com/datalab-to/surya
- [S12] https://github.com/mittagessen/kraken ; [S12b] https://kraken.re/main/index.html
- [S13] https://gitlab.com/scripta/escriptorium
- [S14] https://huggingface.co/microsoft/trocr-base-handwritten
- [S15] https://huggingface.co/agomberto/trocr-large-handwritten-fr (via recherche)
- [S16] https://huggingface.co/FixFips/arabicocr-khatt, https://huggingface.co/Karez/KHLR (via recherche)
- [S17] https://huggingface.co/PaddlePaddle/PaddleOCR-VL
- [S18] https://github.com/mozilla/pdf.js
- [S19] https://github.com/unjs/unpdf
- [S20] https://registry.npmjs.org/{unpdf,pdfjs-dist,tesseract.js}/latest (version, licence, dépendances, taille)
- [S21] API GitHub `repos/{dépôt}` et `releases/latest` (PaddleOCR, docTR, kraken, Surya, tesseract.js)
- [S22] https://api.github.com/repos/tesseract-ocr/tesseract/releases/latest
- [S23] https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct ; [S23b] https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE
- [S24] https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
- [S25] https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/ocr
- [S26] https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/
- [S27] https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security
- [S28] https://docs.cloud.google.com/document-ai/docs/languages
- [S29] https://cloud.google.com/document-ai/pricing (extrait de recherche)
- [S30] https://docs.cloud.google.com/document-ai/docs/security
- [S31] https://docs.mistral.ai/capabilities/document_ai/basic_ocr/
- [S32] https://mistral.ai/pricing
- [S33] https://docs.mistral.ai/admin/monitor-comply/zero-data-retention (via recherche)
- [S34] https://docs.aws.amazon.com/textract/latest/dg/textract-best-practices.html
- [S35] https://huggingface.co/BAAI/bge-m3 ; [S36] https://huggingface.co/BAAI/bge-m3/raw/main/config.json
- [S37] https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md
- [S38] https://neon.com/docs/extensions/pgvector
- [S38b] https://raw.githubusercontent.com/pgvector/pgvector/master/LICENSE ; [S39] https://github.com/pgvector/pgvector
- [S40] https://vercel.com/docs/functions/limitations
- [S41] https://cloud.google.com/run/pricing (extraits de recherche)
- [S42] https://www.hetzner.com/cloud/
