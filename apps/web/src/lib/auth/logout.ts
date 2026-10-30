"use client";

import { authClient } from "./client";
import { resetAnalyticsIdentity } from "@/lib/analytics/client";

export async function signOutAndResetAnalytics() {
  try {
    return await authClient.signOut();
  } finally {
    resetAnalyticsIdentity();
  }
}
