import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** Exécute public/sw.js avec un faux `self` et renvoie ses gestionnaires d'événements. */
function loadServiceWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: { data: { url: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://app.qadr.test" },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
    registration: { showNotification: async (title: string, options: { data: { url: string } }) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); }, claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  runInNewContext(readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8"), { self, URL });
  const run = async (type: string, event: object) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  return { run, shown, opened };
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
