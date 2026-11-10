# Stockage privé des fichiers (Cloudflare R2)

Mission 12, lot L2. Documentation rédigée le 2026-11-03.

> **État : intégré, jamais contacté en réel.** Aucun bucket, aucun jeton et aucun compte n'ont été créés. Les échanges avec R2 sont testés contre un `fetch` simulé et contre les vecteurs officiels de signature AWS SigV4. Un premier essai réel reste à faire par le propriétaire (§ 8).

## 1. Ce que fait le stockage aujourd'hui

- Un seul usage branché : **l'original d'un import de catalogue** (CSV/XLSX, Qadr Capture), gardé tel quel et téléchargeable par les personnes du commerce autorisées à importer (`docs/imports.md`).
- La finalité `export` est déclarée (politique, contrainte en base) mais **pas encore utilisée** : les exports restent générés en mémoire et envoyés directement (`docs/exports.md`).
- Sans stockage configuré, rien ne casse : l'import fonctionne, l'original n'est pas gardé et l'écran le dit.

## 2. Architecture

| Élément | Fichier | Rôle |
| --- | --- | --- |
| Contrat | `src/lib/storage/types.ts` | `FileStorage` : `put`, `get`, `head`, `exists`, `delete`, `createDownloadUrl`. Les clés sont contrôlées (`<finalité>/<64 hex>`), jamais construites depuis une saisie. |
| Signature | `src/lib/storage/sigv4.ts` | AWS Signature V4 écrite avec `node:crypto` (aucun SDK) : en-têtes signés et URL présignée. |
| R2 | `src/lib/storage/r2.ts` | API compatible S3 : `PUT`, `GET`, `HEAD`, `DELETE`, URL `GET` présignée. Délai de 15 s par requête. |
| Mémoire | `src/lib/storage/memory.ts` | Tests et aperçu local seulement. **Refusée en production.** Pas d'URL signée : la route renvoie les octets. |
| Configuration | `src/lib/storage/config.ts` | Choix R2 / mémoire / aucun, politiques par finalité. |
| Type réel | `src/lib/storage/file-type.ts` | Détection par signature (octets), jamais par l'extension. |
| Service | `src/lib/domain/stored-files.ts` | Envoi, confirmation, ouverture, suppression, purge. |
| Base | table `stored_file` (migration `0018_stored_files`) | Métadonnées : commerce, finalité, statut, clé, type, taille, SHA-256, nom affiché, auteur, dates, échéance, suppression. |

### 2.1 Choix du stockage

1. Les quatre variables `R2_*` sont renseignées → **R2** (seul stockage admis en production).
2. Sinon, hors production, `QADR_FILE_STORAGE=memory` ou l'aperçu (`QADR_PREVIEW_MODE=true`) → mémoire du processus.
3. Sinon → **aucun stockage**. Il n'existe pas de repli silencieux sur le disque ou la mémoire.

Une configuration R2 partielle ou mal formée est une erreur de configuration ; le message cite le nom des variables, jamais leur valeur. `QADR_FILE_STORAGE=memory` en production est refusé.

### 2.2 Cycle de vie d'un fichier

