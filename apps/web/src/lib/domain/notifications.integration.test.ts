import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import type { PushResult, PushSender, PushTarget } from "../notifications/web-push";
import { createProduct, createSale } from "./commercial";
import { closeCashSession, openCashSession } from "./cash-session";
import {
  claimPushEndpoint, createAnnouncementCampaign, enqueueExpiringSubscriptions, forgetPushEndpoint, getNotificationActivity, listNotifications, listNotificationTemplates, markNotificationsRead,
  processNotificationOutbox, registerPushSubscription, removePushSubscription, saveNotificationTemplate, sendTestNotification, setCampaignStatus,
  unreadNotificationCount, updateNotificationPreferences,
} from "./notifications";
import { setPlatformBusinessStatus } from "./platform";

/** Service push simulé : enregistre chaque message, et répond selon l'adresse (410 = appareil désabonné, 503 = panne). */
function fakePush() {
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const sender: PushSender = async (target: PushTarget, payload: object): Promise<PushResult> => {
    sent.push({ endpoint: target.endpoint, payload: payload as Record<string, unknown> });
    if (target.endpoint.includes("gone")) return { ok: false, status: 410, expired: true, retryable: false, error: "http_410" };
    if (target.endpoint.includes("down")) return { ok: false, status: 503, expired: false, retryable: true, error: "http_503" };
    return { ok: true, status: 201 };
  };
  return { sent, sender };
}
/** Appareil enregistré depuis la session ouverte du compte (voir `beforeAll`). */
const device = (userId: string) => ({ userId, sessionId: `s-${userId}` });
const keys = { p256dh: `B${"A".repeat(86)}`, auth: "AAAAAAAAAAAAAAAAAAAAAA" };

