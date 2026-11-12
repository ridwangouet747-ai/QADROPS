# Validation de la RLS (migration 0025) sur Neon : branche de staging

> Exécuté le 2026-11-12 (mandat global de release). Cible : projet Neon `soft-shadow-92812879`, branche
> `mission-14-staging` (`br-polished-block-bcpbauvk`), base `qadr_staging`, rôle propriétaire
> `qadr_m14_staging`. **Rien n'a été appliqué sur la branche principale `main`.**
>
> Aucune chaîne de connexion n'a été lue ni écrite : tout est passé par l'outil SQL de l'API Neon (MCP), qui
> s'authentifie côté fournisseur. Le harnais Vitest sur PostgreSQL réel (`QADR_TEST_POSTGRES_URL`) n'a donc
> **pas** été lancé contre Neon pendant ce mandat ; voir « Limites ».

## 1. Application de la migration

| Élément | Valeur |
| --- | --- |
| Fichier | `apps/web/drizzle/0025_tenant_row_level_security.sql` |
| SHA-256 du fichier (= `hash` attendu par le migrateur Drizzle) | `82bd6fab01ecfa6ef4a614d38feaf0bba967be09286098b5897a407ad03d614e` |
| `created_at` (valeur `when` du journal) | `1794483933837` |
| Méthode | une seule transaction (`run_sql_transaction`) : les 179 instructions du fichier, puis l'insertion de la ligne `drizzle.__drizzle_migrations (hash, created_at)` que le migrateur aurait écrite |
| Avant | 25 migrations, dernière empreinte égale à `0024_owner_two_factor_rate_limit.sql` |
| Après | 26 migrations, dernière empreinte égale au fichier 0025 |

Le migrateur Drizzle compare seulement le `created_at` de la dernière ligne au journal : un futur
`npm run db:migrate` sur cette base sautera donc 0025 (déjà appliquée) et appliquera 0026 et suivantes
normalement.

## 2. Contrôle du catalogue (lecture seule, après application)

