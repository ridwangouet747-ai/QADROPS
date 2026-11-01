"use client";

import { useSyncExternalStore } from "react";

/*
 * Application installable (mission 11, phase 2) : enregistrement du service worker sur toutes les pages,
 * invite d'installation du navigateur et état du réseau. Rien ici ne stocke de donnée du commerce.
 */

export type InstallPlatform = "android" | "ios" | "desktop";

/** Plateforme d'après le navigateur. iPadOS se présente comme un Mac : on le reconnaît à l'écran tactile. */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "desktop";
}

/** Application ouverte depuis l'écran d'accueil ou en fenêtre dédiée (déjà installée). */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Enregistre /sw.js une fois par chargement. Sans HTTPS (hors localhost) ou sans support, ne fait rien. */
export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch { return null; }
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

/** À appeler une fois au démarrage : garde l'invite du navigateur pour la proposer au bon moment. */
export function listenForInstallPrompt() {
  if (typeof window === "undefined") return () => undefined;
  const onPrompt = (event: Event) => { event.preventDefault(); deferredPrompt = event as BeforeInstallPromptEvent; notify(); };
  const onInstalled = () => { installed = true; deferredPrompt = null; notify(); };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
}

export type InstallState = { installed: boolean; canPrompt: boolean };
let snapshot: InstallState = { installed: false, canPrompt: false };
function installSnapshot(): InstallState {
  const next = { installed: installed || isStandalone(), canPrompt: deferredPrompt !== null };
  if (next.installed !== snapshot.installed || next.canPrompt !== snapshot.canPrompt) snapshot = next;
  return snapshot;
}
const serverInstallState: InstallState = { installed: false, canPrompt: false };

export function useInstallState() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, installSnapshot, () => serverInstallState);
}

/** Ouvre l'invite du navigateur (Chrome, Edge, Android). Renvoie « unavailable » si le navigateur n'en propose pas. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";
  deferredPrompt = null; // une invite ne sert qu'une fois
  notify();
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === "accepted") { installed = true; notify(); }
  return outcome;
}

/** `navigator.onLine` faux = sûrement hors ligne ; vrai ne garantit pas que le serveur répond. */
export function useOnline() {
  return useSyncExternalStore(
    (listener) => { window.addEventListener("online", listener); window.addEventListener("offline", listener); return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); }; },
    () => navigator.onLine,
    () => true,
  );
}

const dismissKey = "qadr-install-invite-dismissed";
/** L'invitation à installer est refusable ; le choix est gardé sur cet appareil seulement. */
export function installInviteDismissed() {
  try { return window.localStorage.getItem(dismissKey) === "1"; } catch { return false; }
}
export function dismissInstallInvite() {
  try { window.localStorage.setItem(dismissKey, "1"); } catch { /* stockage indisponible : l'invitation reviendra */ }
}