1. **Contrôle** : taille maximale de la finalité (413 `file_too_large`), type réel admis (415 `file_type_refused`). Sont refusés : exécutables (`MZ`, ELF, Mach-O, `#!`), archives qui ne sont pas des classeurs, classeurs à macros (`vbaProject.bin`), texte contenant des octets de contrôle.
2. **Ligne `pending`** écrite en base, avec une clé aléatoire (`import_source/<64 hex>`, 256 bits) : ni nom de fichier, ni identifiant de commerce dans la clé.
3. **Envoi** à R2 : `PUT` signé avec `Content-Type` du type détecté, `Content-Disposition: attachment`, `Content-MD5` (contrôle d'intégrité par R2), `x-amz-content-sha256` (empreinte signée) et `If-None-Match: *` (jamais d'écrasement).
4. **Confirmation** (`stored`) dans la transaction de l'import. Si l'envoi échoue, la ligne reste `pending` et l'import continue sans original.
5. **Lecture** : la route vérifie la session, la permission et le commerce, puis :
   - R2 : redirection `303` vers une URL présignée de **5 minutes** (`DOWNLOAD_URL_TTL_SECONDS`) ;
   - mémoire : envoi des octets après contrôle du SHA-256.
   Réponses `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
6. **Suppression** :
   - abandon de l'import → immédiate (`import_discarded`) ;
   - échéance dépassée → introuvable tout de suite, puis supprimé par le passage planifié (`retention`) ;
   - ligne `pending` de plus d'une heure (`ORPHAN_GRACE_MS`) → objet éventuel supprimé, ligne marquée `orphan`.
   La ligne est conservée (statut `deleted`, date, motif) : l'historique n'est jamais effacé.

### 2.3 Passage planifié

Aucun nouvel horaire n'a été ajouté (les horaires sont liés entre `vercel.json`, `cron-schedule.ts` et `wrangler.jsonc`). La purge s'exécute dans le passage quotidien existant `GET /api/cron/subscriptions` (1 h UTC), **après** l'expiration des abonnements. Une panne du stockage n'empêche pas l'expiration : elle est envoyée à Sentry et la réponse contient `storage: { error: "storage_purge_failed" }`. Sinon : `storage: { deleted, orphans, failed, storage }`. Chaque passage traite au plus 100 fichiers échus et 100 orphelins.

### 2.4 Isolation entre commerces

- `stored_file.business_id` est une clé étrangère vers `business_profile` ; l'auteur est rattaché par `(business_id, uploaded_by_user_id)` à `member`.
- `import_batch.source_file_id` référence `stored_file` par la clé composée `(business_id, id)` : un import ne peut pas pointer vers le fichier d'un autre commerce.
- La route ne lit jamais d'identifiant de commerce dans la requête ; la clé d'objet ne contient aucun identifiant de commerce et ne sert jamais d'autorisation.
- Le test `tenant-isolation.http.test.ts` vérifie que l'original d'un import de B répond à A exactement comme un identifiant inconnu (404, aucun en-tête `location`), et que l'état de B reste inchangé.

### 2.5 Journaux

Seuls un nom d'événement, un code et un statut HTTP sont journalisés (`{"event":"storage.upload_failed","code":"network"}`). Jamais le contenu, le nom du fichier, la clé, l'URL signée ni un secret.

## 3. Variables

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | Identifiant du compte Cloudflare (32 caractères hexadécimaux) | — |
| `R2_BUCKET_NAME` | Nom du bucket privé | — |
| `R2_ACCESS_KEY_ID` | Identifiant de la clé du jeton d'API R2 | — |
| `R2_SECRET_ACCESS_KEY` | Secret du jeton d'API R2 (**Sensitive**) | — |
| `R2_JURISDICTION` | `eu` ou `fedramp`, seulement si le bucket a été créé dans une juridiction | aucune |
| `QADR_FILE_STORAGE` | `memory` en développement uniquement | non défini |
| `QADR_STORAGE_IMPORT_MAX_BYTES` | Taille maximale d'un original d'import (1 octet à 20 Mio) | 2 Mio (= limite de l'import) |
| `QADR_STORAGE_IMPORT_RETENTION_DAYS` | Conservation d'un original d'import (1 à 3650 jours) | 90 |
| `QADR_STORAGE_EXPORT_MAX_BYTES` | Taille maximale d'un export (1 octet à 50 Mio) | 10 Mio |
| `QADR_STORAGE_EXPORT_RETENTION_DAYS` | Conservation d'un export (1 à 3650 jours) | 7 |

Une valeur hors bornes est une erreur de configuration, pas une valeur ignorée.

**Pourquoi 90 jours ?** Durée prudente : assez longue pour revoir un import et répondre à une contestation, assez courte pour ne pas accumuler de documents commerciaux. Elle n'a pas de base légale vérifiée : à confirmer par le propriétaire.

## 4. Mise en place par le propriétaire

> À faire par vous dans le tableau de bord Cloudflare. Les écrans et les tarifs peuvent changer : vérifiez la documentation officielle au moment de configurer et notez la date.

1. **Bucket** : *R2 → Create bucket*, par exemple `qadr-ops-fichiers-prod`.
   - Juridiction : laisser « automatique », ou choisir `eu` si vous voulez des données stockées dans l'Union européenne ; dans ce cas, renseigner `R2_JURISDICTION=eu`.
   - **Ne jamais activer l'accès public** (ni domaine `r2.dev`, ni domaine personnalisé). L'application n'en a pas besoin.
   - Créer un bucket distinct pour l'environnement de test (`qadr-ops-fichiers-staging`).
2. **Jeton d'API** : *R2 → Manage R2 API Tokens → Create API token*.
   - Permission : **Object Read & Write** (pas « Admin Read & Write »).
   - Portée : **ce seul bucket**.
   - Un jeton par environnement. Copier l'*Access Key ID* et le *Secret Access Key* une seule fois, directement dans Vercel.
3. **Vercel** : déclarer `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (*Sensitive*) pour *Production* (bucket de production) et pour *Preview* (bucket de test).
4. **CORS** : **aucune règle nécessaire.** Le navigateur n'envoie jamais de fichier directement à R2 (l'envoi passe par le serveur) et le téléchargement est une navigation (redirection `303`), pas une requête `fetch`.
5. **Règles de cycle de vie R2** (facultatif, en filet de sécurité) : une règle « supprimer les objets après 120 jours » sur le préfixe `import_source/` couvre un éventuel arrêt prolongé du cron. La purge applicative reste la référence (elle tient la base à jour).

