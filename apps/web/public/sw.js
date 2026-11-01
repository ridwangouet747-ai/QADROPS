/* global self, URL, caches, fetch, Request, Response */
/*
 * Service worker Qadr Ops (missions 10 et 11).
 * - Notifications push : le message reçu ne contient qu'un titre, un texte générique et un lien interne ;
 *   le clic ouvre ce lien sur l'origine de Qadr Ops, jamais une adresse externe.
 * - Hors ligne : seule la page statique /offline.html est mise en cache. Aucune page de l'application,
 *   aucune donnée du commerce et aucune réponse d'API n'est conservée ici : sans réseau, rien ne peut
 *   être enregistré, et la page le dit.
 */
const OFFLINE_CACHE = "qadr-offline-v2";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("qadr-") && name !== OFFLINE_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

// Navigation seulement : le réseau d'abord, toujours ; la page hors ligne uniquement si le réseau échoue.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
});

self.addEventListener("push", (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Qadr Ops";
  const body = typeof data.body === "string" ? data.body.slice(0, 240) : "";
  const url = typeof data.url === "string" && /^\/(?:[A-Za-z0-9_-][A-Za-z0-9/_-]*)?$/.test(data.url) ? data.url : "/business/notifications";
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: typeof data.tag === "string" ? data.tag : undefined, icon: "/icons/icon-192.png", data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/business/notifications", self.location.origin);
  // Dernier rempart : quoi que contienne la notification, on n'ouvre jamais une autre origine.
  if (target.origin !== self.location.origin) target = new URL("/business/notifications", self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target.href);
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

/*
 * Le navigateur a renouvelé l'abonnement push (expiration, rotation des clés) : on enregistre la nouvelle
 * adresse pour la session en cours (commerce, puis console), puis on oublie l'ancienne. Sans session, rien
 * n'est enregistré : la personne réactivera les notifications à sa prochaine connexion.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const fresh = event.newSubscription || (old && old.options ? await self.registration.pushManager.subscribe(old.options) : null);
    if (!fresh) return;
    const json = fresh.toJSON();
    const body = JSON.stringify({ endpoint: json.endpoint, keys: json.keys });
    const save = (query) => fetch(`/api/notifications/push-subscriptions${query}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const saved = (await save("")).ok || (await save("?scope=platform")).ok;
    if (saved && old && old.endpoint !== fresh.endpoint) {
      await fetch("/api/notifications/push-subscriptions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: old.endpoint }) });
    }
  })().catch(() => undefined));
});