| Contrôle | Attendu | Obtenu |
| --- | --- | --- |
| Rôle `qadr_tenant` : `rolsuper`, `rolbypassrls`, `rolcanlogin`, `rolinherit` | tous `false` | tous `false` |
| Le rôle applicatif peut `SET ROLE qadr_tenant` | oui | oui |
| Tables du schéma `public` | 63 | 63 |
| Tables portant `business_id` | 44 | 44 |
| …dont RLS activée et politique `qadr_tenant_isolation` | 44 | 44 (0 table oubliée) |
| Tables globales (sans `business_id`) avec un droit pour `qadr_tenant` | 0 | 0 |
| Tables en `FORCE ROW LEVEL SECURITY` | 0 (le propriétaire n'est pas concerné) | 0 |
| Tables en lecture seule pour `qadr_tenant` (abonnement, factures, etc.) | 6 | 6 |
| Fonction `qadr_current_business_id()` | présente, `STABLE` | présente |

## 3. Essais de comportement (24/24 réussis)

Les essais tournent dans un bloc `DO` dont la sous-transaction est **toujours annulée** (`RAISE EXCEPTION
'qadr_rollback'` interceptée) : aucune donnée de test n'est restée en base (dernier essai).

| # | Essai | Résultat |
| --- | --- | --- |
| 1 | rôle effectif sous contexte A = `qadr_tenant` | OK |
| 2 | A lit ses produits (1) | OK |
| 3 | A lit le produit de B par identifiant (0) | OK |
| 4 | A lit ses clients (1) | OK |
| 5 | A filtre explicitement sur le `business_id` de B (0) | OK |
| 6 | A ne voit qu'un profil de commerce | OK |
| 7 | A écrit dans son commerce | OK |
| 8 | A insère une ligne au nom de B | refusé : « new row violates row-level security policy for table "product" » |
| 9 | A modifie un produit de B | 0 ligne |
| 10 | A supprime un client de B | 0 ligne |
| 11 | A déplace sa ligne vers B (`WITH CHECK`) | refusé |
| 12 | lecture de la table globale `user` | « permission denied » |
| 13 | lecture de `session` | « permission denied » |
| 14 | lecture de `rate_limit_bucket` | « permission denied » |
| 15 | `UPDATE` de `business_subscription` (lecture seule) | « permission denied » |
| 16 | sans contexte de commerce : produits visibles | 0 |
| 17 | sans contexte : insertion | refusée |
| 18 | contexte B : seul le produit de B est visible | OK |
| 19 | contrôle propriétaire : produit de B intact | OK |
| 20 | contrôle propriétaire : client de B intact | OK |
| 21 | contrôle propriétaire : aucun produit intrus chez B | OK |
| 22 | après échec de la sous-transaction : rôle rétabli (`qadr_m14_staging`) | OK |
| 23 | après échec : contexte `qadr.business_id` effacé | OK |
| 24 | données de test annulées | OK (0 ligne restante) |

### Script rejouable

À exécuter **en une seule transaction**, avec le rôle propriétaire de la base de staging (console Neon,
*SQL Editor*, ou `psql` sur la chaîne directe de staging). Jamais sur `main`, jamais sur une base qui contient
des données réelles : le script écrit dans `organization`, `business_profile`, `product`, `customer` et
`supplier` avant d'annuler.

```sql
create temp table rls_result(ord serial, test text, ok boolean, detail text) on commit drop;

DO $$
DECLARE n bigint; v text; ok boolean; res jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    insert into organization(id,name,slug) values ('m19_rls_a','RLS Alpha','m19-rls-alpha'),('m19_rls_b','RLS Beta','m19-rls-beta');
    insert into business_profile(business_id, activity) values ('m19_rls_a','hardware'),('m19_rls_b','hardware');
    insert into product(id,business_id,name) values ('m19_pA','m19_rls_a','Produit A'),('m19_pB','m19_rls_b','Produit B');
    insert into customer(id,business_id,name) values ('m19_cA','m19_rls_a','Client A'),('m19_cB','m19_rls_b','Client B');
    insert into supplier(id,business_id,name) values ('m19_sA','m19_rls_a','Fournisseur A'),('m19_sB','m19_rls_b','Fournisseur B');

    SET LOCAL ROLE qadr_tenant;
    PERFORM set_config('qadr.business_id','m19_rls_a', true);
    res := res || jsonb_build_object('t','rôle effectif sous contexte A','ok', current_user='qadr_tenant','d', current_user);
    select count(*) into n from product; res := res || jsonb_build_object('t','A lit ses produits (1 attendu)','ok', n=1,'d',n);
    select count(*) into n from product where id='m19_pB'; res := res || jsonb_build_object('t','A lit le produit de B par id (0 attendu)','ok', n=0,'d',n);
    select count(*) into n from customer; res := res || jsonb_build_object('t','A lit ses clients (1 attendu)','ok', n=1,'d',n);
    select count(*) into n from supplier where business_id='m19_rls_b'; res := res || jsonb_build_object('t','A filtre sur business_id de B (0 attendu)','ok', n=0,'d',n);
    select count(*) into n from business_profile; res := res || jsonb_build_object('t','A voit un seul profil de commerce','ok', n=1,'d',n);
    insert into product(id,business_id,name) values ('m19_pA2','m19_rls_a','Produit A2'); res := res || jsonb_build_object('t','A écrit dans son commerce','ok', true,'d','insert accepté');
    BEGIN insert into product(id,business_id,name) values ('m19_pX','m19_rls_b','Intrus'); ok := false; v := 'insert accepté'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','A insère au nom de B (refus PostgreSQL)','ok', ok,'d',v);
    update product set name='pirate' where id='m19_pB'; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('t','A modifie un produit de B (0 ligne)','ok', n=0,'d',n);
    delete from customer where id='m19_cB'; GET DIAGNOSTICS n = ROW_COUNT; res := res || jsonb_build_object('t','A supprime un client de B (0 ligne)','ok', n=0,'d',n);
    BEGIN update product set business_id='m19_rls_b' where id='m19_pA'; ok := false; v := 'déplacement accepté'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','A déplace sa ligne vers B (WITH CHECK)','ok', ok,'d',v);
    BEGIN PERFORM 1 from "user" limit 1; ok := false; v := 'lecture acceptée'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','table globale user refusée','ok', ok,'d',v);
    BEGIN PERFORM 1 from session limit 1; ok := false; v := 'lecture acceptée'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','table globale session refusée','ok', ok,'d',v);
    BEGIN PERFORM 1 from rate_limit_bucket limit 1; ok := false; v := 'lecture acceptée'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','table globale rate_limit_bucket refusée','ok', ok,'d',v);
    BEGIN update business_subscription set status = status where business_id='m19_rls_a'; ok := false; v := 'écriture acceptée'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','abonnement en lecture seule (UPDATE refusé)','ok', ok,'d',v);
    PERFORM set_config('qadr.business_id','', true);
    select count(*) into n from product; res := res || jsonb_build_object('t','sans contexte : aucun produit visible','ok', n=0,'d',n);
    BEGIN insert into product(id,business_id,name) values ('m19_pY','m19_rls_a','Sans contexte'); ok := false; v := 'insert accepté'; EXCEPTION WHEN insufficient_privilege THEN ok := true; v := SQLERRM; END;
    res := res || jsonb_build_object('t','sans contexte : insertion refusée','ok', ok,'d',v);
    PERFORM set_config('qadr.business_id','m19_rls_b', true);
    select string_agg(id, ',' order by id) into v from product; res := res || jsonb_build_object('t','contexte B : seul le produit de B','ok', v='m19_pB','d',v);
    RESET ROLE;
    select name into v from product where id='m19_pB'; res := res || jsonb_build_object('t','contrôle propriétaire : produit B intact','ok', v='Produit B','d',v);
    select count(*) into n from customer where id='m19_cB'; res := res || jsonb_build_object('t','contrôle propriétaire : client B intact','ok', n=1,'d',n);
    select count(*) into n from product where business_id='m19_rls_b'; res := res || jsonb_build_object('t','contrôle propriétaire : aucun produit intrus chez B','ok', n=1,'d',n);
    SET LOCAL ROLE qadr_tenant; PERFORM set_config('qadr.business_id','m19_rls_a', true);
    RAISE EXCEPTION 'qadr_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'qadr_rollback' THEN RAISE; END IF;
  END;
  res := res || jsonb_build_object('t','après échec de la sous-transaction : rôle rétabli','ok', current_user=session_user,'d', current_user);
  res := res || jsonb_build_object('t','après échec : contexte commerce effacé','ok', coalesce(current_setting('qadr.business_id', true),'')='','d', coalesce(current_setting('qadr.business_id', true),'(nul)'));
  select count(*) into n from organization where id like 'm19_rls_%'; res := res || jsonb_build_object('t','données de test annulées','ok', n=0,'d',n);
  insert into rls_result(test, ok, detail) select e->>'t', (e->>'ok')::boolean, e->>'d' from jsonb_array_elements(res) e;
END $$;

select ord, ok, test, detail from rls_result order by ord;
select count(*) filter (where ok) as reussis, count(*) filter (where not ok) as echecs from rls_result;
```

(La version exécutée le 2026-11-12 comparait l'essai 22 au nom littéral `qadr_m14_staging` ; la version
ci-dessus compare à `session_user` pour rester valable sur une autre base.)

## 4. Restauration : la RLS survit à une copie de branche

Le même jour, une branche `restore-test-2026-11-12` (`br-crimson-unit-bcva1mus`) a été créée à partir de la
branche de staging (voir `docs/engineering/backup-restore.md` § 6.6). Sur la copie : 26 migrations, même
dernière empreinte, 63 tables, 44 politiques, rôle `qadr_tenant` présent, même empreinte de structure
(`md5` des colonnes) que l'original.

## 5. Limites (ce qui n'est pas prouvé sur Neon)

- **Réutilisation d'une connexion après `COMMIT`** : `SET LOCAL` et `set_config(…, true)` sont de portée
  transaction, ce que garantit PostgreSQL. Le test de bout en bout qui le vérifie (pool réutilisé, rôle et
  contexte remis à zéro) n'a tourné que sur PGlite (`tenant-rls.http.test.ts`, essai 7), pas sur une
  connexion Neon poolée.
- **Code applicatif contre Neon** : seul l'export complet (`data-export.ts`) passe par `withTenantScope`. Les
  autres routes restent protégées par le filtrage applicatif (`business_id` issu de la session) ; la RLS n'y
  est pas encore une seconde barrière. Inventaire et plan d'extension : `production-security-audit.md`.
- **Pas de `FORCE`** : le rôle propriétaire (celui des migrations et de l'application hors
  `withTenantScope`) contourne la RLS par construction (`neon_superuser` porte `BYPASSRLS`).
- **Branche principale** : 0025 n'y est pas appliquée (aucune migration ne l'est). À la mise en production,
  0000 à 0025 s'appliqueront ensemble par `db:migrate`, après sauvegarde (runbook).
