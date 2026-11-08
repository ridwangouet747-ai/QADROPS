import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as claimRoute from "@/app/api/notifications/push-subscriptions/claim/route";
import * as pushSubscriptionRoute from "@/app/api/notifications/push-subscriptions/[subscriptionId]/route";
import * as pushSubscriptionsRoute from "@/app/api/notifications/push-subscriptions/route";
import { HARNESS_ORIGIN, startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 13 : un appareil (navigateur) partagé ne doit jamais recevoir les notifications d'un autre compte.
 * Vraies routes, vraies sessions Better Auth, base PGlite migrée. L'envoi lui-même (session vivante exigée)
 * est couvert par `notifications.integration.test.ts`.
 */
const KEYS = { p256dh: `B${"A".repeat(86)}`, auth: "AAAAAAAAAAAAAAAAAAAAAA" };
const SHARED = "https://fcm.googleapis.com/fcm/send/appareil-partage";

describe("appareil partagé : isolation des notifications push", () => {
  let h: HttpHarness;
  let awa: Actor; let koffi: Actor; let bakary: Actor;

  const register = (actor: Actor, endpoint: string) =>
    h.call(pushSubscriptionsRoute.POST, { path: "/api/notifications/push-subscriptions", actor, body: { endpoint, keys: KEYS, deviceLabel: "Chrome · Android" } });
  const claim = (actor: Actor | null, endpoint: string) => h.call(claimRoute.POST, { path: "/api/notifications/push-subscriptions/claim", actor, body: { endpoint } });
  const device = async (endpoint: string) => (await h.client.query<{ id: string; user_id: string; session_id: string | null; disabled_reason: string | null; p256dh: string }>(
    "select id, user_id, session_id, disabled_reason, p256dh from push_subscription where endpoint = $1", [endpoint])).rows[0]!;
  const sessionIdOf = async (actor: Actor) => {
    const token = decodeURIComponent(/better-auth\.session_token=([^;]+)/.exec(actor.cookie)?.[1] ?? "").split(".")[0];
    return (await h.client.query<{ id: string }>("select id from session where token = $1", [token])).rows[0]!.id;
  };

  beforeAll(async () => {
    h = await startHttpHarness();
    awa = await h.signUp("Awa Boutique", "awa@push.test");
    await h.createBusiness(awa, "Boutique Awa");
    koffi = await h.addMember(awa, "Koffi Caisse", "koffi@push.test", "cashier");
    bakary = await h.signUp("Bakary Phones", "bakary@push.test");
    await h.createBusiness(bakary, "Bakary Phones");
  });
  afterAll(async () => { await h?.close(); });

  it("l'appareil est rattaché au compte et à la session qui l'enregistrent", async () => {
    expect((await register(awa, SHARED)).status).toBe(201);
    const row = await device(SHARED);
    expect(row.user_id).toBe(awa.userId);
    expect(row.session_id).toBe(await sessionIdOf(awa));
  });

  it("un autre compte sur le même navigateur apprend que l'adresse n'est pas à lui, sans rien modifier chez l'ancien compte", async () => {
    const before = await device(SHARED);
    const result = await claim(bakary, SHARED);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "foreign" });
    expect(await device(SHARED)).toEqual(before);
    // S'il active ses notifications avec cette adresse : refusé ; son navigateur en demande une neuve.
    const taken = await register(bakary, SHARED);
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("push_endpoint_taken");
    expect(await device(SHARED)).toEqual(before);
    expect((await register(bakary, "https://fcm.googleapis.com/fcm/send/appareil-partage-neuf")).status).toBe(201);
  });

  it("un membre du même commerce ne peut ni reprendre, ni oublier, ni supprimer l'appareil d'un autre", async () => {
    const row = await device(SHARED);
    expect((await register(koffi, SHARED)).status).toBe(409);
    const forget = await h.call(pushSubscriptionsRoute.DELETE, { method: "DELETE", path: "/api/notifications/push-subscriptions", actor: koffi, body: { endpoint: SHARED } });
    expect(forget.body).toEqual({ removed: false });
    const removal = await h.call(pushSubscriptionRoute.DELETE, { method: "DELETE", path: `/api/notifications/push-subscriptions/${row.id}`, actor: koffi, params: { subscriptionId: row.id } });
    expect(removal.status).toBe(404);
    expect(await device(SHARED)).toEqual(row);
  });

  it("le propriétaire de l'appareil le retrouve à la reconnexion (nouvelle session)", async () => {
    const again = await h.signIn(awa);
    const result = await claim(again, SHARED);
    expect(result.body).toEqual({ status: "bound" });
    expect((await device(SHARED)).session_id).toBe(await sessionIdOf(again));
  });

  it("déconnexion par Better Auth, même sans que le navigateur prévienne : la session disparaît de l'appareil", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/deconnexion-brutale";
    expect((await register(bakary, endpoint)).status).toBe(201);
    const out = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-out`, { method: "POST", headers: { cookie: bakary.cookie, origin: HARNESS_ORIGIN } }));
    expect(out.status).toBe(200);
    expect((await device(endpoint)).session_id).toBeNull();
  });

  it("refus sans session et adresse inconnue", async () => {
    expect((await claim(null, SHARED)).status).toBe(401);
    expect((await register({ ...awa, cookie: "" }, SHARED)).status).toBe(401);
    expect((await claim(awa, "https://fcm.googleapis.com/fcm/send/jamais-vue")).body).toEqual({ status: "unknown" });
  });
});
