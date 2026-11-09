# Export complet des données d'un commerce (missions 13 et 14)

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
- **Format** : `manifest.json` (commerce, membres, tables, nombre de lignes, colonnes retirées, `complete: true`,
  empreinte SHA-256 de chaque fichier), `json/<table>.json` (lignes écrites par PostgreSQL : montants et
  quantités exacts) et `csv/<table>.csv` (UTF-8 avec BOM, cellules protégées contre l'injection de formules).
- **Cohérence (mission 14)** : toutes les tables sont lues dans une seule transaction `repeatable read` en
  lecture seule : un même instantané, sans vente à moitié présente. Chaque table est lue par pages de 5 000
  lignes dans l'ordre de sa clé primaire, puis le nombre de lignes lues est comparé à son `count(*)` dans le
  même instantané ; un écart refuse l'export.
- **Bornes** (`DATA_EXPORT_LIMITS`), toutes avec refus 422 `export_too_large`, un message qui dit
  « aucune archive partielle n'est produite » et une trace `business.data_export_refused` (raison, table,
  volume ; aucun contenu) :
  - 100 000 lignes par table (`rows_per_table`) ;
  - 96 Mo de données brutes en mémoire (`raw_bytes`) ;
  - **4 Mo d'archive compressée** (`archive_bytes`) : une fonction Vercel ne renvoie pas plus de 4,5 Mo.
    C'est la borne qui sera atteinte en premier ; le test mesure qu'un commerce avec 12 000 lignes d'audit
    reste en dessous. Au-delà, il faudra l'export différé déposé dans R2 (ci-dessous).
- **Trace** : événement d'audit `business.data_exported` (acteur, nombre de tables, de lignes et d'octets).
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
