"use client";

import { authClient } from "./client";
import { resetAnalyticsIdentity } from "@/lib/analytics/client";
import { forgetThisDevice } from "@/lib/notifications/client";

export async function signOutAndResetAnalytics() {
  try {
    // Avant la fin de session : le serveur doit encore savoir à qui appartient l'appareil.
    await forgetThisDevice();
    return await authClient.signOut();
  } finally {
    resetAnalyticsIdentity();
  }
}
