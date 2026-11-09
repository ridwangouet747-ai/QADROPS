import { Pool, neonConfig } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/neon-serverless";
import { databaseSchema } from "./schema";
import { requireDatabaseUrl } from "@/lib/env";
import { isLocalPreview } from "@/lib/preview/mode";

function openDatabase(url: string) {
  // Pool uses the Node.js WebSocket implementation and supports interactive transactions.
  if (typeof globalThis.WebSocket === "undefined") {
    throw new Error("QADR OPS database access requires the Node.js runtime with WebSocket support.");
  }
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString: url, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
  // Vercel Fluid Compute : libère les connexions inactives avant la mise en veille de l'instance.
  // Sans effet hors de Vercel (tests, développement).
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema: databaseSchema });
}

const databases = new Map<string, ReturnType<typeof openDatabase>>();

/**
 * Base partagée par toutes les requêtes du processus (une connexion par URL). Auparavant, chaque
 * requête ouvrait un pool jamais fermé, ce qui laissait des connexions ouvertes vers Neon.
 *
 * Refusée en aperçu local : `scripts/preview.mjs` retire `DATABASE_URL`, mais `next dev` recharge ensuite
 * `.env.local`. Sans ce garde-fou, une route oubliée de l'aperçu joindrait Neon. Les routes passent par
 * `getRuntimeDatabase()` (`./runtime`) ou par le contexte de commerce, qui choisissent la base de démonstration.
 */
export function getDatabase(url?: string) {
  if (isLocalPreview()) throw new Error("Aperçu local : la base Neon n'est jamais utilisée (base de démonstration en mémoire).");
  const target = url ?? requireDatabaseUrl();
  let database = databases.get(target);
  if (!database) {
    database = openDatabase(target);
    databases.set(target, database);
  }
  return database;
}

/**
 * Ferme tous les pools ouverts par ce processus. Réservé aux scripts (`scripts/platform-owner.ts`) :
 * sans cela, le processus attend l'expiration des connexions inactives avant de se terminer.
 * Jamais appelé par une route : le pool est partagé par les requêtes de l'instance.
 */
export async function closeDatabases() {
  const open = [...databases.values()];
  databases.clear();
  await Promise.all(open.map((database) => database.$client.end()));
}
