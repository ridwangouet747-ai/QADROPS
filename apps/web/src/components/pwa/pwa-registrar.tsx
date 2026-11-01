"use client";

import { useEffect } from "react";
import { listenForInstallPrompt, registerServiceWorker } from "@/lib/pwa/client";

/** Monté une fois dans la mise en page racine : service worker sur toutes les pages, invite d'installation gardée. */
export function PwaRegistrar() {
  useEffect(() => {
    const stop = listenForInstallPrompt();
    void registerServiceWorker();
    return stop;
  }, []);
  return null;
}
