# Exports des rapports (mission 11, phase 4)

Écran : **Rapports** (`/business/reports`), carte « Exporter ». Route unique :

```
GET /api/business/reports/export?format=xlsx|pdf|csv&period=daily|weekly|monthly|yearly|custom&date=…&startDate=…&endDate=…&lang=fr|en|ar
```

Les fichiers sont produits **côté serveur, en mémoire**, à chaque demande. Ils ne sont ni stockés, ni mis en cache (`cache-control: private, no-store`), ni journalisés. Aucune dépendance n'a été ajoutée : le classeur, le zip et le PDF sont écrits par le code du dépôt (`src/lib/exports/`).

## 1. Formats

| Format | Contenu | Langues |
| --- | --- | --- |
| **Tableau Excel** (`.xlsx`) | Une feuille Synthèse puis jusqu'à neuf feuilles détaillées (§ 2) | fr, en, ar (feuilles en RTL) |
| **Rapport PDF** (`.pdf`, A4) | Indicateurs de la période et de la précédente, évolution jour par jour, meilleurs produits, catégories, moyens d'encaissement, dépenses par catégorie, employés, notes | fr, en uniquement (§ 4) |
| **Résumé CSV** (`.csv`) | Le résumé du rapport, comme avant (`reportCsv`) | en-têtes fixes |

- Langue des en-têtes et des noms de feuilles : paramètre `lang` envoyé par l'écran, sinon cookie `qadr-locale`, sinon français. Les noms de produits, de clients ou de fournisseurs ne sont jamais traduits.
- Les noms de fichiers sont en ASCII : `qadr-ops-classeur-<début>-<fin>.xlsx`, `qadr-ops-rapport-<début>-<fin>.pdf`.

## 2. Feuilles du classeur

Ordre : Synthèse, Ventes, Produits, Stock, Clients, Dettes, Fournisseurs, Achats, Dépenses, Paiements. La Synthèse est placée en premier pour que le fichier s'ouvre sur les totaux (le plan la listait en dernier).

| Feuille | Lignes | Bornée par la période | Permission de lecture exigée |
| --- | --- | --- | --- |
| Synthèse | Indicateurs du rapport (période et précédente), feuilles absentes ou tronquées | oui | `report` |
| Ventes | Une ligne par vente : date locale, référence, statut, client, caissier, sous-total, remise, total, encaissé, reste dû | oui | `sale` |
| Produits | Une ligne par variante : nom, variante, SKU, code-barres, catégorie, unité, prix de vente, coût moyen (et s'il est connu), stock, seuil d'alerte | non (état actuel) | `product` |
| Stock | Mouvements de la période : date, produit, variante, motif, quantité signée, coût unitaire, auteur | oui | `inventory` |
| Clients | Nom, téléphone, observation, date de création | non | `customer` |
| Dettes | Par client : ventes impayées, reste dû sur ventes, dette de départ restante, total dû à la fin de la période | non | `customer` |
| Fournisseurs | Achats reçus, montant acheté, reste dû sur achats, dette de départ restante, total dû | non | `supplier` |
| Achats | Achats de la période : date, référence, fournisseur, statut, total, payé, reste dû | oui | `purchase` |
| Dépenses | Date, catégorie, description, moyen, montant, payé par | oui | `expense` |
| Paiements | Date, date de confirmation, vente, moyen, statut, montant, règlement de dette, encaissé dans la période, enregistré par | oui | `payment` |

- **Mêmes chiffres que le rapport** : les totaux viennent de `getCommercialReport` et les lignes suivent les définitions de `docs/reports.md`. Les tests d'intégration vérifient que la somme des lignes retombe sur les totaux du rapport (chiffre d'affaires, encaissements, créances clients, dettes fournisseurs). Aucun total n'est recalculé dans le navigateur.
- **Une feuille non autorisée est absente**, et la Synthèse le dit. Exemple : un gestionnaire de stock n'a ni la feuille Dépenses ni la feuille Paiements. Un rôle ne voit donc pas, ligne par ligne, plus que dans l'application.
- Dates : heure locale du commerce (`YYYY-MM-DD HH:MM`), écrites en texte.

## 3. Nombres et formules

