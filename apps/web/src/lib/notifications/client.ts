"use client";

/*
 * Abonnement push de l'appareil courant (navigateur). Étapes : permission → service worker → abonnement
 * auprès du service push du navigateur (clé publique VAPID du serveur) → enregistrement côté Qadr Ops.
 */

export type PushSupport = "supported" | "unsupported" | "insecure" | "denied" | "unconfigured";
export type PushOutcome = { ok: true } | { ok: false; reason: Exclude<PushSupport, "supported"> | "dismissed" | "network" | "server" };

function base64UrlToBytes(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

const scopeQuery = (scope: "business" | "platform") => (scope === "platform" ? "?scope=platform" : "");

export async function currentPushEndpoint() {
  if (pushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription())?.endpoint ?? null;
}

export async function enablePushOnThisDevice(deviceLabel: string, scope: "business" | "platform" = "business"): Promise<PushOutcome> {
  const support = pushSupport();
  if (support !== "supported") return { ok: false, reason: support };
  let publicKey: string | null;
  try { publicKey = ((await (await fetch("/api/notifications/push-config", { cache: "no-store" })).json()) as { publicKey: string | null }).publicKey; }
  catch { return { ok: false, reason: "network" }; }
  if (!publicKey) return { ok: false, reason: "unconfigured" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const subscribe = () => registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  const save = (subscription: PushSubscription) => {
    const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    return fetch(`/api/notifications/push-subscriptions${scopeQuery(scope)}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: deviceLabel.slice(0, 80) }) });
  };
  try {
    const existing = await registration.pushManager.getSubscription();
    let response = await save(existing ?? await subscribe());
    // 409 : l'adresse de ce navigateur appartient encore à un autre compte. On en demande une neuve, une fois.
    if (response.status === 409 && existing) {
      await existing.unsubscribe().catch(() => false);
      response = await save(await subscribe());
    }
    return response.ok ? { ok: true } : { ok: false, reason: "server" };
  } catch { return { ok: false, reason: "network" }; }
}

/** À la déconnexion : désabonne ce navigateur et prévient le serveur. Ne bloque jamais la déconnexion. */
export async function forgetThisDevice() {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch("/api/notifications/push-subscriptions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
  } catch { /* la déconnexion continue */ }
}

/** Retire un appareil : côté serveur toujours, et désabonne ce navigateur si c'est lui. */
export async function removeDevice(id: string, isThisDevice: boolean, scope: "business" | "platform" = "business") {
  if (isThisDevice) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => false);
  }
  const response = await fetch(`/api/notifications/push-subscriptions/${encodeURIComponent(id)}${scopeQuery(scope)}`, { method: "DELETE" });
  return response.ok;
}

/** Libellé lisible et non identifiant de l'appareil (navigateur + système), sans empreinte détaillée. */
export function deviceLabel() {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Navigateur";
  const system = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return `${browser}${system ? ` · ${system}` : ""}`;
}
