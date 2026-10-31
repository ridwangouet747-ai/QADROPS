import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import { createBusinessCustomer, createBusinessSupplier, listBusinessCustomers, listBusinessSuppliers } from "./business-data";
import { listProductsPage, listStockMovementsPage } from "./catalog-pages";
import { getCommercialReport } from "./reports";
import { createOpeningBalance, listOpeningBalances, listOpeningCandidates, postStockOpening, recordOpeningBalancePayment } from "./opening";

describe("mission 06 : ouverture du commerce et pagination serveur (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const businessA = "opening-business-a";
  const businessB = "opening-business-b";
  const ownerA = "opening-owner-a";
  const cashierA = "opening-cashier-a";
  const ownerB = "opening-owner-b";
  const now = new Date("2026-10-30T12:00:00.000Z");
  const variants: Record<string, string> = {};
  let customerA = "";
  let supplierA = "";
  let customerB = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, email] of [[ownerA, "a@opening.test"], [cashierA, "cashier@opening.test"], [ownerB, "b@opening.test"]]) {
      await client.query("insert into \"user\" (id,name,email) values ($1,'Opening Test',$2)", [id, email]);
    }
    for (const [id, slug] of [[businessA, "opening-a"], [businessB, "opening-b"]]) {
      await client.query("insert into organization (id,name,slug) values ($1,'Commerce test',$2)", [id, slug]);
      await client.query("insert into business_profile (business_id,activity,timezone) values ($1,'hardware','Africa/Abidjan')", [id]);
    }
    await client.query("insert into member(id,organization_id,user_id,role) values ('om-a',$1,$2,'owner'),('om-ca',$1,$3,'cashier'),('om-b',$4,$5,'owner')", [businessA, ownerA, cashierA, businessB, ownerB]);
    for (const name of ["Ciment 50 kg", "Tôle 3 m", "Fer à béton 10", "PVC 100"]) {
      variants[name] = (await createProduct(db, { businessId: businessA, actorUserId: ownerA, name, salePriceXof: "5000" })).variantId;
    }
    variants.other = (await createProduct(db, { businessId: businessB, actorUserId: ownerB, name: "Produit B", salePriceXof: "100" })).variantId;
    customerA = (await createBusinessCustomer(db, { businessId: businessA, actorUserId: ownerA, name: "Awa" })).id;
    supplierA = (await createBusinessSupplier(db, { businessId: businessA, actorUserId: ownerA, name: "Grossiste" })).id;
    customerB = (await createBusinessCustomer(db, { businessId: businessB, actorUserId: ownerB, name: "Client B" })).id;
  });

  afterAll(async () => { await client.close(); });

  describe("stock d’ouverture", () => {
    it("enregistre le stock de départ comme mouvement « opening_stock », sans vente ni achat", async () => {
      const result = await postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0001", referenceDate: "2026-10-01",
        note: "Stock trouvé au démarrage", lines: [{ variantId: variants["Ciment 50 kg"]!, quantity: "120", unitCostXof: "4200" }, { variantId: variants["Tôle 3 m"]!, quantity: "45" }] }, now);
      expect(result).toMatchObject({ lineCount: 2, referenceDate: "2026-10-01", replayed: false });

      const stock = await client.query<{ id: string; on_hand: string; cost_known: boolean; average_cost_xof: string }>("select id,on_hand,cost_known,average_cost_xof from product_variant where business_id=$1 and id = any($2) order by on_hand desc", [businessA, [variants["Ciment 50 kg"], variants["Tôle 3 m"]]]);
      expect(stock.rows.map((row) => [row.on_hand, row.cost_known])).toEqual([["120.000000", true], ["45.000000", false]]);
      // Coût inconnu : jamais inventé.
      expect(stock.rows[1]!.average_cost_xof).toBe("0.000000000000");

      const movements = await client.query<{ reason: string; occurred_at: Date; opening_line_id: string | null }>("select reason,occurred_at,opening_line_id from stock_movement where business_id=$1", [businessA]);
      expect(movements.rows).toHaveLength(2);
      expect(movements.rows.every((row) => row.reason === "opening_stock" && row.opening_line_id !== null)).toBe(true);
      expect(movements.rows[0]!.occurred_at.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      const counts = await client.query<{ sales: string; purchases: string; audit: string }>("select (select count(*) from sale where business_id=$1)::text sales, (select count(*) from purchase where business_id=$1)::text purchases, (select count(*) from audit_event where business_id=$1 and event_type='stock.opening_posted')::text audit", [businessA]);
      expect(counts.rows[0]).toEqual({ sales: "0", purchases: "0", audit: "1" });
      const report = await getCommercialReport(db, { businessId: businessA, actorUserId: ownerA, period: "daily", date: "2026-10-01" });
      expect(report.sales.revenueXof).toBe("0");
    });

    it("rejoue la même clé sans rien appliquer deux fois", async () => {
      const replay = await postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0001", referenceDate: "2026-10-01",
        note: "Stock trouvé au démarrage", lines: [{ variantId: variants["Ciment 50 kg"]!, quantity: "120", unitCostXof: "4200" }, { variantId: variants["Tôle 3 m"]!, quantity: "45" }] }, now);
      expect(replay.replayed).toBe(true);
      const movements = await client.query<{ n: string }>("select count(*)::text n from stock_movement where business_id=$1", [businessA]);
      expect(movements.rows[0]!.n).toBe("2");
    });

    it("refuse une deuxième ouverture du même produit, même avec une autre clé", async () => {
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0002", referenceDate: "2026-10-02",
        lines: [{ variantId: variants["Ciment 50 kg"]!, quantity: "10" }] }, now)).rejects.toMatchObject({ status: 409 });
    });

    it("refuse l’ouverture d’un produit qui a déjà des mouvements (vente)", async () => {
      await postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0003", referenceDate: "2026-10-01", lines: [{ variantId: variants["Fer à béton 10"]!, quantity: "80" }] }, now);
      await createSale(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-sale-0001", lines: [{ variantId: variants["Fer à béton 10"]!, quantity: "2" }], payments: [{ method: "cash", amountXof: "10000" }] });
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0004", referenceDate: "2026-10-01",
        lines: [{ variantId: variants["Fer à béton 10"]!, quantity: "5" }] }, now)).rejects.toMatchObject({ status: 409 });
    });

    it("refuse une date future, une quantité nulle, un doublon de ligne et un rôle sans droit d’ajustement", async () => {
      const line = [{ variantId: variants["PVC 100"]!, quantity: "15" }];
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0005", referenceDate: "2026-11-15", lines: line }, now)).rejects.toThrow(/futur/);
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0006", referenceDate: "2026-10-01", lines: [{ variantId: variants["PVC 100"]!, quantity: "0" }] }, now)).rejects.toThrow(/supérieure à zéro/);
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0007", referenceDate: "2026-10-01", lines: [...line, ...line] }, now)).rejects.toThrow(/qu’une fois/);
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: cashierA, idempotencyKey: "opening-key-0008", referenceDate: "2026-10-01", lines: line }, now)).rejects.toMatchObject({ status: 403 });
    });

    it("isole les commerces : un produit de B est introuvable depuis A, et les candidats de A ignorent B", async () => {
      await expect(postStockOpening(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "opening-key-0009", referenceDate: "2026-10-01",
        lines: [{ variantId: variants.other!, quantity: "1" }] }, now)).rejects.toMatchObject({ status: 404 });
      await expect(postStockOpening(db, { businessId: businessB, actorUserId: ownerA, idempotencyKey: "opening-key-0010", referenceDate: "2026-10-01",
        lines: [{ variantId: variants.other!, quantity: "1" }] }, now)).rejects.toMatchObject({ status: 403 });
      const candidates = await listOpeningCandidates(db, { businessId: businessA, actorUserId: ownerA }, {});
      expect(candidates.items.map((item) => item.name)).toEqual(["PVC 100"]);
      expect(candidates.openedCount).toBe(3);
      // Régression : le nombre de lignes de chaque ouverture récente doit être exact.
      expect(candidates.recentOpenings.map((row) => row.lineCount)).toEqual([1, 2]);
    });
  });

  describe("soldes d’ouverture", () => {
    let customerBalance = "";
    it("enregistre une ancienne dette client sans créer de vente ni de chiffre d’affaires", async () => {
      const created = await createOpeningBalance(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-customer-0001", partyType: "customer", partyId: customerA, amountXof: "75000", asOfDate: "2026-10-01" }, now);
      customerBalance = created.id;
      const sales = await client.query<{ n: string }>("select count(*)::text n from sale where business_id=$1 and customer_id=$2", [businessA, customerA]);
      expect(sales.rows[0]!.n).toBe("0");
      const customers = await listBusinessCustomers(db, { businessId: businessA, actorUserId: ownerA });
      expect(customers.find((row) => row.id === customerA)).toMatchObject({ balanceXof: "75000", openingDueXof: "75000", saleCount: "0" });
      await expect(createOpeningBalance(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-customer-0002", partyType: "customer", partyId: customerA, amountXof: "1000", asOfDate: "2026-10-01" }, now)).rejects.toMatchObject({ status: 409 });
    });

    it("accepte des règlements partiels sans dépasser le reste dû, de façon idempotente", async () => {
      await expect(recordOpeningBalancePayment(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-pay-0001", openingBalanceId: customerBalance, amountXof: "25000", method: "cash" })).resolves.toMatchObject({ remainingXof: "50000", replayed: false });
      await expect(recordOpeningBalancePayment(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-pay-0001", openingBalanceId: customerBalance, amountXof: "25000", method: "cash" })).resolves.toMatchObject({ remainingXof: "50000", replayed: true });
      await expect(recordOpeningBalancePayment(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-pay-0002", openingBalanceId: customerBalance, amountXof: "60000", method: "wave" })).rejects.toMatchObject({ status: 409 });
      const listed = await listOpeningBalances(db, { businessId: businessA, actorUserId: ownerA }, { partyType: "customer" });
      expect(listed.parties.find((row) => row.partyId === customerA)).toMatchObject({ amountXof: "75000", paidXof: "25000", remainingXof: "50000" });
    });

    it("enregistre une dette fournisseur sans achat ni mouvement de stock", async () => {
      const before = await client.query<{ n: string }>("select count(*)::text n from stock_movement where business_id=$1", [businessA]);
      const created = await createOpeningBalance(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-supplier-0001", partyType: "supplier", partyId: supplierA, amountXof: "250000", asOfDate: "2026-09-30" }, now);
      await recordOpeningBalancePayment(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-pay-0003", openingBalanceId: created.id, amountXof: "100000", method: "cash" });
      const after = await client.query<{ movements: string; purchases: string }>("select (select count(*) from stock_movement where business_id=$1)::text movements, (select count(*) from purchase where business_id=$1)::text purchases", [businessA]);
      expect(after.rows[0]).toEqual({ movements: before.rows[0]!.n, purchases: "0" });
      const suppliers = await listBusinessSuppliers(db, { businessId: businessA, actorUserId: ownerA });
      expect(suppliers.find((row) => row.id === supplierA)).toMatchObject({ openingDueXof: "150000", purchaseCount: "0", purchaseTotalXof: "0" });
    });

    it("isole les commerces et les rôles", async () => {
      await expect(createOpeningBalance(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: "ob-cross-0001", partyType: "customer", partyId: customerB, amountXof: "1000", asOfDate: "2026-10-01" }, now)).rejects.toMatchObject({ status: 404 });
      await expect(recordOpeningBalancePayment(db, { businessId: businessB, actorUserId: ownerB, idempotencyKey: "ob-cross-0002", openingBalanceId: customerBalance, amountXof: "1", method: "cash" })).rejects.toMatchObject({ status: 404 });
      await expect(createOpeningBalance(db, { businessId: businessA, actorUserId: cashierA, idempotencyKey: "ob-cashier-0001", partyType: "supplier", partyId: supplierA, amountXof: "1000", asOfDate: "2026-10-01" }, now)).rejects.toMatchObject({ status: 403 });
      const listedB = await listOpeningBalances(db, { businessId: businessB, actorUserId: ownerB }, { partyType: "customer" });
      expect(listedB.parties.map((row) => row.partyId)).toEqual([customerB]);
    });
  });

  describe("pagination serveur", () => {
    it("parcourt un grand catalogue page par page sans doublon ni trou, même si un produit est ajouté entre deux pages", async () => {
      for (let index = 0; index < 55; index += 1) {
        await createProduct(db, { businessId: businessA, actorUserId: ownerA, name: `Article ${String(index).padStart(3, "0")}`, salePriceXof: "100" });
      }
      const context = { businessId: businessA, actorUserId: ownerA };
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: Awaited<ReturnType<typeof listProductsPage>> = await listProductsPage(db, context, { limit: "20", ...(cursor ? { cursor } : {}) });
        seen.push(...page.items.map((item) => item.variantId));
        if (pages === 0) await createProduct(db, { businessId: businessA, actorUserId: ownerA, name: "Zinc ajouté pendant la lecture", salePriceXof: "1" });
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(4 + 55 + 1);
      const first = await listProductsPage(db, context, { limit: "20" });
      expect(first.summary.total).toBe(60);
      expect(first.items.every((item) => item.variantId !== variants.other)).toBe(true);
    });

    it("filtre côté serveur par recherche, catégorie et état de stock", async () => {
      const context = { businessId: businessA, actorUserId: ownerA };
      const search = await listProductsPage(db, context, { limit: "50", q: "cim" });
      expect(search.items.map((item) => item.name)).toEqual(["Ciment 50 kg"]);
      const percent = await listProductsPage(db, context, { limit: "50", q: "%" });
      expect(percent.items).toHaveLength(0);
      const inStock = await listProductsPage(db, context, { limit: "50", status: "ok" });
      expect(inStock.items.map((item) => item.name).sort()).toEqual(["Ciment 50 kg", "Fer à béton 10", "Tôle 3 m"]);
      expect(inStock.summary.out).toBe(57);
      await expect(listProductsPage(db, { businessId: businessA, actorUserId: ownerB }, { limit: "10" })).rejects.toMatchObject({ status: 403 });
    });

    it("pagine plus de 100 mouvements du plus récent au plus ancien et garde les anciens consultables", async () => {
      const variant = variants["Ciment 50 kg"]!;
      for (let index = 0; index < 110; index += 1) {
        await createSale(db, { businessId: businessA, actorUserId: ownerA, idempotencyKey: `opening-bulk-sale-${String(index).padStart(4, "0")}`, lines: [{ variantId: variant, quantity: "0.5" }], payments: [{ method: "cash", amountXof: "2500" }] });
      }
      const context = { businessId: businessA, actorUserId: ownerA };
      const all: string[] = [];
      let cursor: string | null = null;
      let previous = Number.POSITIVE_INFINITY;
      do {
        const page: Awaited<ReturnType<typeof listStockMovementsPage>> = await listStockMovementsPage(db, context, { limit: "40", ...(cursor ? { cursor } : {}) });
        for (const item of page.items) {
          const time = new Date(item.occurredAt).getTime();
          expect(time).toBeLessThanOrEqual(previous);
          previous = time;
          all.push(item.id);
        }
        cursor = page.nextCursor;
      } while (cursor);
      expect(new Set(all).size).toBe(all.length);
      expect(all.length).toBe(3 + 1 + 110);
      const openings = await listStockMovementsPage(db, context, { limit: "10", reason: "opening_stock" });
      expect(openings.items).toHaveLength(3);
      expect(openings.summary).toMatchObject({ total: 3, in: 3, out: 0 });
      const outgoing = await listStockMovementsPage(db, context, { limit: "100", direction: "out", from: "2026-01-01", to: abidjanToday() });
      expect(outgoing.summary.out).toBe(111);
      const old = await listStockMovementsPage(db, context, { limit: "10", to: "2026-10-01" });
      expect(old.items.every((item) => item.reason === "opening_stock")).toBe(true);
      await expect(listStockMovementsPage(db, context, { from: "2026-10-10", to: "2026-10-01" })).rejects.toMatchObject({ status: 400 });
      await expect(listStockMovementsPage(db, context, { cursor: "falsifié" })).rejects.toMatchObject({ status: 400 });
      const other = await listStockMovementsPage(db, { businessId: businessB, actorUserId: ownerB }, { limit: "100" });
      expect(other.items).toHaveLength(0);
    });
  });
});

function abidjanToday() {
  return new Date().toISOString().slice(0, 10);
}
