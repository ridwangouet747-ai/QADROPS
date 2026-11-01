import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { createProduct, createSale } from "./commercial";
import { createBusinessCustomer, createBusinessExpense, createBusinessSupplier, createReceivedPurchase, recordCustomerPayment } from "./business-data";
import { createOpeningBalance, recordOpeningBalancePayment } from "./opening";
import {
  cashDifference, closeCashSession, expectedCash, getCashOverview, getCashSessionDetail, openCashSession, recordCashMovement, validateCashSession,
} from "./cash-session";
import { getCommercialReport } from "./reports";

describe("calcul de la caisse (fonctions pures)", () => {
  const zero = { openingFloatXof: 0n, cashSalesXof: 0n, receivableCashXof: 0n, openingDebtCashXof: 0n, movementsInXof: 0n, expensesCashXof: 0n, supplierCashXof: 0n, refundsCashXof: 0n, movementsOutXof: 0n };
  it("reproduit l'exemple de la mission : 20 000 + 175 000 − 15 000 = 180 000, compté 175 000 → −5 000", () => {
    const { expectedXof } = expectedCash({ ...zero, openingFloatXof: 20_000n, cashSalesXof: 175_000n, expensesCashXof: 15_000n });
    expect(expectedXof).toBe(180_000n);
    expect(cashDifference(175_000n, expectedXof)).toBe(-5_000n);
    expect(cashDifference(181_000n, expectedXof)).toBe(1_000n);
    expect(cashDifference(180_000n, expectedXof)).toBe(0n);
  });
  it("additionne toutes les entrées et retire toutes les sorties", () => {
    const totals = expectedCash({ openingFloatXof: 10n, cashSalesXof: 100n, receivableCashXof: 20n, openingDebtCashXof: 30n, movementsInXof: 5n,
      expensesCashXof: 7n, supplierCashXof: 8n, refundsCashXof: 9n, movementsOutXof: 4n });
    expect(totals).toEqual({ inflowsXof: 155n, outflowsXof: 28n, expectedXof: 137n });
  });
});

