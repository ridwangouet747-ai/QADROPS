import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import readXlsxFile from "read-excel-file/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseSchema } from "../db/schema";
import { buildReportPdf } from "../exports/report-pdf";
import { buildReportWorkbook } from "../exports/report-workbook";
import { createProduct, createSale, type CommercialDatabase } from "./commercial";
import { createBusinessCustomer, createBusinessExpense, createBusinessSupplier, createReceivedPurchase, recordCustomerPayment } from "./business-data";
import { getReportExport, getWorkbookExport, type ExportData } from "./exports";
import { createOpeningBalance, postStockOpening } from "./opening";

// La route est testée avec un contexte de session simulé : seul getBusinessContext est remplacé.
const session = vi.hoisted(() => ({ current: null as null | { db: unknown; businessId: string; userId: string; actorUserId: string } }));
vi.mock("@/lib/domain/business-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./business-context")>()),
  getBusinessContext: vi.fn(async () => {
    if (!session.current) throw Object.assign(new Error("Authentification requise."), { name: "CommercialError", status: 401 });
    return session.current;
  }),
}));

/** Contenu XML de toutes les parties d'un classeur (lecture du répertoire central). */
function xlsxParts(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = bytes.readUInt32LE(end + 16);
  const parts = new Map<string, string>();
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i += 1) {
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    parts.set(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"), inflateRawSync(bytes.subarray(start, start + size)).toString("utf8"));
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return parts;
}

const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n).toString();

