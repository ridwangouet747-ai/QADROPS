"use client";

import posthog from "posthog-js";

export type ProductFeature = "inventory" | "sales" | "reports" | "team";
export type ProductEvent =
  | "saas_signup_completed"
  | "first_product_created"
  | "first_sale_recorded";

let initialized = false;

export function initializeAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (initialized || !key || !host) return false;
  posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
    persistence: "memory",
  });
  initialized = true;
  return true;
}

export function identifyInternalUser(internalUserId: string) {
  if (!initialized || !/^[A-Za-z0-9_-]{8,128}$/.test(internalUserId)) return;
  posthog.identify(internalUserId);
}

export function captureProductEvent(event: ProductEvent) {
  if (initialized) posthog.capture(event);
}

export function captureFeatureUsed(feature: ProductFeature) {
  if (initialized) posthog.capture("feature_used", { feature });
}

export function resetAnalyticsIdentity() {
  if (initialized) posthog.reset();
}
