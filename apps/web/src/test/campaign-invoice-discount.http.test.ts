import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as accountBusinessesRoute from "@/app/api/account/businesses/route";
import * as checkoutRoute from "@/app/api/business/subscription/checkout/route";
import * as subscriptionRoute from "@/app/api/business/subscription/route";
import * as campaignsRoute from "@/app/api/platform/campaigns/route";
import * as webhookRoute from "@/app/api/webhooks/geniuspay/route";
import { configureFakeGeniusPay, FakeGeniusPay, signedWebhook, unconfigureGeniusPay } from "./fake-geniuspay";
import { newKey, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 12, bloc 2 : la remise d'une campagne publique réclamée à l'inscription est déduite de la première
 * facture d'abonnement payée, sur la formule choisie, une seule fois. Vraies routes, vraies sessions, PGlite
 * migrée ; seul `fetch` est remplacé par un GeniusPay simulé.
 */
describe("mission 12 : remise de campagne sur la première facture", () => {
  let h: HttpHarness;
  let admin: Actor;
  const fake = new FakeGeniusPay();
  const day = 86_400_000;

  beforeAll(async () => {
    h = await startHttpHarness();
    configureFakeGeniusPay();
    vi.stubGlobal("fetch", fake.fetch);
    await h.client.query(`insert into subscription_plan (id,code,name,price_xof,duration_days,active,features) values
      ('plan-mensuel','MENSUEL','Mensuel',15000,30,true,'{}'),('plan-annuel','ANNUEL','Annuel',150000,365,true,'{}')`);
    admin = await h.signUp("Super Admin", "admin@remise.test");
    await h.grantPlatformAdmin(admin);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    unconfigureGeniusPay();
    await h?.close();
  });

  async function createCampaign(overrides: Record<string, unknown>) {
    const code = `REMISE-${randomUUID().slice(0, 8).toUpperCase()}`;
    const body = { code, name: "Lancement", description: { fr: "Remise de lancement.", en: "Launch discount.", ar: "خصم الإطلاق." }, planIds: ["plan-mensuel"],
      grantDays: null, discountPercent: 20, discountXof: null, startsAt: new Date(Date.now() - day).toISOString(), endsAt: null, maxRedemptions: null, active: true, ...overrides };
    const result = await h.call(campaignsRoute.POST, { path: "/api/platform/campaigns", actor: admin, body });
    expect(result.status, result.text).toBe(201);
    return code;
  }
  let counter = 0;
  async function signUpWith(code: string | null) {
    counter += 1;
    const owner = await h.signUp(`Commerçant ${counter}`, `owner${counter}@remise.test`);
    const created = await h.call(accountBusinessesRoute.POST, { path: "/api/account/businesses", actor: owner,
      body: { name: `Boutique ${counter}`, activity: "general", ...(code ? { promotion: { code } } : {}) } });
    expect(created.status, created.text).toBe(201);
    if (code) expect(created.body.business.promotion.status).toBe("applied");
    return { owner, businessId: created.body.business.id as string };
  }
  const checkout = (actor: Actor, planCode: string) => h.call(checkoutRoute.POST, { path: "/api/business/subscription/checkout", actor, body: { planCode, idempotencyKey: newKey("remise") } });
  const overview = (actor: Actor) => h.call(subscriptionRoute.GET, { path: "/api/business/subscription", actor });
  async function invoices(businessId: string) {
    return (await h.client.query<{ id: string; status: string; plan_code: string; amount_xof: string; discount_xof: string; promotion_redemption_id: string | null }>(
      "select id,status,plan_code,amount_xof::text,discount_xof::text,promotion_redemption_id from subscription_invoice where business_id=$1 order by created_at", [businessId])).rows;
  }
  async function redemptionOf(businessId: string) {
    return (await h.client.query<{ id: string }>("select id from promotion_redemption where business_id=$1", [businessId])).rows[0]!.id;
  }
  async function pay(owner: Actor, planCode: string) {
    const opened = await checkout(owner, planCode);
    expect(opened.status, opened.text).toBe(201);
    const reference = (await h.client.query<{ provider_reference: string }>("select provider_reference from subscription_payment where id=$1", [opened.body.attemptId])).rows[0]!.provider_reference;
    fake.set(reference, { status: "completed", payment_method: "wave" });
    const signed = signedWebhook("payment.success", reference);
    expect((await h.call(webhookRoute.POST, { path: "/api/webhooks/geniuspay", body: signed.body, headers: signed.headers })).status).toBe(200);
    return opened;
  }

  it("première facture de la formule choisie : montant net envoyé à GeniusPay, remise consommée au paiement", async () => {
    const code = await createCampaign({});
    const { owner, businessId } = await signUpWith(code);
    // Le serveur annonce la remise et le montant net, calculés comme sur la facture.
    const before = (await overview(owner)).body;
    expect(before.campaignDiscount).toEqual({ planCode: "MENSUEL", discountXof: "3000", amountXof: "12000" });
    expect(before.pending).toMatchObject({ priceXof: "15000", amountDueXof: "12000" });

    const opened = await checkout(owner, "MENSUEL");
    expect(opened.status, opened.text).toBe(201);
    expect(opened.body.amountXof).toBe("12000");
    const created = fake.calls.filter((call) => call.method === "POST").at(-1)!;
    expect((created.body as { amount: number }).amount).toBe(12000);
    const redemptionId = await redemptionOf(businessId);
    expect(await invoices(businessId)).toMatchObject([{ status: "open", plan_code: "MENSUEL", amount_xof: "12000", discount_xof: "3000", promotion_redemption_id: redemptionId }]);
    expect((await overview(owner)).body.openInvoice).toMatchObject({ planCode: "MENSUEL", amountXof: "12000", discountXof: "3000" });

    // Nouvelle demande de la même formule : même facture, remise conservée, pas de second paiement.
    const again = await checkout(owner, "MENSUEL");
    expect(again.status, again.text).toBe(200);
    expect(again.body).toMatchObject({ attemptId: opened.body.attemptId, reused: true, amountXof: "12000" });
    expect(await invoices(businessId)).toHaveLength(1);

    // Paiement vérifié au montant net : l'abonnement en attente de la campagne devient actif.
    const reference = (await h.client.query<{ provider_reference: string }>("select provider_reference from subscription_payment where id=$1", [opened.body.attemptId])).rows[0]!.provider_reference;
    fake.set(reference, { status: "completed", payment_method: "wave" });
    const signed = signedWebhook("payment.success", reference, { amount: 12000 });
    expect((await h.call(webhookRoute.POST, { path: "/api/webhooks/geniuspay", body: signed.body, headers: signed.headers })).status).toBe(200);
    expect((await invoices(businessId))[0]).toMatchObject({ status: "paid", amount_xof: "12000", discount_xof: "3000" });
    const subscriptions = (await h.client.query<{ status: string; origin: string }>("select status, origin from business_subscription where business_id=$1", [businessId])).rows;
    expect(subscriptions).toEqual([{ status: "active", origin: "payment" }]);
    const audit = (await h.client.query<{ event_type: string; metadata: Record<string, unknown> }>(
      "select event_type, metadata from audit_event where business_id=$1 and event_type in ('subscription.invoice_created','subscription.payment_activated') order by occurred_at", [businessId])).rows;
    expect(audit[0]!.metadata).toMatchObject({ after: { amountXof: "12000", priceXof: "15000", discountXof: "3000", promotionRedemptionId: redemptionId } });
    expect(audit[1]!.metadata).toMatchObject({ amountXof: "12000", discountXof: "3000", promotionRedemptionId: redemptionId });

    // Une seule fois : le renouvellement est facturé au prix plein.
    expect((await overview(owner)).body.campaignDiscount).toBeNull();
    const renewal = await checkout(owner, "MENSUEL");
    expect(renewal.body.amountXof).toBe("15000");
    expect((await invoices(businessId))[1]).toMatchObject({ status: "open", amount_xof: "15000", discount_xof: "0", promotion_redemption_id: null });
  });

  it("autre formule : prix plein ; payer une autre formule d’abord fait perdre la remise", async () => {
    const code = await createCampaign({});
    const { owner, businessId } = await signUpWith(code);
    await pay(owner, "ANNUEL");
    expect((await invoices(businessId))[0]).toMatchObject({ status: "paid", plan_code: "ANNUEL", amount_xof: "150000", discount_xof: "0", promotion_redemption_id: null });
    expect((await overview(owner)).body.campaignDiscount).toBeNull();
    const later = await checkout(owner, "MENSUEL");
    expect(later.body.amountXof).toBe("15000");
  });

  it("changer de formule annule la facture remisée sans payer ; revenir à la formule redonne la remise", async () => {
    const code = await createCampaign({ discountPercent: null, discountXof: "5000" });
    const { owner, businessId } = await signUpWith(code);
    const first = await checkout(owner, "MENSUEL");
    expect(first.body.amountXof).toBe("10000");
    // Le paiement ouvert expire chez GeniusPay ; la facture peut alors être remplacée.
    await h.client.query("update subscription_payment set status='expired' where id=$1", [first.body.attemptId]);
    expect((await checkout(owner, "ANNUEL")).body.amountXof).toBe("150000");
    const annual = (await h.client.query<{ id: string }>("select id from subscription_payment where business_id=$1 and status='pending'", [businessId])).rows[0]!;
    await h.client.query("update subscription_payment set status='expired' where id=$1", [annual.id]);
    expect((await checkout(owner, "MENSUEL")).body.amountXof).toBe("10000");
    expect((await invoices(businessId)).map((row) => `${row.status}:${row.plan_code}:${row.amount_xof}`)).toEqual(["void:MENSUEL:10000", "void:ANNUEL:150000", "open:MENSUEL:10000"]);
  });

  it("montant net sous le minimum GeniusPay : refus clair, aucune facture, rien envoyé", async () => {
    const code = await createCampaign({ discountPercent: null, discountXof: "14900" });
    const { owner, businessId } = await signUpWith(code);
    const before = fake.countCreates();
    const refused = await checkout(owner, "MENSUEL");
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("amount_too_low");
    expect(fake.countCreates()).toBe(before);
    expect(await invoices(businessId)).toEqual([]);
  });

  it("sans remise (essai seul, sans code) et entre commerces : prix plein, aucune remise empruntée", async () => {
    const trial = await createCampaign({ grantDays: 14, discountPercent: null });
    const withTrial = await signUpWith(trial);
    expect((await overview(withTrial.owner)).body.campaignDiscount).toBeNull();
    expect((await checkout(withTrial.owner, "MENSUEL")).body.amountXof).toBe("15000");

    const discounted = await signUpWith(await createCampaign({}));
    const plain = await signUpWith(null);
    expect((await overview(plain.owner)).body.campaignDiscount).toBeNull();
    expect((await checkout(plain.owner, "MENSUEL")).body.amountXof).toBe("15000");
    // La base refuse une facture d'un commerce qui pointerait vers la réclamation d'un autre.
    await expect(h.client.query(`insert into subscription_invoice (id,business_id,plan_id,plan_code,plan_name,amount_xof,discount_xof,promotion_redemption_id,duration_days,status,created_by_user_id)
      values ($1,$2,'plan-mensuel','MENSUEL','Mensuel',12000,3000,$3,30,'void',(select user_id from member where organization_id=$2 limit 1))`,
      [randomUUID(), plain.businessId, await redemptionOf(discounted.businessId)])).rejects.toThrow(/subscription_invoice_redemption_tenant_fk/);
  });

  it("contraintes : remise sans réclamation refusée, une réclamation ne sert qu’à une facture ouverte ou payée", async () => {
    const { owner, businessId } = await signUpWith(await createCampaign({}));
    expect((await checkout(owner, "MENSUEL")).status).toBe(201);
    // Facture payée complète (période, abonnement) : seule la règle « une réclamation, une facture » peut la refuser.
    const insert = (discount: number, redemption: string | null, status: string) => h.client.query(
      `insert into subscription_invoice (id,business_id,plan_id,plan_code,plan_name,amount_xof,discount_xof,promotion_redemption_id,duration_days,status,
         paid_at,subscription_id,period_starts_at,period_ends_at,created_by_user_id)
       values ($1,$2,'plan-mensuel','MENSUEL','Mensuel',12000,$3,$4,30,$5, now(), (select id from business_subscription where business_id=$2 limit 1), now(), now() + interval '30 days', (select user_id from member where organization_id=$2 limit 1))`,
      [randomUUID(), businessId, discount, redemption, status]);
    await expect(insert(3000, null, "void")).rejects.toThrow(/subscription_invoice_discount_check/);
    const redemptionId = await redemptionOf(businessId);
    await expect(insert(0, redemptionId, "void")).rejects.toThrow(/subscription_invoice_discount_check/);
    await expect(insert(3000, redemptionId, "paid")).rejects.toThrow(/subscription_invoice_redemption_once_unique/);
    // Une facture annulée garde sa trace sans bloquer la réclamation.
    await expect(insert(3000, redemptionId, "void")).resolves.toBeDefined();
  });
});