describe("sessions de caisse sur PGlite isolé", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const biz = "cash-biz";
  const other = "cash-other";
  const owner = "cash-owner";
  const cashierA = "cash-cashier-a";
  const cashierB = "cash-cashier-b";
  const accountant = "cash-accountant";
  const outsider = "cash-outsider";
  let variant = "";
  let customer = "";
  let supplier = "";
  let ownerSession = "";
  let sessionA = "";
  let sessionB = "";
  const key = (() => { let n = 0; return (label: string) => `${label}-key-${String(++n).padStart(4, "0")}`; })();

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, name] of [[owner, "Awa Koné"], [cashierA, "Bakary"], [cashierB, "Cécile"], [accountant, "Djénéba"], [outsider, "Ehouman"]]) {
      await client.query(`insert into "user"(id,name,email) values ($1,$2,$3)`, [id, name, `${id}@cash.test`]);
    }
    for (const id of [biz, other]) {
      await client.query("insert into organization(id,name,slug) values ($1,'Caisse',$1)", [id]);
      await client.query("insert into business_profile(business_id,activity) values ($1,'hardware')", [id]);
    }
    await client.query(`insert into member(id,organization_id,user_id,role) values
      ('m-owner',$1,$2,'owner'),('m-a',$1,$3,'cashier'),('m-b',$1,$4,'cashier'),('m-acc',$1,$5,'accountant'),('m-out',$6,$7,'owner')`,
      [biz, owner, cashierA, cashierB, accountant, other, outsider]);
    const product = await createProduct(db, { businessId: biz, actorUserId: owner, name: "Ciment 50 kg", salePriceXof: "5000" });
    variant = product.variantId;
    await client.query("update product_variant set on_hand='500' where id=$1", [variant]);
    customer = (await createBusinessCustomer(db, { businessId: biz, actorUserId: owner, name: "Client crédit" })).id;
    supplier = (await createBusinessSupplier(db, { businessId: biz, actorUserId: owner, name: "Grossiste" })).id;
  });
  afterAll(async () => { await client.close(); });

  it("ouvre une caisse avec un fonds de départ, une seule à la fois par personne, et rejoue la même clé", async () => {
    const opened = await openCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "open-owner-0001", openingFloatXof: "20000", note: "Fonds du matin" });
    ownerSession = opened.id;
    expect(opened).toMatchObject({ openingFloatXof: "20000", replayed: false });
    await expect(openCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "open-owner-0001", openingFloatXof: "20000", note: "Fonds du matin" }))
      .resolves.toMatchObject({ id: ownerSession, replayed: true });
    await expect(openCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "open-owner-0002", openingFloatXof: "1000" }))
      .rejects.toMatchObject({ status: 409, code: "already_open" });
    await expect(openCashSession(db, { businessId: biz, actorUserId: outsider, idempotencyKey: key("open"), openingFloatXof: "0" })).rejects.toMatchObject({ status: 403 });
  });

  it("deux ouvertures simultanées avec des clés différentes n'ouvrent qu'une caisse", async () => {
    const results = await Promise.allSettled([
      openCashSession(db, { businessId: biz, actorUserId: cashierB, idempotencyKey: "open-b-concurrent-1", openingFloatXof: "0" }),
      openCashSession(db, { businessId: biz, actorUserId: cashierB, idempotencyKey: "open-b-concurrent-2", openingFloatXof: "0" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    sessionB = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value.id;
  });

  it("clôture l'exemple de la mission : écart négatif refusé sans justification, puis figé", async () => {
    await createSale(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "35" }], payments: [{ method: "cash", amountXof: "175000" }] });
    await createBusinessExpense(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("expense"), category: "transport", description: "Livraison", amountXof: "15000", paymentMethod: "cash" });
    // Une dépense payée par Wave ne sort pas de la caisse.
    await createBusinessExpense(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("expense"), category: "internet", description: "Forfait", amountXof: "9000", paymentMethod: "wave" });
    const live = await getCashSessionDetail(db, { businessId: biz, actorUserId: owner, sessionId: ownerSession });
    expect(live.session.breakdown).toMatchObject({ openingFloatXof: "20000", cashSalesXof: "175000", expensesCashXof: "15000", expectedXof: "180000" });

    await expect(closeCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "close-owner-0001", sessionId: ownerSession, countedCashXof: "175000" }))
      .rejects.toMatchObject({ status: 400, code: "justification_required" });
    const closed = await closeCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "close-owner-0002", sessionId: ownerSession, countedCashXof: "175000", note: "Billet de 5 000 introuvable" });
    expect(closed).toMatchObject({ expectedXof: "180000", countedXof: "175000", differenceXof: "-5000", replayed: false });
    await expect(closeCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "close-owner-0002", sessionId: ownerSession, countedCashXof: "175000", note: "Billet de 5 000 introuvable" }))
      .resolves.toMatchObject({ differenceXof: "-5000", replayed: true });
    await expect(closeCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: "close-owner-0003", sessionId: ownerSession, countedCashXof: "180000" }))
      .rejects.toMatchObject({ status: 409, code: "already_closed" });
  });

  it("une clôture est irréversible : la base refuse toute modification ou suppression", async () => {
    await expect(client.query("update cash_session set counted_cash_xof=180000, difference_xof=0 where id=$1", [ownerSession])).rejects.toThrow(/clôturée/);
    await expect(client.query("delete from cash_session where id=$1", [ownerSession])).rejects.toThrow(/suppression/);
    await expect(recordCashMovement(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("move"), sessionId: ownerSession, direction: "in", amountXof: "100", reason: "Tardif" }))
      .rejects.toMatchObject({ status: 409 });
    await expect(client.query("insert into cash_movement(id,business_id,session_id,direction,amount_xof,reason,created_by_user_id) values ('late',$1,$2,'in',1,'x',$3)", [biz, ownerSession, owner]))
      .rejects.toThrow(/pas ouverte/);
    // Après la clôture, une vente en espèces n'est plus rattachée à cette caisse.
    const sale = await createSale(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "5000" }] });
    const attached = await client.query<{ cash_session_id: string | null }>("select cash_session_id from payment where sale_id=$1", [sale.id]);
    expect(attached.rows[0]!.cash_session_id).toBeNull();
  });

  it("suit uniquement les espèces : Mobile Money en attente exclu, crédits et anciennes dettes inclus, entrées et sorties justifiées", async () => {
    sessionA = (await openCashSession(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("open"), openingFloatXof: "10000" })).id;
    // Paiement mixte : 10 000 en espèces + 5 000 Wave en attente.
    const sale = await createSale(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("sale"), customerId: customer, lines: [{ variantId: variant, quantity: "4" }],
      payments: [{ method: "cash", amountXof: "10000" }, { method: "wave", amountXof: "5000" }] });
    await recordCustomerPayment(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("receivable"), saleId: sale.id, amountXof: "2000", method: "cash" });
    const balance = await createOpeningBalance(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("ob"), partyType: "customer", partyId: customer, amountXof: "8000", asOfDate: "2026-10-01" });
    await recordOpeningBalancePayment(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("obpay"), openingBalanceId: balance.id, amountXof: "3000", method: "cash" });
    await recordCashMovement(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("move"), sessionId: sessionA, direction: "in", amountXof: "5000", reason: "Monnaie apportée" });
    await recordCashMovement(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("move"), sessionId: sessionA, direction: "out", amountXof: "4000", reason: "Dépôt au coffre" });
    // Remboursement en espèces (aucun écran ne le crée encore : écrit directement, rattaché à la caisse).
    await client.query(`insert into payment_refund(id,business_id,payment_id,amount_xof,status,reference,created_by_user_id,cash_session_id)
      values ('refund-cash',$1,(select id from payment where sale_id=$2 and method='cash' and cash_session_id is not null limit 1),1000,'confirmed','RB-1',$3,$4)`, [biz, sale.id, cashierA, sessionA]);
    const detail = await getCashSessionDetail(db, { businessId: biz, actorUserId: cashierA, sessionId: sessionA });
    expect(detail.session.breakdown).toMatchObject({
      openingFloatXof: "10000", cashSalesXof: "10000", receivableCashXof: "2000", openingDebtCashXof: "3000", movementsInXof: "5000",
      refundsCashXof: "1000", movementsOutXof: "4000", expensesCashXof: "0", expectedXof: "25000",
    });
    expect(detail.movements).toHaveLength(2);
    // L'ancienne dette réglée en espèces n'est pas du chiffre d'affaires.
    const report = await getCommercialReport(db, { businessId: biz, actorUserId: owner, period: "daily" });
    expect(report.collections.openingRecoveries.totalXof).toBe("3000");
    expect(report.collections.pending).toMatchObject({ totalXof: "5000", count: "1" });
    expect(report.settlement.mixed).toBe("1");
  });

  it("isole les caissiers : ni lecture ni clôture de la caisse d'un autre sans droit, ni accès d'un autre commerce", async () => {
    await expect(closeCashSession(db, { businessId: biz, actorUserId: cashierB, idempotencyKey: key("close"), sessionId: sessionA, countedCashXof: "0", note: "?" }))
      .rejects.toMatchObject({ status: 403 });
    await expect(getCashSessionDetail(db, { businessId: biz, actorUserId: cashierB, sessionId: sessionA })).rejects.toMatchObject({ status: 403 });
    await expect(recordCashMovement(db, { businessId: biz, actorUserId: cashierB, idempotencyKey: key("move"), sessionId: sessionA, direction: "out", amountXof: "1000", reason: "Vol" }))
      .rejects.toMatchObject({ status: 403 });
    await expect(getCashSessionDetail(db, { businessId: other, actorUserId: outsider, sessionId: sessionA })).rejects.toMatchObject({ status: 404 });
    await expect(closeCashSession(db, { businessId: other, actorUserId: outsider, idempotencyKey: key("close"), sessionId: sessionA, countedCashXof: "0" })).rejects.toMatchObject({ status: 404 });
    const mine = await getCashOverview(db, { businessId: biz, actorUserId: cashierB });
    expect(mine.sessions.every((session) => session.userId === cashierB)).toBe(true);
    expect(mine.permissions).toMatchObject({ open: true, audit: false, validate: false });
  });

  it("écart positif justifié, écart nul sans justification ; un responsable peut clôturer pour un absent", async () => {
    const positive = await closeCashSession(db, { businessId: biz, actorUserId: cashierA, idempotencyKey: key("close"), sessionId: sessionA, countedCashXof: "25500", note: "Monnaie non rendue" });
    expect(positive).toMatchObject({ expectedXof: "25000", differenceXof: "500" });
    const zero = await closeCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("close"), sessionId: sessionB, countedCashXof: "0" });
    expect(zero).toMatchObject({ expectedXof: "0", differenceXof: "0" });
    const audit = await client.query<{ metadata: { onBehalf: boolean } }>("select metadata from audit_event where event_type='cash_session.closed' and entity_id=$1", [sessionB]);
    expect(audit.rows[0]!.metadata.onBehalf).toBe(true);
  });

  it("validation par un responsable : jamais par un caissier, jamais sa propre caisse sauf le propriétaire, puis plus aucune modification", async () => {
    await expect(validateCashSession(db, { businessId: biz, actorUserId: cashierB, idempotencyKey: key("validate"), sessionId: sessionA })).rejects.toMatchObject({ status: 403 });
    const validated = await validateCashSession(db, { businessId: biz, actorUserId: accountant, idempotencyKey: key("validate"), sessionId: sessionA, note: "Écart accepté" });
    expect(validated).toMatchObject({ status: "validated" });
    await expect(validateCashSession(db, { businessId: biz, actorUserId: accountant, idempotencyKey: key("validate"), sessionId: sessionA })).rejects.toMatchObject({ status: 409, code: "already_validated" });
    await expect(client.query("update cash_session set validation_note='changée' where id=$1", [sessionA])).rejects.toThrow(/validée/);
    await expect(validateCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("validate"), sessionId: ownerSession })).resolves.toMatchObject({ status: "validated" });
    const overview = await getCashOverview(db, { businessId: biz, actorUserId: owner });
    expect(overview.permissions).toMatchObject({ audit: true, validate: true, manage: true });
    expect(new Set(overview.sessions.map((session) => session.userId))).toEqual(new Set([owner, cashierA, cashierB]));
    const comparison = Object.fromEntries(overview.comparison.map((entry) => [entry.userId, entry.differenceXof]));
    expect(comparison).toEqual({ [owner]: "-5000", [cashierA]: "500", [cashierB]: "0" });
  });

  it("rattache les paiements fournisseurs en espèces, et une clôture concurrente d'une vente reste cohérente", async () => {
    const session = (await openCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("open"), openingFloatXof: "50000" })).id;
    await createReceivedPurchase(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("purchase"), supplierId: supplier, reference: "ACH-CASH-1",
      lines: [{ variantId: variant, quantity: "2", unitCostXof: "3000" }], paidXof: "6000", paymentMethod: "cash" });
    const [sale, close] = await Promise.allSettled([
      createSale(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "5000" }] }),
      closeCashSession(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("close"), sessionId: session, countedCashXof: "44000", note: "Comptage rapide" }),
    ]);
    expect(sale.status).toBe("fulfilled");
    expect(close.status).toBe("fulfilled");
    const saleId = (sale as PromiseFulfilledResult<{ id: string }>).value.id;
    const attached = (await client.query<{ cash_session_id: string | null }>("select cash_session_id from payment where sale_id=$1", [saleId])).rows[0]!.cash_session_id;
    const expected = BigInt((close as PromiseFulfilledResult<{ expectedXof: string }>).value.expectedXof);
    // Soit la vente est entrée avant la clôture et compte dans le théorique, soit elle est hors session : jamais à moitié.
    expect(expected).toBe(attached === session ? 49_000n : 44_000n);
  });
});
