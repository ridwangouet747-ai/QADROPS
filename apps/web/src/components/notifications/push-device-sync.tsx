"use client";

import { useEffect } from "react";
import { syncPushDevice } from "@/lib/notifications/client";

/** Monté dans les espaces connectés : rattache ou coupe l'abonnement push de ce navigateur (mission 13). */
export function PushDeviceSync() {
  useEffect(() => { void syncPushDevice(); }, []);
  return null;
}
