import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as dataExportRoute from "@/app/api/business/data-export/route";
import { createProduct } from "@/lib/domain/commercial";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/** Lecture d'une archive ZIP (répertoire central, méthode deflate ou stockée) pour vérifier son contenu. */
function unzip(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30);
    const comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}

/*
 * Mission 13 : export complet des données d'un commerce (portabilité). Vraie route, vraies sessions,
 * PGlite migrée ; deux commerces A et B pour prouver l'isolation.
 */
describe("export complet des données du commerce", () => {
  let h: HttpHarness;
  let awa: Actor; let koffi: Actor; let bakary: Actor;
  let awaBusiness = ""; let bakaryBusiness = "";

  const exportAs = (actor: Actor | null) => h.call(dataExportRoute.GET, { path: "/api/business/data-export", actor });

  beforeAll(async () => {
    h = await startHttpHarness();
    awa = await h.signUp("Awa Boutique", "awa@export.test");
    awaBusiness = await h.createBusiness(awa, "Boutique Awa");
    koffi = await h.addMember(awa, "Koffi Caisse", "koffi@export.test", "cashier");
    bakary = await h.signUp("Bakary Phones", "bakary@export.test");
    bakaryBusiness = await h.createBusiness(bakary, "Bakary Phones");
    await createProduct(h.db, { businessId: awaBusiness, actorUserId: awa.userId, name: "Ciment Awa 50 kg", salePriceXof: "9007199254740993" });
    await createProduct(h.db, { businessId: bakaryBusiness, actorUserId: bakary.userId, name: "Téléphone secret de Bakary", salePriceXof: "125000" });
  });
  afterAll(async () => { await h?.close(); });

  it("le propriétaire reçoit une archive complète de SON commerce, montants exacts, sans les données d'un autre", async () => {
    const result = await exportAs(awa);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("application/zip");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const files = unzip(result.bytes);
    const manifest = JSON.parse(files.get("manifest.json")!);
    expect(manifest.business).toMatchObject({ id: awaBusiness, name: "Boutique Awa" });
    expect(manifest.members.map((entry: { email: string; role: string }) => [entry.email, entry.role]).sort())
      .toEqual([["awa@export.test", "owner"], ["koffi@export.test", "cashier"]]);
    expect(files.get("json/product.json")).toContain("Ciment Awa 50 kg");
    // Montant au-delà de la précision d'un nombre flottant : écrit tel quel par PostgreSQL.
    expect(files.get("json/product_variant.json")).toContain("9007199254740993");
    expect(files.get("csv/product_variant.csv")).toContain("9007199254740993");
    const everything = [...files.values()].join("\n");
    expect(everything).not.toContain("Téléphone secret de Bakary");
    expect(everything).not.toContain(bakaryBusiness);
    expect(everything).not.toContain("bakary@export.test");
  });

  it("liste des tables figée et colonnes sensibles jamais exportées", async () => {
    const files = unzip((await exportAs(awa)).bytes);
    const manifest = JSON.parse(files.get("manifest.json")!) as { tables: { table: string; redactedColumns: string[] }[]; excludedTables: string[] };
    // Toute nouvelle table portant business_id change cette liste : relire ce qu'elle contient avant de l'exporter.
    expect(manifest.tables.map((entry) => entry.table)).toMatchInlineSnapshot(`
      [
        "audit_event",
        "business_member_access",
        "business_profile",
        "business_subscription",
        "cash_movement",
        "cash_session",
        "customer",
        "expense",
        "import_batch",
        "import_row",
        "inventory_line",
        "inventory_scope_variant",
        "inventory_session",
        "opening_balance",
        "opening_balance_payment",
        "payment",
        "payment_refund",
        "print_device",
        "print_job",
        "printer_settings",
        "product",
        "product_alias",
        "product_category",
        "product_variant",
        "promotion_redemption",
        "purchase",
        "purchase_line",
        "purchase_payment",
        "receipt_settings",
        "receivable_payment",
        "sale",
        "sale_line",
        "stock_movement",
        "stock_opening",
        "stock_opening_line",
        "stored_file",
        "subscription_invoice",
        "subscription_payment",
        "supplier",
      ]
    `);
    expect(manifest.excludedTables).toEqual(["idempotency_record", "notification", "notification_outbox", "payment_provider_event", "promotion_eligible_business"]);
    for (const entry of manifest.tables) {
      const rows = JSON.parse(files.get(`json/${entry.table}.json`)!) as Record<string, unknown>[];
      for (const row of rows) for (const column of entry.redactedColumns) expect(row, `${entry.table}.${column}`).not.toHaveProperty(column);
    }
    const redacted = manifest.tables.flatMap((entry) => entry.redactedColumns.map((column) => `${entry.table}.${column}`));
    expect(redacted).toMatchInlineSnapshot(`
      [
        "business_profile.creation_key",
        "payment.idempotency_key",
        "payment.provider_payload_hash",
        "sale.idempotency_key",
        "stored_file.object_key",
        "subscription_payment.idempotency_key",
      ]
    `);
  });

  it("trace d'audit sans contenu exporté", async () => {
    const rows = (await h.client.query<{ actor_user_id: string; metadata: Record<string, unknown> }>(
      "select actor_user_id, metadata from audit_event where event_type = 'business.data_exported' and business_id = $1", [awaBusiness])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.actor_user_id).toBe(awa.userId);
    expect(Object.keys(rows[0]!.metadata).sort()).toEqual(["rows", "tables"]);
  });

  it("refusé à un caissier, à un visiteur ; l'autre propriétaire n'exporte que son commerce", async () => {
    const cashier = await exportAs(koffi);
    expect(cashier.status).toBe(403);
    expect(cashier.body.code).toBe("forbidden");
    expect((await exportAs(null)).status).toBe(401);
    const other = unzip((await exportAs(bakary)).bytes);
    expect(JSON.parse(other.get("manifest.json")!).business.id).toBe(bakaryBusiness);
    expect([...other.values()].join("\n")).not.toContain("Ciment Awa 50 kg");
  });

  it("un en-tête de commerce forgé ne change pas le commerce exporté", async () => {
    const forged = await h.call(dataExportRoute.GET, { path: `/api/business/data-export?businessId=${bakaryBusiness}`, actor: awa,
      headers: { "x-business-id": bakaryBusiness, origin: HARNESS_ORIGIN } });
    expect(JSON.parse(unzip(forged.bytes).get("manifest.json")!).business.id).toBe(awaBusiness);
  });
});
