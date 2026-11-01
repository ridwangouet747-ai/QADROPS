/* global self, URL */
/*
 * Service worker Qadr Ops (mission 10) : affichage des notifications push uniquement.
 * Aucune mise en cache de pages ni de données (l'application ne fonctionne pas hors ligne, et rien de
 * sensible n'est conservé ici). Le message reçu ne contient qu'un titre, un texte générique et un lien
 * interne ; le clic ouvre ce lien sur l'origine de Qadr Ops, jamais une adresse externe.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Qadr Ops";
  const body = typeof data.body === "string" ? data.body.slice(0, 240) : "";
  const url = typeof data.url === "string" && /^\/[A-Za-z0-9/_-]*$/.test(data.url) ? data.url : "/business/notifications";
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: typeof data.tag === "string" ? data.tag : undefined, icon: "/qadr-preview-mark.svg", badge: "/qadr-preview-mark.svg", data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/business/notifications", self.location.origin);
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
