import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as openingBalancePaymentsRoute from "@/app/api/business/opening-balances/[balanceId]/payments/route";
import * as openingBalancesRoute from "@/app/api/business/opening-balances/route";
import * as customersRoute from "@/app/api/business/customers/route";
import { newKey, startHttpHarness, todayAbidjan, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Dette de départ saisie à la création d'un client (2026-11-17) : « ce client me doit déjà 15 000 F ».
 * La fiche et le solde d'ouverture sont écrits ensemble, une seule fois par clé ; ce n'est jamais une vente.
 * Les remboursements passent par la route existante des soldes d'ouverture ; le solde ne se modifie jamais à la main.
 */

type Party = { partyId: string; name: string; balanceId: string | null; amountXof: string | null; remainingXof: string | null };

describe("client débiteur : dette de départ à la création, remboursements partiels, isolation des commerces", () => {
  let h: HttpHarness;
  let ownerA: Actor; let cashierA: Actor; let ownerB: Actor;
  let businessA = ""; let businessB = "";
  let customerId = ""; let balanceId = "";
  const key = newKey();
  const body = { idempotencyKey: key, name: "Moussa Traoré", phone: "+225 07 11 22 33 44", openingBalance: { amountXof: "15000", asOfDate: "", note: "Cahier de crédit" } };

  beforeAll(async () => {
    h = await startHttpHarness();
    body.openingBalance.asOfDate = todayAbidjan();
    ownerA = await h.signUp("Awa Koné", "awa@dette-depart.test");
    businessA = await h.createBusiness(ownerA, "Quincaillerie Awa", "hardware");
    cashierA = await h.addMember(ownerA, "Koffi Caisse", "koffi@dette-depart.test", "cashier");
    ownerB = await h.signUp("Bintou Diallo", "bintou@dette-depart.test");
    businessB = await h.createBusiness(ownerB, "Boutique Bintou", "general");
  });
  afterAll(async () => { await h?.close(); });

  const create = (actor: Actor, payload: unknown) => h.call(customersRoute.POST, { path: "/api/business/customers", actor, body: payload });
  const pay = (actor: Actor, id: string, amountXof: string, method = "wave", idempotencyKey = newKey()) =>
    h.call(openingBalancePaymentsRoute.POST, { path: `/api/business/opening-balances/${id}/payments`, actor, params: { balanceId: id }, body: { idempotencyKey, amountXof, method } });
  const parties = async (actor: Actor) => (await h.call(openingBalancesRoute.GET, { method: "GET", path: "/api/business/opening-balances?party=customer", actor })).body.parties as Party[];
  const customers = async (actor: Actor) => (await h.call(customersRoute.GET, { method: "GET", path: "/api/business/customers?limit=50", actor })).body.items as { id: string; name: string; balanceXof: string }[];

  it("crée la fiche et la dette de 15 000 F en une écriture : aucune vente, solde dû affiché", async () => {
    const created = await create(ownerA, body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ replayed: false, openingBalance: { amountXof: "15000", remainingXof: "15000" } });
    customerId = created.body.customer.id;
    balanceId = created.body.openingBalance.id;
    expect(await h.count("select count(*)::text n from sale where business_id=$1", [businessA])).toBe(0);
    expect(await h.count("select count(*)::text n from opening_balance where business_id=$1 and customer_id=$2 and note='Cahier de crédit'", [businessA, customerId])).toBe(1);
    expect((await customers(ownerA)).find((row) => row.id === customerId)).toMatchObject({ name: "Moussa Traoré", balanceXof: "15000" });
    expect((await parties(ownerA)).find((row) => row.partyId === customerId)).toMatchObject({ balanceId, amountXof: "15000", remainingXof: "15000" });
  });

  it("même clé, même contenu : la réponse est rejouée, pas de second client ; contenu différent : 409", async () => {
    const replay = await create(ownerA, body);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, customer: { id: customerId } });
    expect(await h.count("select count(*)::text n from customer where business_id=$1 and name='Moussa Traoré'", [businessA])).toBe(1);
    const conflict = await create(ownerA, { ...body, openingBalance: { ...body.openingBalance, amountXof: "16000" } });
    expect(conflict.status).toBe(409);
  });

  it("montant obligatoire et positif, date non future : rien n'est écrit", async () => {
    const before = await h.count("select count(*)::text n from customer where business_id=$1", [businessA]);
    for (const openingBalance of [{ asOfDate: todayAbidjan() }, { amountXof: "0", asOfDate: todayAbidjan() }, { amountXof: "12,5", asOfDate: todayAbidjan() }, { amountXof: "1000", asOfDate: "2999-01-01" }]) {
      const refused = await create(ownerA, { idempotencyKey: newKey(), name: "Refusé", openingBalance });
      expect(refused.status, JSON.stringify(openingBalance)).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    }
    expect(await h.count("select count(*)::text n from customer where business_id=$1", [businessA])).toBe(before);
  });

  it("un caissier crée un client sans dette, mais ne peut pas lui inscrire une dette de départ", async () => {
    expect((await create(cashierA, { name: "Client comptant" })).status).toBe(201);
    const refused = await create(cashierA, { idempotencyKey: newKey(), name: "Dette caissier", openingBalance: { amountXof: "500", asOfDate: todayAbidjan() } });
    expect(refused.status).toBe(403);
    expect(await h.count("select count(*)::text n from customer where business_id=$1 and name='Dette caissier'", [businessA])).toBe(0);
  });

  it("remboursement de 5 000 F : reste 10 000 F ; puis 10 000 F : soldé ; tout dépassement est refusé", async () => {
    const first = await pay(ownerA, balanceId, "5000");
    expect(first.status).toBe(201);
    expect(first.body.payment.remainingXof).toBe("10000");
    expect((await customers(ownerA)).find((row) => row.id === customerId)?.balanceXof).toBe("10000");
    expect((await pay(ownerA, balanceId, "10001")).status).toBe(409);
    const second = await pay(ownerA, balanceId, "10000", "orange_money");
    expect(second.status).toBe(201);
    expect(second.body.payment.remainingXof).toBe("0");
    expect((await parties(ownerA)).find((row) => row.partyId === customerId)).toMatchObject({ amountXof: "15000", remainingXof: "0" });
    expect((await pay(ownerA, balanceId, "1")).status).toBe(409);
    // Historique : la dette d'origine reste 15 000 F, les deux règlements sont conservés et tracés.
    expect(await h.count("select count(*)::text n from opening_balance_payment where business_id=$1 and opening_balance_id=$2", [businessA, balanceId])).toBe(2);
    expect(await h.count("select count(*)::text n from audit_event where business_id=$1 and event_type='opening_balance.payment_recorded'", [businessA])).toBe(2);
    expect(await h.count("select count(*)::text n from sale where business_id=$1", [businessA])).toBe(0);
  });

  it("le commerce B ne voit ni ne rembourse la dette de A, et ne peut pas lui en inscrire une autre", async () => {
    const before = await h.count("select count(*)::text n from opening_balance_payment where business_id=$1", [businessA]);
    expect((await customers(ownerB)).some((row) => row.id === customerId)).toBe(false);
    expect((await parties(ownerB)).some((row) => row.partyId === customerId || row.balanceId === balanceId)).toBe(false);
    const foreign = await pay(ownerB, balanceId, "1");
    const unknown = await pay(ownerB, "00000000-0000-4000-8000-000000000000", "1");
    expect(foreign.status).toBe(404);
    expect({ status: foreign.status, body: foreign.body }).toEqual({ status: unknown.status, body: unknown.body });
    const foreignDebt = await h.call(openingBalancesRoute.POST, { path: "/api/business/opening-balances", actor: ownerB,
      body: { idempotencyKey: newKey(), partyType: "customer", partyId: customerId, amountXof: "1000", asOfDate: todayAbidjan() } });
    expect(foreignDebt.status).toBe(404);
    // Le corps ne peut pas désigner un autre commerce : `businessId` fourni par le navigateur est ignoré.
    const forged = await create(ownerB, { idempotencyKey: newKey(), businessId: businessA, name: "Client B", openingBalance: { amountXof: "700", asOfDate: todayAbidjan() } });
    expect(forged.status).toBe(201);
    expect(await h.count("select count(*)::text n from customer where business_id=$1 and name='Client B'", [businessA])).toBe(0);
    expect(await h.count("select count(*)::text n from customer where business_id=$1 and name='Client B'", [businessB])).toBe(1);
    expect(await h.count("select count(*)::text n from opening_balance_payment where business_id=$1", [businessA])).toBe(before);
    expect(await h.count("select count(*)::text n from opening_balance where business_id=$1", [businessB])).toBe(1);
  });
});