- **Montants XOF** : `bigint` lus en chaînes puis écrits comme **nombres entiers** (format `#,##0`). Un entier au-delà de 2^53−1, qu'Excel ne sait pas représenter exactement, est écrit en texte plutôt qu'arrondi.
- **Quantités** (`numeric`) : écrites comme nombres sans perte jusqu'à 15 chiffres significatifs, en texte au-delà. Les quantités négatives (sorties de stock, écarts d'inventaire) **restent des nombres**.
- **Aucune formule active** : le classeur ne contient aucun élément `<f>`. Tout texte qui commence (éventuellement après des espaces) par `=`, `+`, `-`, `@`, une tabulation, un retour chariot, un saut de ligne ou leurs équivalents pleine chasse est écrit en texte avec le style « préfixe apostrophe » (`quotePrefix`) : il s'affiche tel quel et n'est jamais évalué. Les caractères interdits en XML sont retirés.
- **CSV** : `csvCell` est désormais partagé (`src/lib/exports/csv.ts`) par le résumé CSV des rapports et l'export d'inventaire. Un nombre simple (`-12`, `3.5`) reste un nombre ; tout autre texte dangereux reçoit une apostrophe. Correction du constat X-1 (les écarts négatifs d'inventaire devenaient du texte).
- Le zip est écrit avec une date fixe (1980-01-01) et l'indicateur UTF-8 : le même contenu donne le même fichier.

## 4. PDF et arabe

Le PDF utilise les polices standard Helvetica (encodage WinAnsi), sans police embarquée. Elles ne contiennent pas l'alphabet arabe, et la mise en forme arabe (liaisons, ordre bidirectionnel) n'est pas implémentée. Donc :

- **le rapport PDF n'existe qu'en français et en anglais** ; demandé en arabe, le serveur répond 422 `pdf_language_unsupported` ;
- en arabe, l'écran propose « PDF (en français) » et rappelle que le bouton **Imprimer** produit un rapport en arabe que le navigateur peut enregistrer en PDF ;
- un caractère hors WinAnsi (par exemple un nom de produit en arabe) est remplacé par `?`, et une note en fin de document le signale.

## 5. Limites

- **Période** obligatoire et bornée, comme les rapports : jour, semaine, mois, année, ou période libre de 1 à 366 jours dans le fuseau du commerce. Une période invalide est refusée (400).
- **Plafond : 5 000 lignes par feuille** (`EXPORT_LIMITS.rowsPerSheet`, `src/lib/domain/exports.ts`). Chaque requête lit au plus 5 001 lignes ; l'historique complet n'est jamais lu sans borne.
  - Feuilles de la période (Ventes, Stock, Achats, Dépenses, Paiements) : au-delà, l'export est **refusé** (422 `export_too_large`, « choisissez une période plus courte ») plutôt que de livrer une feuille incomplète qui fausserait les sommes.
  - Listes de référence (Produits, Clients, Dettes, Fournisseurs) : **tronquées** à 5 000 lignes, et la troncature est écrite dans la Synthèse.
- Les requêtes s'exécutent l'une après l'autre (une seule connexion).

## 6. Sécurité

- Commerce : toujours celui de la session (`getBusinessContext`, membre actif). Les paramètres `businessId` ou `actorUserId` ajoutés à l'URL sont ignorés (testé).
- Permissions (`src/lib/auth/permissions.ts`) : `report:read` pour tout export, puis la permission de lecture de chaque domaine pour sa feuille (§ 2). Aucune nouvelle permission n'a été créée. Sans `report:read` (caissier) : 403. Sans session : 401.
- Chaque requête SQL filtre par `business_id`, jointures comprises (clés composées). Un test crée deux commerces A et B, marque les données de B et vérifie qu'aucune ligne de B n'apparaît dans les feuilles ni dans les fichiers de A.
- Les erreurs renvoient `{ error, code }` sans contenu commercial ; rien du fichier n'est envoyé à Sentry, PostHog ou aux journaux. L'événement analytique `report_exported` ne porte que le format et le type de période.

## 7. Non pris en charge

- PDF en arabe (§ 4), polices embarquées, logo du commerce dans le PDF.
- Export `.xls` ou ODS, export planifié ou envoyé par e-mail, export de plusieurs commerces à la fois.
- Feuilles détaillées dans le PDF : le PDF reprend le rapport, le détail ligne par ligne est dans le classeur.
- Vérification manuelle : les classeurs ont été relus par programme (`read-excel-file`) et les PDF contrôlés par leur structure (table xref exacte), mais **ni ouverts dans Excel, LibreOffice ou un lecteur PDF réel, ni testés dans un navigateur** pendant cette phase.

## 8. Fichiers

- `src/lib/exports/csv.ts`, `zip.ts`, `xlsx.ts`, `pdf.ts` : générateurs sans dépendance, avec leurs tests unitaires.
- `src/lib/exports/report-summary.ts`, `report-workbook.ts`, `report-pdf.ts` : mise en forme du rapport.
- `src/lib/domain/exports.ts` : lecture des données (`getWorkbookExport`, `getReportExport`) ; tests d'intégration PGlite dans `exports.integration.test.ts`.
- `src/app/api/business/reports/export/route.ts` : route.
- `src/lib/i18n/messages/exports.ts` : textes fr/en/ar.