### 4.1 Coûts

R2 facture le stockage et les opérations, sans frais de sortie. Un original d'import fait au plus 2 Mio : le volume reste très faible pour un petit nombre de commerces. Vérifiez l'offre gratuite et les tarifs actuels sur la page officielle avant activation. **Aucune dépense n'a été engagée.**

## 5. Sécurité : ce qui est fait, ce qui ne l'est pas

Fait :
- type réel par signature, plafond de taille, refus des exécutables et des classeurs à macros ;
- clé d'objet aléatoire, contrôlée par expression régulière et par contrainte en base ;
- bucket privé, URL signée courte, autorisation serveur à chaque téléchargement ;
- `Content-Disposition: attachment` stocké avec l'objet (R2 ne documente pas `response-content-disposition`) et nom affiché réduit aux caractères sûrs ;
- empreinte SHA-256 enregistrée et vérifiée en lecture mémoire ;
- aucune donnée de document ni secret dans les journaux.

**Pas fait :**
- **Aucun antivirus.** Les fichiers ne sont ni analysés ni désinfectés. Le risque est limité (CSV/XLSX seulement, jamais exécutés, téléchargés en pièce jointe), mais il n'est pas nul : un classeur peut contenir des formules ou des liens. Options à étudier si nécessaire : ClamAV dans un service séparé, ou un service d'analyse tiers (coût, confidentialité et conservation à vérifier avant tout envoi).
- Pas d'envoi direct navigateur → R2 (URL `PUT` présignée) : inutile avec des fichiers de 2 Mio.
- Pas de chiffrement applicatif en plus du chiffrement au repos de R2.

## 6. Préparation Neon (migrations)