describe("mission 11, phase 4 : exports XLSX et PDF sur PGlite (deux commerces)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema }) as unknown as CommercialDatabase;
  const bizA = "exp-biz-a";
  const bizB = "exp-biz-b";
  const ownerA = "exp-owner-a";
  const stockA = "exp-stock-a";
  const cashierA = "exp-cashier-a";
  const ownerB = "exp-owner-b";
  const now = new Date("2026-10-31T12:00:00Z");
  const week = { period: "weekly", date: "2026-10-28" };
  const keys = (() => { let n = 0; return (label: string) => `${label}-key-${String(++n).padStart(4, "0")}`; })();
  const asA = { businessId: bizA, actorUserId: ownerA };
  const asB = { businessId: bizB, actorUserId: ownerB };

  beforeAll(async () => {
    await migrate(drizzle(client, { schema: databaseSchema }), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, name] of [[ownerA, "Awa"], [stockA, "Sita"], [cashierA, "Koffi"], [ownerB, "Bintou B-SECRET"]]) {
      await client.query(`insert into "user"(id,name,email) values ($1,$2,$3)`, [id, name, `${id}@exp.test`]);
    }
    for (const [id, name] of [[bizA, "Quincaillerie Awa"], [bizB, "Commerce B-SECRET"]]) {
      await client.query("insert into organization(id,name,slug) values ($1,$2,$1)", [id, name]);
      await client.query("insert into business_profile(business_id,activity,timezone) values ($1,'general','Africa/Abidjan')", [id]);
    }
    await client.query(`insert into member(id,organization_id,user_id,role) values
      ('em-a',$1,$2,'owner'),('em-s',$1,$3,'stock_manager'),('em-c',$1,$4,'cashier'),('em-b',$5,$6,'owner')`, [bizA, ownerA, stockA, cashierA, bizB, ownerB]);

    // Commerce A : un produit au nom piégé (formule), un client au téléphone « +225… », crédit, achats, dettes.
    const riz = (await createProduct(db, { ...asA, name: "Riz 5 kg", salePriceXof: "4000" })).variantId;
    const piege = (await createProduct(db, { ...asA, name: "=HYPERLINK(\"http://x\")", salePriceXof: "500" })).variantId;
    await postStockOpening(db, { ...asA, idempotencyKey: keys("open"), referenceDate: "2026-10-01",
      lines: [{ variantId: riz, quantity: "100", unitCostXof: "3000" }, { variantId: piege, quantity: "50" }] }, now);
    const client1 = (await createBusinessCustomer(db, { ...asA, name: "Client Awa", phone: "+225 07 00 00 00" })).id;
    await createSale(db, { ...asA, idempotencyKey: keys("sale"), customerId: client1, lines: [{ variantId: riz, quantity: "2" }],
      payments: [{ method: "cash", amountXof: "5000" }, { method: "wave", amountXof: "3000" }] });
    const credit = await createSale(db, { ...asA, actorUserId: cashierA, idempotencyKey: keys("sale"), customerId: client1, lines: [{ variantId: piege, quantity: "4" }] });
    await recordCustomerPayment(db, { ...asA, actorUserId: cashierA, idempotencyKey: keys("pay"), saleId: credit.id, amountXof: "1500", method: "cash" });
    await createBusinessExpense(db, { ...asA, idempotencyKey: keys("exp"), category: "transport", description: "Taxi", amountXof: "2000", paymentMethod: "cash" });
    const supplierA = (await createBusinessSupplier(db, { ...asA, name: "Grossiste Awa" })).id;
    await createReceivedPurchase(db, { ...asA, idempotencyKey: keys("purchase"), supplierId: supplierA, reference: "ACH-1", lines: [{ variantId: riz, quantity: "10", unitCostXof: "2800" }], paidXof: "10000" });
    await createOpeningBalance(db, { ...asA, idempotencyKey: keys("ob"), partyType: "customer", partyId: client1, amountXof: "6000", asOfDate: "2026-10-01" }, now);
    await createOpeningBalance(db, { ...asA, idempotencyKey: keys("ob"), partyType: "supplier", partyId: supplierA, amountXof: "5000", asOfDate: "2026-10-01" }, now);

    // Commerce B : chaque donnée porte « B-SECRET », elle ne doit jamais apparaître dans un export de A.
    const secret = (await createProduct(db, { ...asB, name: "PRODUIT B-SECRET", salePriceXof: "99999" })).variantId;
    await postStockOpening(db, { ...asB, idempotencyKey: keys("open"), referenceDate: "2026-10-01", lines: [{ variantId: secret, quantity: "10", unitCostXof: "1" }] }, now);
    const clientB = (await createBusinessCustomer(db, { ...asB, name: "CLIENT B-SECRET", phone: "B-SECRET" })).id;
    await createSale(db, { ...asB, idempotencyKey: keys("sale"), customerId: clientB, lines: [{ variantId: secret, quantity: "1" }] });
    await createBusinessExpense(db, { ...asB, idempotencyKey: keys("exp"), category: "B-SECRET", description: "DEPENSE B-SECRET", amountXof: "77777", paymentMethod: "cash" });
    const supplierB = (await createBusinessSupplier(db, { ...asB, name: "FOURNISSEUR B-SECRET" })).id;
    await createReceivedPurchase(db, { ...asB, idempotencyKey: keys("purchase"), supplierId: supplierB, reference: "B-SECRET-1", lines: [{ variantId: secret, quantity: "1", unitCostXof: "5" }] });

    // Dates fixées : tout le mouvement dans la semaine du 26 octobre, les ouvertures avant.
    const day = "2026-10-27T10:00:00Z";
    for (const table of ["sale", "expense", "purchase", "purchase_payment"]) await client.query(`update ${table} set occurred_at=$1`, [day]);
    await client.query("update payment set occurred_at=$1, confirmed_at=case when confirmed_at is null then null else $1::timestamptz end", [day]);
    await client.query("update stock_movement set occurred_at=case when reason='opening_stock' then '2026-10-01T08:00:00Z'::timestamptz else $1::timestamptz end", [day]);
    await client.query("update opening_balance set created_at='2026-10-01T08:00:00Z'");
  });
  afterAll(async () => { await client.close(); });

  const workbookA = () => getWorkbookExport(db, { ...asA, ...week }, now);

  it("le classeur de A ne contient aucune donnée de B (données, XML et relecture)", async () => {
    const data = await workbookA();
    expect(JSON.stringify(data)).not.toContain("B-SECRET");
    expect(JSON.stringify(data)).not.toContain("99999");
    const bytes = buildReportWorkbook(data, "fr");
    for (const content of xlsxParts(bytes).values()) {
      expect(content).not.toContain("B-SECRET");
      expect(content).not.toMatch(/<f[\s>]/);
    }
    const sheets = await readXlsxFile(bytes, { trim: false });
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Synthèse", "Ventes", "Produits", "Stock", "Clients", "Dettes", "Fournisseurs", "Achats", "Dépenses", "Paiements"]);
    const pdf = buildReportPdf((await getReportExport(db, { ...asA, ...week }, now)).report, data.businessName, "fr").toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("(Quincaillerie Awa) Tj");
    expect(pdf).not.toContain("B-SECRET");
    // Et B ne voit pas A.
    const other = await getWorkbookExport(db, { ...asB, ...week }, now);
    expect(JSON.stringify(other)).not.toContain("Client Awa");
    expect(other.sheets.sales!.rows).toHaveLength(1);
  });

  it("les lignes détaillées retombent sur les totaux du rapport (aucun calcul divergent)", async () => {
    const data = await workbookA();
    const { report, sheets } = data;
    expect(sum(sheets.sales!.rows.filter((row) => row.status !== "voided").map((row) => row.totalXof))).toBe(report.sales.revenueXof);
    expect(sum(sheets.payments!.rows.filter((row) => row.collectedInPeriod).map((row) => row.amountXof))).toBe(report.collections.totalXof);
    expect(sum(sheets.receivables!.rows.map((row) => row.totalDueXof))).toBe(report.credit.totalOutstandingXof);
    expect(sum(sheets.suppliers!.rows.map((row) => row.totalDueXof))).toBe(report.supplierDebt!.totalXof);
    expect(sum(sheets.expenses!.rows.map((row) => row.amountXof))).toBe(report.expenses.totalXof);
    expect(sum(sheets.purchases!.rows.filter((row) => row.status === "received").map((row) => row.totalXof))).toBe(report.purchases.totalXof);
    // Valeurs attendues, calculées à la main : 8 000 + 2 000 de ventes ; 6 500 encaissés ; dettes 3 000 + 500 + 6 000.
    expect(report.sales.revenueXof).toBe("10000");
    expect(report.collections.totalXof).toBe("6500");
    expect(sheets.receivables!.rows).toEqual([{ name: "Client Awa", phone: "+225 07 00 00 00", unpaidSales: "2", salesDueXof: "3500", openingDueXof: "6000", totalDueXof: "9500" }]);
    expect(sheets.suppliers!.rows[0]).toMatchObject({ name: "Grossiste Awa", purchasedXof: "28000", purchasesDueXof: "18000", openingDueXof: "5000", totalDueXof: "23000" });
    expect(sheets.purchases!.rows[0]).toMatchObject({ reference: "ACH-1", totalXof: "28000", paidXof: "10000", dueXof: "18000" });
    // Les sorties de stock restent des nombres négatifs exacts.
    expect(sheets.stock!.rows.filter((row) => row.reason === "sale").map((row) => row.quantityDelta).sort()).toEqual(["-2.000000", "-4.000000"]);
    expect(sheets.stock!.rows.some((row) => row.reason === "opening_stock")).toBe(false);
  });

  it("dans le fichier, montants entiers et quantités négatives restent des nombres ; les textes piégés sont neutralisés", async () => {
    const bytes = buildReportWorkbook(await workbookA(), "fr");
    const sheets = await readXlsxFile<{ n: string }>(bytes, { parseNumber: (value) => ({ n: value }), trim: false });
    const byName = Object.fromEntries(sheets.map((sheet) => [sheet.sheet, sheet.data]));
    const stock = byName.Stock;
    const quantityColumn = stock[0].indexOf("Quantité (+ entrée, − sortie)");
    expect(stock.slice(1).map((row) => row[quantityColumn])).toEqual(expect.arrayContaining([{ n: "-2" }, { n: "-4" }, { n: "10" }]));
    const sales = byName.Ventes;
    expect(sales.slice(1).map((row) => row[sales[0].indexOf("Total (XOF)")])).toEqual([{ n: "8000" }, { n: "2000" }]);
    const parts = xlsxParts(bytes);
    const productsXml = parts.get("xl/worksheets/sheet3.xml")!;
    expect(productsXml).toMatch(/t="inlineStr" s="2"><is><t xml:space="preserve">=HYPERLINK\(&quot;http:\/\/x&quot;\)<\/t>/);
    const customersXml = parts.get("xl/worksheets/sheet5.xml")!;
    expect(customersXml).toMatch(/t="inlineStr" s="2"><is><t xml:space="preserve">\+225 07 00 00 00<\/t>/);
  });

  it("en arabe : en-têtes et noms de feuilles traduits, feuilles de droite à gauche", async () => {
    const bytes = buildReportWorkbook(await workbookA(), "ar");
    const parts = xlsxParts(bytes);
    expect(parts.get("xl/workbook.xml")).toContain(`<sheet name="المبيعات"`);
    for (const [name, content] of parts) if (name.startsWith("xl/worksheets/")) expect(content).toContain(`rightToLeft="1"`);
    const sheets = await readXlsxFile(bytes, { trim: false });
    expect(sheets[1].data[0][0]).toBe("التاريخ والوقت");
    expect(sheets[1].data[1]).toContain("Client Awa");
  });

  it("un gestionnaire de stock n'obtient que les feuilles de ses domaines ; un caissier et un autre commerce sont refusés", async () => {
    const data = await getWorkbookExport(db, { businessId: bizA, actorUserId: stockA, ...week }, now);
    expect(data.omitted).toEqual(["expenses", "payments"]);
    expect(data.sheets.payments).toBeNull();
    expect(data.sheets.expenses).toBeNull();
    const sheets = await readXlsxFile(buildReportWorkbook(data, "fr"), { trim: false });
    expect(sheets.map((sheet) => sheet.sheet)).not.toContain("Paiements");
    expect(sheets[0].data.flat().join(" ")).toContain("Feuilles non incluses, votre rôle n’y donne pas accès : Dépenses, Paiements.");
    await expect(getWorkbookExport(db, { businessId: bizA, actorUserId: cashierA, ...week }, now)).rejects.toMatchObject({ status: 403 });
    await expect(getReportExport(db, { businessId: bizA, actorUserId: cashierA, ...week }, now)).rejects.toMatchObject({ status: 403 });
    // Le propriétaire de B qui vise le commerce A n'en est pas membre.
    await expect(getWorkbookExport(db, { businessId: bizA, actorUserId: ownerB, ...week }, now)).rejects.toMatchObject({ status: 403 });
  });

  it("période obligatoire et bornée ; plafond de lignes : refus pour la période, troncature signalée pour les listes", async () => {
    await expect(getWorkbookExport(db, { ...asA, period: "custom", startDate: "2025-01-01", endDate: "2026-10-31" }, now)).rejects.toMatchObject({ status: 400, code: "invalid_range" });
    await expect(getWorkbookExport(db, { ...asA, period: "custom" }, now)).rejects.toMatchObject({ status: 400, code: "missing_dates" });
    await expect(getWorkbookExport(db, { ...asA, period: "daily", date: "2026-02-30" }, now)).rejects.toMatchObject({ status: 400 });
    await expect(getWorkbookExport(db, { ...asA, period: "forever" }, now)).rejects.toMatchObject({ name: "ZodError" });
    await expect(getWorkbookExport(db, { ...asA, ...week }, now, { rowsPerSheet: 1 })).rejects.toMatchObject({ status: 422, code: "export_too_large" });
    // Un jour sans vente ni paiement multiple : seules les listes de référence dépassent le plafond de 1.
    const truncated: ExportData = await getWorkbookExport(db, { ...asA, period: "daily", date: "2026-10-30" }, now, { rowsPerSheet: 1 });
    expect(truncated.truncated).toEqual(["products"]);
    expect(truncated.sheets.products!.rows).toHaveLength(1);
    const sheets = await readXlsxFile(buildReportWorkbook(truncated, "fr"), { trim: false });
    expect(sheets.find((sheet) => sheet.sheet === "Produits")!.data.flat()).toContain("Liste limitée aux 1 premières lignes.");
  });

  describe("route GET /api/business/reports/export", () => {
    const call = async (query: string) => (await import("@/app/api/business/reports/export/route")).GET(new Request(`http://localhost/api/business/reports/export?${query}`));

    it("ignore les identifiants de commerce et d'utilisateur glissés dans la requête", async () => {
      session.current = { db, businessId: bizA, userId: ownerA, actorUserId: ownerA };
      const response = await call(`format=xlsx&period=weekly&date=2026-10-28&businessId=${bizB}&actorUserId=${ownerB}&organizationId=${bizB}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toBe(`attachment; filename="qadr-ops-classeur-2026-10-26-2026-11-01.xlsx"`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const all = [...xlsxParts(bytes).values()].join("");
      expect(all).toContain("Client Awa");
      expect(all).not.toContain("B-SECRET");
    });

    it("PDF en français ou en anglais, refusé en arabe ; format inconnu refusé ; rôle sans permission : 403", async () => {
      session.current = { db, businessId: bizA, userId: ownerA, actorUserId: ownerA };
      const pdf = await call("format=pdf&period=weekly&date=2026-10-28&lang=en");
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      const text = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
      expect(text.startsWith("%PDF-1.4")).toBe(true);
      expect(text).toContain("(Business report) Tj");
      const arabic = await call("format=pdf&period=weekly&lang=ar");
      expect(arabic.status).toBe(422);
      expect(await arabic.json()).toMatchObject({ code: "pdf_language_unsupported" });
      expect((await call("format=docx")).status).toBe(400);
      const csv = await call("format=csv&period=weekly&date=2026-10-28");
      expect(await csv.text()).toContain(`"'=HYPERLINK(""http://x"")"`);
      session.current = { db, businessId: bizA, userId: cashierA, actorUserId: cashierA };
      const forbidden = await call("format=xlsx&period=weekly");
      expect(forbidden.status).toBe(403);
      expect(forbidden.headers.get("content-type")).toContain("application/json");
      session.current = null;
      expect((await call("format=xlsx")).status).toBe(401);
    });
  });
});
