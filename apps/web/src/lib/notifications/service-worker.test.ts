import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type FetchCall = { url: string; method: string; body?: string };

/** Exécute public/sw.js avec un faux `self` et renvoie ses gestionnaires d'événements. */
function loadServiceWorker({ network = async () => new Response("réseau"), cacheNames = [] }: {
  network?: (url: string, init?: RequestInit) => Promise<Response>; cacheNames?: string[];
} = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: { data: { url: string } } }[] = [];
  const opened: string[] = [];
  const cached: string[] = [];
  const deleted: string[] = [];
  const fetches: FetchCall[] = [];
  const self = {
    location: { origin: "https://app.qadr.test" },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
    registration: {
      showNotification: async (title: string, options: { data: { url: string } }) => { shown.push({ title, options }); },
      pushManager: { subscribe: async () => ({ endpoint: "https://push.test/renouvele", toJSON: () => ({ endpoint: "https://push.test/renouvele", keys: { p256dh: "p", auth: "a" } }) }) },
    },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); }, claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const caches = {
    open: async () => ({ add: async (request: Request) => { cached.push(new URL(request.url, self.location.origin).pathname); } }),
    keys: async () => cacheNames,
    delete: async (name: string) => { deleted.push(name); return true; },
    match: async (url: string) => (url === "/offline.html" ? new Response("hors ligne") : undefined),
  };
  const fetch = async (input: Request | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    fetches.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    return network(url, init);
  };
  // Request relatif autorisé comme dans un vrai service worker.
  const RelativeRequest = class extends Request { constructor(input: string, init?: RequestInit) { super(new URL(input, self.location.origin), init); } };
  runInNewContext(readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8"), { self, URL, caches, fetch, Request: RelativeRequest, Response });
  const run = async (type: string, event: object) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  /** Déclenche « fetch » ; renvoie le texte de la réponse fournie, ou null si le service worker laisse passer. */
  const navigate = async (mode: string) => {
    let response: Promise<Response> | null = null;
    listeners.fetch!({ request: { mode, url: "https://app.qadr.test/business/pos" }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response ? (await response as Response).text() : null;
  };
  return { run, navigate, shown, opened, cached, deleted, fetches };
}

describe("service worker : liens des notifications", () => {
  it("un lien « // » reçu par push est remplacé par la page des notifications", async () => {
    const sw = loadServiceWorker();
    await sw.run("push", { data: { json: () => ({ title: "Test", url: "//2130706433" }) } });
    await sw.run("push", { data: { json: () => ({ title: "Test", url: "/business/sales" }) } });
    expect(sw.shown.map((item) => item.options.data.url)).toEqual(["/business/notifications", "/business/sales"]);
  });

  it("le clic n'ouvre jamais une autre origine, même si la notification en contient une", async () => {
    const sw = loadServiceWorker();
    const click = (url: string) => sw.run("notificationclick", { notification: { close: () => undefined, data: { url } } });
    await click("https://evil.test/phish");
    await click("/business/sales");
    expect(sw.opened).toEqual(["https://app.qadr.test/business/notifications", "https://app.qadr.test/business/sales"]);
  });
});

describe("service worker : hors ligne", () => {
  it("met en cache la seule page hors ligne et supprime les anciens caches Qadr", async () => {
    // v3 : page hors ligne recolorée en bleu (2026-11-10) ; v1 et v2 sont d'anciennes versions.
    const sw = loadServiceWorker({ cacheNames: ["qadr-offline-v1", "qadr-offline-v2", "qadr-offline-v3", "autre-site"] });
    await sw.run("install", {});
    await sw.run("activate", {});
    expect(sw.cached).toEqual(["/offline.html"]);
    expect(sw.deleted).toEqual(["qadr-offline-v1", "qadr-offline-v2"]);
  });

  it("une navigation passe par le réseau ; la page hors ligne n'apparaît que si le réseau échoue", async () => {
    expect(await loadServiceWorker().navigate("navigate")).toBe("réseau");
    const offline = loadServiceWorker({ network: async () => { throw new TypeError("Failed to fetch"); } });
    expect(await offline.navigate("navigate")).toBe("hors ligne");
  });

  it("les appels d'API et les fichiers ne sont jamais interceptés ni servis depuis un cache", async () => {
    const sw = loadServiceWorker({ network: async () => { throw new TypeError("Failed to fetch"); } });
    expect(await sw.navigate("cors")).toBeNull();
    expect(await sw.navigate("same-origin")).toBeNull();
    expect(sw.fetches).toEqual([]);
  });
});

describe("service worker : renouvellement de l'abonnement push", () => {
  const change = { oldSubscription: { endpoint: "https://push.test/ancien", options: {} }, newSubscription: null };

  it("enregistre la nouvelle adresse pour la session commerçant puis oublie l'ancienne", async () => {
    const sw = loadServiceWorker();
    await sw.run("pushsubscriptionchange", change);
    expect(sw.fetches.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/notifications/push-subscriptions", "DELETE /api/notifications/push-subscriptions",
    ]);
    expect(JSON.parse(sw.fetches[0]!.body!)).toEqual({ endpoint: "https://push.test/renouvele", keys: { p256dh: "p", auth: "a" } });
    expect(JSON.parse(sw.fetches[1]!.body!)).toEqual({ endpoint: "https://push.test/ancien" });
  });

  it("essaie la console plateforme quand il n'y a pas de session commerçant", async () => {
    const sw = loadServiceWorker({ network: async (url: string) => new Response("{}", { status: url.includes("scope=platform") ? 201 : 401 }) });
    await sw.run("pushsubscriptionchange", change);
    expect(sw.fetches.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/notifications/push-subscriptions", "POST /api/notifications/push-subscriptions?scope=platform", "DELETE /api/notifications/push-subscriptions",
    ]);
  });

  it("sans aucune session, n'oublie pas l'ancienne adresse", async () => {
    const sw = loadServiceWorker({ network: async () => new Response("{}", { status: 401 }) });
    await sw.run("pushsubscriptionchange", change);
    expect(sw.fetches.every((call) => call.method === "POST")).toBe(true);
  });
});