- `DATABASE_URL` reste la chaîne **pooled** utilisée par l'application (inchangé).
- `DATABASE_URL_UNPOOLED` (nom posé par l'intégration Neon pour Vercel) est la chaîne **directe**, sans `-pooler`. Elle est lue **seulement** par `drizzle.config.ts` et `scripts/migrate.ts` (`requireMigrationDatabaseUrl`, `src/lib/env.ts`). Sans elle, les migrations utilisent `DATABASE_URL`.
- `drizzle-kit generate` et `drizzle-kit check` ne contactent aucune base.

### 6.1 Première connexion et vérification (par le propriétaire)

> Rien de ceci n'a été exécuté. Neon n'a jamais été contacté.

1. Créer une **branche Neon de test** (`staging`) ; ne jamais commencer par `main`. Noter l'heure : la restauration à un instant (*point-in-time restore*) sert de sauvegarde.
2. Dans votre terminal seulement :
   ```powershell
   cd apps/web
   $env:DATABASE_URL_UNPOOLED = '<chaîne directe de staging>'
   $env:QADR_DB_TARGET = 'development'
   npm run db:migrate          # demande une phrase de confirmation
   npm run db:check            # lecture seule
   Remove-Item Env:DATABASE_URL_UNPOOLED; Remove-Item Env:QADR_DB_TARGET
   ```
3. Vérifier : 19 migrations appliquées (0000–0018), table `stored_file` présente, `import_batch.source_file_id` présent.
4. Tester l'application en *Preview* sur cette branche (import d'un CSV, téléchargement de l'original, abandon).
5. Pour `main` : créer d'abord une branche de sauvegarde, puis appliquer avec votre autorisation écrite (la cible `production` du script reste à ajouter, voir `docs/production-setup-guide.md` § 5.2).

## 7. Tests

| Fichier | Couverture |
| --- | --- |
| `src/lib/storage/sigv4.test.ts` | Vecteurs officiels AWS (`awslabs/aws-c-auth` : `get-vanilla`, `get-vanilla-query-order-key-case`, `get-vanilla-query-unreserved`, `get-utf8`, `get-header-value-trim`, `post-x-www-form-urlencoded`), règles S3 (chemin encodé une fois), URL présignée (expiration bornée, encodage de la clé). |
| `src/lib/storage/file-type.test.ts` | CSV, XLSX, PDF, JPEG, PNG, exécutable renommé, archive, classeur à macros. |
| `src/lib/storage/r2.test.ts` | Requêtes signées vers un `fetch` simulé, 404, erreurs sans URL ni secret, URL présignée. |
| `src/lib/storage/config.test.ts` | Choix du stockage, refus de la mémoire en production, configuration partielle, politiques. |
| `src/lib/domain/stored-files.integration.test.ts` | PGlite : original gardé, isolation, sans stockage, échec d'envoi puis orphelin, abandon, échéance, refus 413/415. |
| `src/test/stored-files.http.test.ts` | Routes réelles : téléchargement, caissière 403, abandon, sans stockage, purge par le cron. |
| `src/test/tenant-isolation.http.test.ts` | Attaque A → B sur `/api/business/imports/{id}/original`. |
| `src/lib/storage/r2-test-target.ts` + `.test.ts` | Mission 16 : cible du test réel, lue seulement dans `QADR_TEST_R2_*` ; bucket refusé sans segment `test`/`tests`/`staging`/`dev`/`preview`. |
| `src/lib/storage/r2.integration.test.ts` | Mission 16 : **R2 réel**, sauté sans `QADR_TEST_R2_*`. Écrasement (412), `Content-MD5` faux, URL signée (pièce jointe, altérée, détournée, expirée), lecture non signée, portée du jeton, suppression ; avec PGlite : A/B, 413/415 sans envoi, abandon et purge. Mode d'emploi : `docs/engineering/mission-16-cloudflare-r2-push.md` § 3. |

## 8. Limites connues

- **R2 jamais contacté.** Le comportement réel de `If-None-Match`, `Content-MD5`, de la juridiction et des URL présignées n'a pas été observé. Le test `r2.integration.test.ts` (mission 16) le vérifie dès qu'un bucket de test et un jeton limité existent (§ 4). État lu le 2026-11-10 : **aucun bucket** dans le compte Cloudflare ; dans `.env.local`, seul `R2_BUCKET_NAME` est renseigné (configuration partielle, donc erreur de configuration à l'ouverture du stockage).
- Pas d'antivirus (§ 5).
- Finalité `export` non branchée.
- Le passage planifié est quotidien : un fichier échu est introuvable immédiatement, mais l'objet peut rester jusqu'à 24 h dans R2.
- Course théorique entre la purge d'un orphelin et un envoi très lent (plus d'une heure) : jugée négligeable avec un délai de 15 s par requête.
- Les index de purge (`stored_file_retention_idx`, `stored_file_pending_idx`) ne sont pas préfixés par `business_id` : ils servent le passage planifié, qui parcourt tous les commerces.
- La migration `0018_stored_files` est générée par `drizzle-kit` (aucun SQL manuel) ; son numéro peut changer à l'intégration.
