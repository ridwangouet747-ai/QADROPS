import type { CommercialDatabase } from "@/lib/domain/commercial";
import { isLocalPreview } from "@/lib/preview/mode";
import { getDatabase } from "./client";

/**
 * Base des routes sans contexte de commerce (webhooks, tâches planifiées, routes publiques).
 * En aperçu local, c'est la base de démonstration en mémoire, la même que celle des pages et des routes
 * métier : un webhook doit retrouver le paiement créé par la caisse d'abonnement de l'aperçu, et aucune
 * route de l'aperçu ne doit joindre Neon (`next dev` recharge `.env.local`, donc parfois `DATABASE_URL`).
 */
export async function getRuntimeDatabase(): Promise<CommercialDatabase> {
  if (isLocalPreview()) {
    const { getPreviewDatabase } = await import("@/lib/preview/database");
    return await getPreviewDatabase() as unknown as CommercialDatabase;
  }
  return getDatabase() as unknown as CommercialDatabase;
}
