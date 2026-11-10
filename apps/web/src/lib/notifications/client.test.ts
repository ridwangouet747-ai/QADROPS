import { afterEach, describe, expect, it, vi } from "vitest";
import { enablePushOnThisDevice, forgetThisDevice, syncPushDevice } from "./client";

/*
 * Mission 16 : parcours navigateur de l'abonnement push (`client.ts`), avec un faux navigateur.
 * Vérifie l'ordre des appels au serveur et au service push du navigateur ; aucun service push réel.
 */
type Call = { url: string; method: string; body: Record<string, unknown> | null };

function fakeBrowser(options: {
  existing?: string | null; permission?: NotificationPermission; publicKey?: string | null;
  respond?: (call: Call) => Response | Promise<Response>;
} = {}) {
  const calls: Call[] = [];
  const unsubscribed: string[] = [];
  let counter = 0;
  const subscription = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "cle-publique", auth: "secret" } }),
    unsubscribe: async () => { unsubscribed.push(endpoint); current = null; return true; },
  });
  let current: ReturnType<typeof subscription> | null = options.existing ? subscription(options.existing) : null;
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async () => { current = subscription(`https://fcm.googleapis.com/fcm/send/neuf-${++counter}`); return current; },
  };
  const registration = { pushManager };
  vi.stubGlobal("window", { isSecureContext: true, PushManager: class {}, Notification: class {} });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) }, userAgent: "test" });
  vi.stubGlobal("Notification", { permission: "default", requestPermission: async () => options.permission ?? "granted" });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const call = { url: input, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null };
    calls.push(call);
    if (input === "/api/notifications/push-config") return Response.json({ publicKey: options.publicKey === undefined ? "BAAA" : options.publicKey });
    return options.respond ? options.respond(call) : new Response(null, { status: 200 });
  }));
  return { calls, unsubscribed, current: () => current };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("navigateur : activation des notifications push", () => {
  it("abonne l'appareil puis l'enregistre pour la session courante", async () => {
    const browser = fakeBrowser();
    expect(await enablePushOnThisDevice("Chrome · Android")).toEqual({ ok: true });
    const saved = browser.calls.find((call) => call.method === "POST")!;
    expect(saved.url).toBe("/api/notifications/push-subscriptions");
    expect(saved.body).toMatchObject({ endpoint: "https://fcm.googleapis.com/fcm/send/neuf-1", keys: { p256dh: "cle-publique", auth: "secret" }, deviceLabel: "Chrome · Android" });
  });

  it("409 (adresse encore à un autre compte) : révoque l'ancienne adresse et en enregistre une neuve, une seule fois", async () => {
    let posts = 0;
    const browser = fakeBrowser({ existing: "https://fcm.googleapis.com/fcm/send/ancienne", respond: (call) => new Response(null, { status: call.method === "POST" && ++posts === 1 ? 409 : 201 }) });
    expect(await enablePushOnThisDevice("Chrome")).toEqual({ ok: true });
    expect(browser.unsubscribed).toEqual(["https://fcm.googleapis.com/fcm/send/ancienne"]);
    expect(browser.calls.filter((call) => call.method === "POST").map((call) => call.body!.endpoint))
      .toEqual(["https://fcm.googleapis.com/fcm/send/ancienne", "https://fcm.googleapis.com/fcm/send/neuf-1"]);
  });

  it("serveur sans clés VAPID : rien n'est demandé à la personne ; permission refusée : rien n'est enregistré", async () => {
    let browser = fakeBrowser({ publicKey: null });
    expect(await enablePushOnThisDevice("Chrome")).toEqual({ ok: false, reason: "unconfigured" });
    expect(browser.current()).toBeNull();
    vi.unstubAllGlobals();
    browser = fakeBrowser({ permission: "denied" });
    expect(await enablePushOnThisDevice("Chrome")).toEqual({ ok: false, reason: "denied" });
    expect(browser.calls.some((call) => call.method === "POST")).toBe(false);
  });
});

describe("navigateur : appareil partagé et déconnexion", () => {
  it("au chargement, une adresse « foreign » ou « unknown » est révoquée ; « bound » est gardée", async () => {
    for (const [status, revoked] of [["foreign", true], ["unknown", true], ["bound", false]] as const) {
      const browser = fakeBrowser({ existing: "https://fcm.googleapis.com/fcm/send/partage", respond: () => Response.json({ status }) });
      await syncPushDevice();
      expect(browser.calls.at(-1)).toMatchObject({ url: "/api/notifications/push-subscriptions/claim", method: "POST", body: { endpoint: "https://fcm.googleapis.com/fcm/send/partage" } });
      expect(browser.unsubscribed.length > 0).toBe(revoked);
      vi.unstubAllGlobals();
    }
  });

  it("au chargement, une panne réseau ne révoque rien et ne lève pas d'erreur", async () => {
    const browser = fakeBrowser({ existing: "https://fcm.googleapis.com/fcm/send/x", respond: () => { throw new TypeError("hors ligne"); } });
    await expect(syncPushDevice()).resolves.toBeUndefined();
    expect(browser.unsubscribed).toEqual([]);
  });

  it("déconnexion : le serveur oublie l'adresse, puis le navigateur se désabonne ; même serveur injoignable", async () => {
    let browser = fakeBrowser({ existing: "https://fcm.googleapis.com/fcm/send/moi" });
    await forgetThisDevice();
    expect(browser.calls).toEqual([{ url: "/api/notifications/push-subscriptions", method: "DELETE", body: { endpoint: "https://fcm.googleapis.com/fcm/send/moi" } }]);
    expect(browser.unsubscribed).toEqual(["https://fcm.googleapis.com/fcm/send/moi"]);
    vi.unstubAllGlobals();
    browser = fakeBrowser({ existing: "https://fcm.googleapis.com/fcm/send/moi", respond: () => { throw new TypeError("hors ligne"); } });
    await expect(forgetThisDevice()).resolves.toBeUndefined();
    expect(browser.unsubscribed).toEqual(["https://fcm.googleapis.com/fcm/send/moi"]);
  });
});
