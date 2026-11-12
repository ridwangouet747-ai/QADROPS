import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as cashRoute from "@/app/api/business/cash/route";
import * as customersRoute from "@/app/api/business/customers/route";
import * as expensesRoute from "@/app/api/business/expenses/route";
import * as openingBalancesRoute from "@/app/api/business/opening-balances/route";
import * as productsRoute from "@/app/api/business/products/route";
import * as salesRoute from "@/app/api/business/sales/route";
import * as stockOpeningRoute from "@/app/api/business/stock/opening/route";
import * as suppliersRoute from "@/app/api/business/suppliers/route";
import { enterTenantScope, TENANT_ROLE, TenantScopeError, withTenantScope } from "@/lib/db/tenant-scope";
import type { CommercialDatabase } from "@/lib/domain/commercial";
import { newKey, startHttpHarness, todayAbidjan, type Actor, type HttpHarness, type HttpResult } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 18 : isolation des commerces par PostgreSQL lui-même (RLS, migration 0025, src/lib/db/tenant-scope.ts).
 * Les requêtes de ce fichier n'ont volontairement PAS de filtre `business_id` quand elles visent le commerce B :
 * c'est PostgreSQL qui doit refuser, pas le code de l'application.
 */

type Row = Record<string, unknown>;
const rows = async <T extends Row>(db: Pick<CommercialDatabase, "execute">, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;
const quoted = (table: string) => sql.raw(`"${table}"`);

/** Drizzle enveloppe l'erreur PostgreSQL (« Failed query… ») : c'est la cause qui porte le refus de la base. */
async function refusedByPostgres(promise: Promise<unknown>, pattern: RegExp, label = "") {
  const error = await promise.then(() => null, (caught: unknown) => caught as Error & { cause?: Error });
  expect(error, `${label} : la base aurait dû refuser`).not.toBeNull();
  expect(`${error!.cause?.message ?? ""} ${error!.message}`, label).toMatch(pattern);
}

async function ok(promise: Promise<HttpResult>, status = 201) {
  const result = await promise;
  expect(result.status, result.text).toBe(status);
  return result.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("RLS : isolation des commerces par PostgreSQL", () => {
  let h: HttpHarness;
  let ownerA: Actor; let ownerB: Actor;
  let businessA = ""; let businessB = "";
  const b = { product: "", customer: "", supplier: "", sale: "", balance: "" };
  let tenantTables: string[] = [];

  async function seed(owner: Actor, label: string) {
    const product = (await ok(h.call(productsRoute.POST, { path: "/api/business/products", actor: owner, body: { name: `Produit ${label}`, salePriceXof: "1000" } }))).product;
    const variant = product.variantId as string;
    await ok(h.call(stockOpeningRoute.POST, { path: "/api/business/stock/opening", actor: owner, body: { idempotencyKey: newKey(), referenceDate: todayAbidjan(), lines: [{ variantId: variant, quantity: "10", unitCostXof: "600" }] } }));
    const customer = (await ok(h.call(customersRoute.POST, { path: "/api/business/customers", actor: owner, body: { name: `Client ${label}` } }))).customer.id as string;
    const supplier = (await ok(h.call(suppliersRoute.POST, { path: "/api/business/suppliers", actor: owner, body: { name: `Fournisseur ${label}` } }))).supplier.id as string;
    await ok(h.call(cashRoute.POST, { path: "/api/business/cash", actor: owner, body: { idempotencyKey: newKey(), openingFloatXof: "1000" } }));
    const sale = (await ok(h.call(salesRoute.POST, { path: "/api/business/sales", actor: owner, body: { idempotencyKey: newKey(), customerId: customer, lines: [{ variantId: variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "400" }] } }))).sale.id as string;
    await ok(h.call(expensesRoute.POST, { path: "/api/business/expenses", actor: owner, body: { idempotencyKey: newKey(), category: "Loyer", description: `Loyer ${label}`, amountXof: "20000", paymentMethod: "other" } }));
    const balance = (await ok(h.call(openingBalancesRoute.POST, { path: "/api/business/opening-balances", actor: owner, body: { idempotencyKey: newKey(), partyType: "customer", partyId: customer, amountXof: "7000", asOfDate: todayAbidjan() } }))).balance.id as string;
    return { product: product.id as string, customer, supplier, sale, balance };
  }

  beforeAll(async () => {
    h = await startHttpHarness();
    ownerA = await h.signUp("Propriétaire Alpha", "owner@alpha-rls.test");
    businessA = await h.createBusiness(ownerA, "Quincaillerie Alpha", "hardware");
    await seed(ownerA, "Alpha");
    ownerB = await h.signUp("Propriétaire Bêta", "owner@beta-rls.test");
    businessB = await h.createBusiness(ownerB, "Boutique Bêta", "general");
    Object.assign(b, await seed(ownerB, "Bêta"));
    // Fichier privé de B (description seulement : le contenu reste dans le stockage objet).
    await h.db.execute(sql`insert into stored_file (id, business_id, purpose, object_key, display_name, file_type, size_bytes, sha256, uploaded_by_user_id, retention_until)
      values (${randomUUID()}, ${businessB}, 'import_source', ${`import_source/${"a".repeat(64)}`}, 'fichier-beta.csv', 'csv', 10, ${"0".repeat(64)}, ${ownerB.userId}, ${new Date(Date.now() + 86_400_000)})`);
    tenantTables = (await rows<{ table: string }>(h.db, sql`select table_name as "table" from information_schema.columns
      where table_schema = 'public' and column_name = 'business_id' order by table_name`)).map((row) => row.table);
  });

  afterAll(async () => { await h?.close(); });

  it("chaque table qui porte business_id a RLS active, la politique du commerce et un droit de lecture pour qadr_tenant", async () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(44);
    const state = await rows<{ table: string; rls: boolean; policies: string; readable: boolean }>(h.db, sql`select c.relname as "table", c.relrowsecurity as "rls",
        coalesce((select string_agg(p.policyname, ',') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and ${TENANT_ROLE} = any(p.roles)), '') as "policies",
        has_table_privilege(${TENANT_ROLE}, c.oid, 'SELECT') as "readable"
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id')
      order by c.relname`);
    expect(state.filter((row) => !row.rls || row.policies !== "qadr_tenant_isolation" || !row.readable)).toEqual([]);
    const [role] = await rows<{ bypass: boolean; login: boolean; superuser: boolean }>(h.db, sql`select rolbypassrls as "bypass", rolcanlogin as "login", rolsuper as "superuser" from pg_roles where rolname = ${TENANT_ROLE}`);
    expect(role).toEqual({ bypass: false, login: false, superuser: false });
  });

  it("le commerce A ne lit aucune ligne de B, dans aucune table, même sans filtre business_id", async () => {
    await withTenantScope(h.db, businessA, async (tx) => {
      for (const table of tenantTables) {
        const [count] = await rows<{ foreign: string; own: string; total: string }>(tx, sql`select
          count(*) filter (where business_id = ${businessB})::text as "foreign",
          count(*) filter (where business_id = ${businessA})::text as "own", count(*)::text as "total" from ${quoted(table)}`);
        expect({ table, foreign: count!.foreign }).toEqual({ table, foreign: "0" });
        expect({ table, total: count!.total }).toEqual({ table, total: count!.own });
      }
    });
    // Contrôle : sans le rôle restreint, B a bien des lignes dans ces tables (le test ne passe pas « à vide »).
    const [owned] = await rows<{ n: string }>(h.db, sql`select count(*)::text as n from product where business_id = ${businessB}`);
    expect(Number(owned!.n)).toBeGreaterThan(0);
  });

  it("lectures ciblées par identifiant : produits, ventes, clients, crédits, fournisseurs, dépenses et fichiers de B restent invisibles", async () => {
    await withTenantScope(h.db, businessA, async (tx) => {
      expect(await rows(tx, sql`select id from product where id = ${b.product}`)).toEqual([]);
      expect(await rows(tx, sql`select id from sale where id = ${b.sale}`)).toEqual([]);
      expect(await rows(tx, sql`select id from sale_line where sale_id = ${b.sale}`)).toEqual([]);
      expect(await rows(tx, sql`select id from customer where id = ${b.customer}`)).toEqual([]);
      expect(await rows(tx, sql`select id from opening_balance where id = ${b.balance}`)).toEqual([]);
      expect(await rows(tx, sql`select id from supplier where id = ${b.supplier}`)).toEqual([]);
      expect(await rows(tx, sql`select id from expense where description = ${"Loyer Bêta"}`)).toEqual([]);
      expect(await rows(tx, sql`select id from stored_file where display_name = ${"fichier-beta.csv"}`)).toEqual([]);
      // Le commerce A voit bien ses propres lignes.
      expect(await rows(tx, sql`select id from customer where name = ${"Client Alpha"}`)).toHaveLength(1);
    });
  });

  it("écritures : A ne peut ni créer une ligne au nom de B, ni modifier, ni supprimer une ligne de B", async () => {
    await refusedByPostgres(withTenantScope(h.db, businessA, (tx) => tx.execute(sql`insert into customer (id, business_id, name) values (${randomUUID()}, ${businessB}, 'Intrus')`)), /row-level security/);
    const updated = await withTenantScope(h.db, businessA, (tx) => rows<{ id: string }>(tx, sql`update customer set name = 'Piraté' where id = ${b.customer} returning id`));
    expect(updated).toEqual([]);
    const deleted = await withTenantScope(h.db, businessA, (tx) => rows<{ id: string }>(tx, sql`delete from expense where business_id = ${businessB} returning id`));
    expect(deleted).toEqual([]);
    // Déplacer sa propre ligne vers B est aussi refusé (WITH CHECK).
    await refusedByPostgres(withTenantScope(h.db, businessA, (tx) => tx.execute(sql`update customer set business_id = ${businessB} where name = 'Client Alpha'`)), /row-level security/);
    const [intact] = await rows<{ name: string }>(h.db, sql`select name from customer where id = ${b.customer}`);
    expect(intact?.name).toBe("Client Bêta");
    const [expenses] = await rows<{ n: string }>(h.db, sql`select count(*)::text as n from expense where business_id = ${businessB}`);
    expect(expenses?.n).toBe("1");
  });

  it("sans contexte de commerce, le rôle restreint ne voit rien et n'écrit rien", async () => {
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role qadr_tenant`);
      for (const table of ["product", "sale", "customer", "expense", "stored_file"]) {
        expect(await rows(tx, sql`select 1 from ${quoted(table)} limit 1`)).toEqual([]);
      }
    });
    await refusedByPostgres(h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role qadr_tenant`);
      await tx.execute(sql`insert into customer (id, business_id, name) values (${randomUUID()}, ${businessA}, 'Sans contexte')`);
    }), /row-level security/);
  });

  it("les tables globales (comptes, sessions, plateforme, limitation) sont interdites au rôle restreint", async () => {
    for (const table of ["user", "session", "account", "verification", "platform_admin", "platform_session", "rate_limit_bucket", "promotion_code", "member", "organization"]) {
      await refusedByPostgres(withTenantScope(h.db, businessA, (tx) => tx.execute(sql`select 1 from ${quoted(table)} limit 1`)), /permission denied/, table);
    }
    // Facturation de la plateforme : lecture de ses propres lignes seulement, aucune écriture.
    await refusedByPostgres(withTenantScope(h.db, businessA, (tx) => tx.execute(sql`update business_subscription set status = 'active' where business_id = ${businessA}`)), /permission denied/);
  });

  it("le contexte ne survit pas à la transaction : la connexion rendue au pool redevient neutre", async () => {
    await withTenantScope(h.db, businessA, async (tx) => {
      expect(await rows(tx, sql`select current_user as "role"`)).toEqual([{ role: TENANT_ROLE }]);
    });
    const [after] = await rows<{ role: string; business: string | null }>(h.db, sql`select current_user as "role", nullif(current_setting('qadr.business_id', true), '') as "business"`);
    expect(after?.role).not.toBe(TENANT_ROLE);
    expect(after?.business ?? null).toBeNull();
    // Une erreur dans la transaction annule aussi le contexte.
    await expect(withTenantScope(h.db, businessA, async () => { throw new Error("échec métier"); })).rejects.toThrow("échec métier");
    const [afterError] = await rows<{ role: string }>(h.db, sql`select current_user as "role"`);
    expect(afterError?.role).not.toBe(TENANT_ROLE);
  });

  it("hors transaction, enterTenantScope refuse de continuer sans protection ; un identifiant invalide est refusé", async () => {
    await expect(enterTenantScope(h.db, businessA)).rejects.toBeInstanceOf(TenantScopeError);
    await expect(withTenantScope(h.db, "a' or '1'='1", async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
    await expect(withTenantScope(h.db, "", async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
  });
});
