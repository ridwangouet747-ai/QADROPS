# Export complet des données d'un commerce (mission 13)

`GET /api/business/data-export` renvoie une archive ZIP de **toutes** les données du commerce actif.
Elle complète les exports de rapports (`docs/exports.md` : CSV, XLSX, PDF d'une période).

## Règles

- **Qui** : le propriétaire du commerce uniquement (`member.role = owner`). Caissier, gérant, autre
  commerce : 403. Sans session : 401. Le commerce vient de la session ; aucun paramètre ni en-tête ne
  peut le changer (testé).
- **Quoi** : toutes les tables qui portent `business_id`, sauf les tables techniques listées dans
  `EXCLUDED_TABLES` (`lib/domain/data-export.ts`). Une nouvelle table est exportée par défaut ; le test
  `business-data-export.http.test.ts` fige la liste et impose une relecture à chaque ajout.
- **Secrets** : toute colonne dont le nom évoque un jeton, un secret, une empreinte, une clé ou une
  signature est retirée (`REDACTED_COLUMN`) ; le manifeste liste les colonnes retirées par table.
- **Format** : `manifest.json` (commerce, membres, tables, nombre de lignes, colonnes retirées),
  `json/<table>.json` (lignes écrites par PostgreSQL : montants et quantités exacts) et
  `csv/<table>.csv` (UTF-8 avec BOM, cellules protégées contre l'injection de formules).
- **Borne** : `DATA_EXPORT_LIMITS.rowsPerTable` (100 000) ; au-delà, refus 422 `export_too_large`
  plutôt qu'une archive incomplète.
- **Trace** : événement d'audit `business.data_exported` (acteur, nombre de tables et de lignes).
- **Conservation** : l'archive est produite en mémoire et envoyée directement : rien n'est stocké, il n'y
  a donc ni URL à signer ni fichier à purger. Pour de très gros volumes, un export différé déposé dans R2
  (`docs/storage-r2.md`, URL signées de 5 minutes) serait l'évolution naturelle.
- **Abonnement expiré** : l'export reste possible (lecture seule), pour ne pas retenir les données.

## Non inclus

- Les fichiers déposés eux-mêmes (imports, logos) : seule leur description (`stored_file`) l'est.
- Les boîtes de notifications personnelles des membres et les files techniques.
- Les données d'un autre commerce, même pour un propriétaire de plusieurs commerces (un export par commerce actif).

## Suppression

La suppression d'un commerce à la demande n'est **pas** implémentée : la règle métier actuelle archive
l'historique sans le supprimer. Voir `register-of-processing.md`, points ouverts.
