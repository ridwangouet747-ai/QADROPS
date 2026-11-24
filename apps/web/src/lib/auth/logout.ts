"use client";

import { authClient } from "./client";
import { announceAccountChange } from "@/lib/client/data-cache";
import { forgetThisDevice } from "@/lib/notifications/client";
import { forgetPendingSale } from "@/lib/pos/pending-sale";

/** Déconnexion de cet appareil : abonnement push rattaché à la session, vente en attente et données en mémoire effacés. */
export async function signOutOfThisDevice() {
  try {
    // Avant la fin de session : le serveur doit encore savoir à qui appartient l'appareil.
    await forgetThisDevice();
    return await authClient.signOut();
  } finally {
    forgetPendingSale();
    announceAccountChange();
  }
}