describe("notifications : boîte d'envoi, destinataires, préférences, push", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });
  const biz = "n-biz";
  const other = "n-other";
  const [owner, cashier, stock, outsider, admin] = ["n-owner", "n-cashier", "n-stock", "n-outsider", "n-admin"];
  let variant = "";
  const key = (() => { let n = 0; return (label: string) => `${label}-key-${String(++n).padStart(4, "0")}`; })();

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    for (const [id, name] of [[owner, "Awa"], [cashier, "Bakary"], [stock, "Cécile"], [outsider, "Ehouman"], [admin, "Qadr Admin"]]) {
      await client.query(`insert into "user"(id,name,email) values ($1,$2,$3)`, [id, name, `${id}@n.test`]);
      // Session vivante du compte : sans elle, aucun push ne part (mission 13).
      await client.query("insert into session(id,token,user_id,expires_at) values ($1,$1,$2,now() + interval '7 days')", [`s-${id}`, id]);
    }
    for (const [id, activity] of [[biz, "hardware"], [other, "phones"]]) {
      await client.query("insert into organization(id,name,slug) values ($1,$2,$1)", [id, id === biz ? "Quincaillerie Awa" : "Phone Shop"]);
      await client.query("insert into business_profile(business_id,activity) values ($1,$2)", [id, activity]);
    }
    await client.query(`insert into member(id,organization_id,user_id,role) values ('m1',$1,$2,'owner'),('m2',$1,$3,'cashier'),('m3',$1,$4,'stock_manager'),('m4',$5,$6,'owner')`,
      [biz, owner, cashier, stock, other, outsider]);
    await client.query("insert into platform_admin(user_id) values ($1)", [admin]);
    variant = (await createProduct(db, { businessId: biz, actorUserId: owner, name: "Ciment 50 kg", salePriceXof: "5000" })).variantId;
    await client.query("update product_variant set on_hand='5', low_stock_threshold='3' where id=$1", [variant]);
  });
  afterAll(async () => { await client.close(); });

  it("la vente écrit ses événements dans sa propre transaction, sans attendre l'envoi", async () => {
    const sale = await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "3" }],
      customerId: undefined, payments: [{ method: "cash", amountXof: "15000" }] });
    const outbox = await client.query<{ event_type: string; status: string; payload: Record<string, string> }>("select event_type,status,payload from notification_outbox where business_id=$1 order by event_type", [biz]);
    expect(outbox.rows.map((row) => [row.event_type, row.status])).toEqual([["sale.created", "pending"], ["stock.low", "pending"]]);
    expect(JSON.stringify(outbox.rows)).not.toMatch(/15000|5000/);
    expect(outbox.rows[0]!.payload).toMatchObject({ saleId: sale.id });
    // Rejouer la même vente ne crée aucun événement de plus.
    await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: "sale-key-0001", lines: [{ variantId: variant, quantity: "3" }], payments: [{ method: "cash", amountXof: "15000" }] });
    expect((await client.query("select 1 from notification_outbox where business_id=$1", [biz])).rows).toHaveLength(2);
  });

  it("une panne du service push n'empêche pas la vente ni la notification interne", async () => {
    const failing: PushSender = async () => { throw new Error("réseau coupé"); };
    await registerPushSubscription(db, device(owner), { endpoint: "https://fcm.googleapis.com/fcm/send/owner-down", keys, deviceLabel: "Téléphone" });
    const summary = await processNotificationOutbox(db, { sender: failing });
    expect(summary).toMatchObject({ processed: 2, failed: 0 });
    const outbox = await client.query<{ status: string }>("select status from notification_outbox where business_id=$1", [biz]);
    expect(outbox.rows.every((row) => row.status === "done")).toBe(true);
    // Les notifications internes existent ; les deux push du propriétaire attendent une relance.
    const retry = await client.query<{ error: string; attempts: number }>("select error,attempts from notification_delivery where status='retry'");
    expect(retry.rows).toEqual([{ error: "Error", attempts: 1 }, { error: "Error", attempts: 1 }]);
  });

  it("destinataires selon le rôle, jamais l'auteur de la vente ni un autre commerce ; push sans données commerciales", async () => {
    const push = fakePush();
    await client.query("update notification_delivery set next_attempt_at=now() - interval '1 minute' where status='retry'");
    await processNotificationOutbox(db, { sender: push.sender });
    const rows = await client.query<{ user_id: string; template_key: string; title: string; body: string; link_path: string }>(
      "select user_id,template_key,title,body,link_path from notification order by template_key,user_id");
    // Vente : rapports lisibles par le propriétaire et le gestionnaire de stock, pas par le caissier auteur.
    expect(rows.rows.filter((row) => row.template_key === "sale.created").map((row) => row.user_id).sort()).toEqual([owner, stock].sort());
    // Stock faible : permission inventaire (propriétaire, stock, caissier).
    expect(rows.rows.filter((row) => row.template_key === "stock.low").map((row) => row.user_id).sort()).toEqual([cashier, owner, stock].sort());
    expect(rows.rows.some((row) => row.user_id === outsider)).toBe(false);
    expect(rows.rows.find((row) => row.template_key === "sale.created")).toMatchObject({ title: "Nouvelle vente", body: expect.stringContaining("Bakary") });
    expect(rows.rows.find((row) => row.template_key === "stock.low")!.body).toContain("Ciment 50 kg");
    // Le propriétaire a un appareil : il reçoit un push générique (pas le nom du produit, pas de montant).
    expect(push.sent.length).toBe(2);
    for (const message of push.sent) {
      expect(message.payload.body).toBe("Ouvrez Qadr Ops pour voir le détail.");
      expect(JSON.stringify(message.payload)).not.toMatch(/Ciment|15000|Bakary/);
      expect(String(message.payload.url)).toMatch(/^\/business\//);
    }
    expect((await client.query("select status from notification_delivery where status='retry'")).rows.length).toBe(2);
  });

  it("isolation : la boîte d'un membre ne montre que ses notifications, pour le commerce actif", async () => {
    const mine = await listNotifications(db, { userId: owner, businessId: biz });
    expect(mine.items).toHaveLength(2);
    expect(mine.unreadCount).toBe(2);
    expect((await listNotifications(db, { userId: owner, businessId: other })).items).toHaveLength(0);
    expect((await listNotifications(db, { userId: outsider, businessId: other })).items).toHaveLength(0);
    // Marquer « lu » les notifications d'un autre ne fait rien.
    const ids = mine.items.map((item) => item.id);
    expect(await markNotificationsRead(db, { userId: stock, businessId: biz }, { ids })).toEqual({ updated: 0 });
    expect(await markNotificationsRead(db, { userId: owner, businessId: biz }, { ids: [ids[0]] })).toEqual({ updated: 1 });
    expect(await unreadNotificationCount(db, { userId: owner, businessId: biz })).toBe(1);
    expect((await listNotifications(db, { userId: owner, businessId: biz }, { unread: "true" })).items).toHaveLength(1);
  });

  it("relance contrôlée, appareil expiré désactivé, appareil supprimé par l'utilisateur", async () => {
    const push = fakePush();
    await client.query("update notification_delivery set next_attempt_at=now() - interval '1 minute' where status='retry'");
    await processNotificationOutbox(db, { sender: push.sender });
    // Troisième essai en échec : abandon (« failed ») et compteur d'échecs de l'appareil incrémenté.
    expect((await client.query("select 1 from notification_delivery where status='retry'")).rows).toHaveLength(0);
    expect((await client.query<{ attempts: number }>("select attempts from notification_delivery where status='failed'")).rows.map((row) => row.attempts)).toEqual([3, 3]);
    expect((await client.query<{ failure_count: number }>("select failure_count from push_subscription where endpoint like '%owner-down'")).rows[0]!.failure_count).toBe(2);
    const gone = await registerPushSubscription(db, device(stock), { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/stock-gone", keys });
    await updateNotificationPreferences(db, stock, { locale: "en", pushEnabled: true, categories: { commercial: { inApp: true, push: true }, security: { inApp: true, push: true },
      subscription: { inApp: true, push: true }, system: { inApp: true, push: false }, announcement: { inApp: true, push: false } }, quietStartMinute: null, quietEndMinute: null });
    await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "5000" }] });
    await processNotificationOutbox(db, { sender: push.sender });
    const subscription = await client.query<{ disabled_reason: string }>("select disabled_reason from push_subscription where id=$1", [gone.id]);
    expect(subscription.rows[0]!.disabled_reason).toBe("expired");
    // Langue choisie par la personne : la notification est rendue en anglais.
    const english = await client.query<{ title: string }>("select title from notification where user_id=$1 order by created_at desc limit 1", [stock]);
    expect(english.rows[0]!.title).toBe("New sale");
    await expect(removePushSubscription(db, outsider, gone.id)).rejects.toMatchObject({ status: 404 });
    await expect(registerPushSubscription(db, device(owner), { endpoint: "https://169.254.169.254/latest/meta-data", keys })).rejects.toMatchObject({ code: "push_endpoint" });
  });

  it("préférences : catégorie coupée, plage de tranquillité (sauf sécurité), stock épuisé", async () => {
    const push = fakePush();
    await updateNotificationPreferences(db, owner, { locale: "fr", pushEnabled: true, categories: { commercial: { inApp: true, push: true }, security: { inApp: false, push: true },
      subscription: { inApp: true, push: true }, system: { inApp: true, push: false }, announcement: { inApp: false, push: false } }, quietStartMinute: 0, quietEndMinute: 1439 });
    await updateNotificationPreferences(db, cashier, { locale: "ar", pushEnabled: false, categories: { commercial: { inApp: false, push: false }, security: { inApp: true, push: true },
      subscription: { inApp: true, push: true }, system: { inApp: true, push: false }, announcement: { inApp: true, push: false } }, quietStartMinute: null, quietEndMinute: null });
    await registerPushSubscription(db, device(owner), { endpoint: "https://fcm.googleapis.com/fcm/send/owner-ok", keys });
    await createSale(db, { businessId: biz, actorUserId: owner, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "1" }], payments: [{ method: "cash", amountXof: "5000" }] });
    await processNotificationOutbox(db, { sender: push.sender, now: new Date() });
    const out = await client.query<{ user_id: string }>("select user_id from notification where template_key='stock.out'");
    // Le caissier a coupé le commercial : aucune notification pour lui.
    expect(out.rows.map((row) => row.user_id).sort()).toEqual([owner, stock].sort());
    const quiet = await client.query<{ status: string }>("select d.status from notification_delivery d join notification n on n.id=d.notification_id where n.user_id=$1 and n.template_key='stock.out'", [owner]);
    expect(quiet.rows.map((row) => row.status)).toEqual(["skipped_quiet"]);
    // Suspension (sécurité) : visible même si la personne a voulu la masquer, et poussée malgré la nuit.
    await setPlatformBusinessStatus(db, admin, biz, { status: "suspended", reason: "Contrôle de test" });
    await processNotificationOutbox(db, { sender: push.sender });
    const security = await client.query<{ user_id: string; title: string }>("select user_id,title from notification where template_key='business.suspended' order by user_id");
    expect(security.rows.map((row) => row.user_id).sort()).toEqual([cashier, owner, stock].sort());
    expect(security.rows.find((row) => row.user_id === cashier)!.title).toBe("تم تعليق المتجر");
    expect(push.sent.some((message) => message.payload.title === "Commerce suspendu")).toBe(true);
    await setPlatformBusinessStatus(db, admin, biz, { status: "active", reason: "Fin du test" });
  });

  it("écart de caisse aux responsables seulement, et échéance d'abonnement dédupliquée", async () => {
    const session = await openCashSession(db, { businessId: biz, actorUserId: cashier, idempotencyKey: key("open"), openingFloatXof: "1000" });
    await closeCashSession(db, { businessId: biz, actorUserId: cashier, idempotencyKey: key("close"), sessionId: session.id, countedCashXof: "500", note: "Erreur de monnaie" });
    await client.query("insert into subscription_plan(id,code,name,price_xof,duration_days) values ('n-plan','N','Essentiel',5000,30)");
    await client.query("insert into business_subscription(id,business_id,plan_id,status,starts_at,ends_at) values ('n-sub',$1,'n-plan','active',now()-interval '27 days',now()+interval '2 days')", [biz]);
    expect(await enqueueExpiringSubscriptions(db)).toBe(1);
    expect(await enqueueExpiringSubscriptions(db)).toBe(1);
    await processNotificationOutbox(db, { sender: fakePush().sender });
    const gap = await client.query<{ user_id: string; body: string }>("select user_id,body from notification where template_key='cash.closing_gap'");
    expect(gap.rows.map((row) => row.user_id)).toEqual([owner]);
    expect(gap.rows[0]!.body).toContain("Bakary");
    expect(gap.rows[0]!.body).not.toMatch(/500|1000/);
    expect((await client.query("select 1 from notification_outbox where event_type='subscription.expiring'")).rows).toHaveLength(1);
    expect((await client.query("select 1 from notification where template_key='subscription.expiring'")).rows).toHaveLength(1);
  });

  it("console Super Admin : modèles validés, test réel, annonce segmentée pausable, statistiques sans données privées", async () => {
    await expect(listNotificationTemplates(db, owner)).rejects.toMatchObject({ status: 403 });
    const templates = await listNotificationTemplates(db, admin);
    expect(templates.find((template) => template.key === "sale.created")).toMatchObject({ builtIn: true, customized: false });
    await expect(saveNotificationTemplate(db, admin, { key: "sale.created", kind: "event", category: "commercial", icon: "cart", linkPath: null, active: true,
      titleFr: "Vente de {{product_name}}", titleEn: "Sale", titleAr: "بيع", bodyFr: "x", bodyEn: "x", bodyAr: "x" })).rejects.toMatchObject({ code: "template_invalid" });
    await saveNotificationTemplate(db, admin, { key: "sale.created", kind: "event", category: "commercial", icon: "cart", linkPath: null, active: false,
      titleFr: "Vente enregistrée", titleEn: "Sale recorded", titleAr: "بيع مسجّل", bodyFr: "Par {{user_name}}", bodyEn: "By {{user_name}}", bodyAr: "بواسطة {{user_name}}" });
    await client.query("update product_variant set on_hand='10' where id=$1", [variant]);
    await createSale(db, { businessId: biz, actorUserId: cashier, idempotencyKey: key("sale"), lines: [{ variantId: variant, quantity: "0.5" }], payments: [{ method: "cash", amountXof: "2500" }] });
    await processNotificationOutbox(db, { sender: fakePush().sender });
    expect((await client.query("select status from notification_outbox where event_type='sale.created' order by created_at desc limit 1")).rows[0]).toMatchObject({ status: "skipped" });

    const push = fakePush();
    await registerPushSubscription(db, device(admin), { endpoint: "https://web.push.apple.com/admin-device", keys });
    await sendTestNotification(db, admin, "sale.created");
    await processNotificationOutbox(db, { sender: push.sender });
    expect(push.sent.map((message) => message.payload.title)).toEqual(["Vente enregistrée"]);

    const announcement = await saveNotificationTemplate(db, admin, { key: "annonce-nouveautes", kind: "announcement", category: "announcement", icon: "info", linkPath: "/business/dashboard", active: true,
      titleFr: "Nouveautés Qadr Ops", titleEn: "What’s new", titleAr: "الجديد", bodyFr: "Bonjour {{user_name}}, découvrez la clôture de caisse.", bodyEn: "Hi {{user_name}}", bodyAr: "مرحبًا {{user_name}}" });
    await expect(createAnnouncementCampaign(db, owner, { templateId: announcement.id, segment: {} })).rejects.toMatchObject({ status: 403 });
    const campaign = await createAnnouncementCampaign(db, admin, { templateId: announcement.id, segment: { activities: ["phones"], roles: ["owner"] } });
    await setCampaignStatus(db, admin, campaign.id, { action: "pause" });
    await processNotificationOutbox(db, { sender: fakePush().sender });
    expect((await client.query("select 1 from notification where template_key='annonce-nouveautes'")).rows).toHaveLength(0);
    await setCampaignStatus(db, admin, campaign.id, { action: "resume" });
    await processNotificationOutbox(db, { sender: fakePush().sender });
    const reached = await client.query<{ user_id: string; business_id: string }>("select user_id,business_id from notification where template_key='annonce-nouveautes'");
    expect(reached.rows).toEqual([{ user_id: outsider, business_id: other }]);
    await expect(setCampaignStatus(db, admin, campaign.id, { action: "pause" })).rejects.toMatchObject({ code: "campaign_sent" });

    const activity = await getNotificationActivity(db, admin);
    expect(activity.history.length).toBeGreaterThan(5);
    expect(JSON.stringify(activity)).not.toMatch(/Ciment|Bakary|payload/);
    expect(activity.deliveries.some((row) => row.status === "sent")).toBe(true);
    await expect(getNotificationActivity(db, owner)).rejects.toMatchObject({ status: 403 });
  });

  it("mission 11 : un appareil ne passe pas d'un compte à l'autre, ni à l'enregistrement ni par une relance ; liens « // » refusés", async () => {
    const endpoint = "https://web.push.apple.com/admin-down";
    await registerPushSubscription(db, device(admin), { endpoint, keys });
    await sendTestNotification(db, admin, "sale.created");
    await processNotificationOutbox(db, { sender: fakePush().sender });
    const [pending] = (await client.query<{ id: string }>("select d.id from notification_delivery d join push_subscription s on s.id=d.subscription_id where s.endpoint=$1 and d.status='retry'", [endpoint])).rows;
    expect(pending).toBeDefined();
    // Adresse encore active pour l'administrateur : un autre compte ne peut ni la reprendre ni l'oublier.
    await expect(registerPushSubscription(db, device(outsider), { endpoint, keys })).rejects.toMatchObject({ status: 409, code: "push_endpoint_taken" });
    expect(await forgetPushEndpoint(db, outsider, { endpoint })).toEqual({ removed: false });
    // Mission 13 : au chargement, le navigateur d'un autre compte apprend que l'adresse n'est pas à lui
    // (il se désabonne), sans que rien ne change chez l'administrateur.
    expect(await claimPushEndpoint(db, device(outsider), { endpoint })).toEqual({ status: "foreign" });
    expect((await client.query<{ user_id: string; disabled_at: Date | null }>("select user_id, disabled_at from push_subscription where endpoint=$1", [endpoint])).rows[0]!)
      .toEqual({ user_id: admin, disabled_at: null });
    // Déconnexion de l'administrateur, puis un autre compte s'abonne sur le même navigateur.
    expect(await forgetPushEndpoint(db, admin, { endpoint })).toEqual({ removed: true });
    await registerPushSubscription(db, device(outsider), { endpoint, keys });
    // La relance due de l'administrateur ne part pas vers le compte qui a repris l'appareil.
    await client.query("update notification_delivery set next_attempt_at=now() - interval '1 minute' where id=$1", [pending!.id]);
    const after = fakePush();
    await processNotificationOutbox(db, { sender: after.sender });
    expect(after.sent.filter((message) => message.endpoint === endpoint)).toHaveLength(0);

    await expect(saveNotificationTemplate(db, admin, { key: "annonce-externe", kind: "announcement", category: "announcement", icon: "info", linkPath: "//2130706433", active: true,
      titleFr: "x", titleEn: "x", titleAr: "x", bodyFr: "x", bodyEn: "x", bodyAr: "x" })).rejects.toMatchObject({ name: "ZodError" });
    await expect(client.query("update notification_template set link_path='//2130706433' where key='annonce-nouveautes'")).rejects.toThrow(/notification_template_link_check/);
  });

  it("mission 13 : un appareil ne reçoit rien sans session vivante du destinataire (expiration, révocation, aperçu) ; message push sans contenu sensible", async () => {
    const endpoint = "https://web.push.apple.com/admin-session";
    const sendAndCollect = async () => {
      await sendTestNotification(db, admin, "sale.created");
      const push = fakePush();
      await processNotificationOutbox(db, { sender: push.sender });
      return push.sent.filter((message) => message.endpoint === endpoint);
    };
    await registerPushSubscription(db, device(admin), { endpoint, keys });
    const first = await sendAndCollect();
    expect(first).toHaveLength(1);
    // Message push : titre, texte générique, lien interne, étiquette. Ni corps, ni montant, ni nom de client.
    expect(Object.keys(first[0]!.payload).sort()).toEqual(["body", "tag", "title", "url"]);
    expect(JSON.stringify(first[0]!.payload)).not.toMatch(/\d{4,}\s?(F|XOF|CFA)/);

    // Session expirée sans déconnexion : plus rien.
    await client.query("update session set expires_at = now() - interval '1 minute' where id=$1", [`s-${admin}`]);
    expect(await sendAndCollect()).toHaveLength(0);

    // Nouvelle connexion sur le même navigateur : l'adresse est rattachée à la nouvelle session.
    await client.query("insert into session(id,token,user_id,expires_at) values ('s2-admin','s2-admin',$1,now() + interval '7 days')", [admin]);
    expect(await claimPushEndpoint(db, { userId: admin, sessionId: "s2-admin" }, { endpoint })).toEqual({ status: "bound" });
    expect(await sendAndCollect()).toHaveLength(1);

    // Révocation (déconnexion ailleurs, nouveau mot de passe) : la session disparaît, les envois cessent.
    await client.query("delete from session where id='s2-admin'");
    expect((await client.query<{ session_id: string | null }>("select session_id from push_subscription where endpoint=$1", [endpoint])).rows[0]!.session_id).toBeNull();
    expect(await sendAndCollect()).toHaveLength(0);

    // Session d'un autre compte : jamais acceptée comme session de l'appareil de l'administrateur.
    await client.query("update push_subscription set session_id=$1 where endpoint=$2", [`s-${outsider}`, endpoint]);
    expect(await sendAndCollect()).toHaveLength(0);

    // Aperçu de démonstration (aucune session) : l'appareil est enregistré mais ne reçoit rien.
    await client.query("insert into session(id,token,user_id,expires_at) values ('s3-admin','s3-admin',$1,now() + interval '7 days')", [admin]);
    await registerPushSubscription(db, { userId: admin, sessionId: null }, { endpoint, keys });
    expect(await sendAndCollect()).toHaveLength(0);

    // Adresse inconnue : le navigateur doit se désabonner.
    expect(await claimPushEndpoint(db, device(admin), { endpoint: "https://web.push.apple.com/inconnue" })).toEqual({ status: "unknown" });
  });
});
