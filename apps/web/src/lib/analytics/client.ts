"use client";

import type { PostHog } from "posthog-js";
import { genericPath, keptSystemProperties, sanitizeEvent, type AnalyticsEvent, type AnalyticsProperties } from "./events";

/*
 * PostHog côté navigateur (missions 03 et 10). Rien n'est chargé ni envoyé :
 * - sans clé publique configurée (NEXT_PUBLIC_POSTHOG_KEY) ;
 * - sans accord explicite de la personne (bandeau de consentement), ou si le navigateur demande de ne pas
 *   être suivi (Global Privacy Control / Do Not Track).
 * Autocapture, pages vues automatiques et enregistrement de session restent désactivés ; chaque événement
 * passe par le catalogue (events.ts) et `before_send` retire toute propriété non prévue.
 *
 * La bibliothèque n'est téléchargée qu'après l'accord (import dynamique) : sans accord, aucune page ne paie son
 * poids (≈ 100 Ko compressés retirés du fragment partagé, mesure du 2026-11-21). Un événement émis pendant le
 * chargement attend la bibliothèque ; il n'est pas envoyé si l'accord a été retiré entre-temps.
 */

const consentKey = "qadr-analytics-consent";
export type Consent = "granted" | "denied" | null;
let initialized = false;
let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

export function analyticsConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST);
}

/** Signal « ne pas me suivre » du navigateur : vaut refus, sans bandeau. */
export function browserRefusesTracking() {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

export function readConsent(): Consent {
  if (browserRefusesTracking()) return "denied";
  try { const value = localStorage.getItem(consentKey); return value === "granted" || value === "denied" ? value : null; } catch { return null; }
}

export function setConsent(value: "granted" | "denied") {
  try { localStorage.setItem(consentKey, value); } catch { /* stockage bloqué : la question reviendra */ }
  if (value === "granted") initializeAnalytics();
  else if (client) { client.opt_out_capturing(); client.reset(); }
}

/** Vrai si la mesure est (ou va être) active : configurée et acceptée. Le chargement se poursuit en arrière-plan. */
export function initializeAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host || readConsent() !== "granted") return false;
  if (initialized) { client?.opt_in_capturing(); return true; }
  initialized = true;
  loading = import("posthog-js").then(({ default: posthog }) => {
    // L'accord a pu être retiré pendant le téléchargement : rien n'est initialisé.
    if (readConsent() !== "granted") { initialized = false; return null; }
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: "identified_only",
      persistence: "memory",
      respect_dnt: true,
      before_send: (event) => {
        if (!event) return null;
        if (event.event === "$identify" || event.event === "$opt_in") {
          event.properties = Object.fromEntries(Object.entries(event.properties ?? {}).filter(([name]) => keptSystemProperties.has(name)));
          return event;
        }
        const clean = sanitizeEvent(event.event, event.properties as Record<string, unknown>);
        if (!clean) return null;
        const system = Object.fromEntries(Object.entries(event.properties ?? {}).filter(([name]) => keptSystemProperties.has(name)));
        event.properties = { ...system, ...clean, path: genericPath(window.location.pathname) };
        delete event.$set; delete event.$set_once;
        return event;
      },
    });
    client = posthog;
    return posthog;
  }).catch(() => {
    // Réseau coupé ou script bloqué : la mesure reste inactive, l'application continue.
    initialized = false;
    loading = null;
    return null;
  });
  return true;
}

/** Attend la fin du chargement éventuel de PostHog (tests et identification). */
export async function analyticsLoaded(): Promise<boolean> {
  return Boolean(await loading);
}

/** Identifiant pseudonyme : empreinte SHA-256 de l'identifiant interne (jamais l'e-mail ni le nom). */
export async function identifyInternalUser(internalUserId: string) {
  const posthog = await loading;
  if (!posthog || !/^[A-Za-z0-9_-]{8,128}$/.test(internalUserId) || !crypto?.subtle) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qadr-ops:${internalUserId}`));
  posthog.identify(Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

/** Envoie un événement du catalogue (ignoré sans accord ; jamais bloquant ni source d'erreur). */
export function track<E extends AnalyticsEvent>(event: E, properties?: AnalyticsProperties<E>) {
  if (!initialized || !loading) return;
  const clean = sanitizeEvent(event, properties as Record<string, unknown>) ?? undefined;
  void loading.then((posthog) => {
    if (!posthog || readConsent() !== "granted") return;
    try { posthog.capture(event, clean); } catch { /* l'analyse ne doit jamais gêner l'utilisation */ }
  });
}

export function resetAnalyticsIdentity() {
  client?.reset();
}
