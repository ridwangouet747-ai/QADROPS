import { Pool, neonConfig } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/neon-serverless";
import { databaseSchema } from "./schema";
import { requireDatabaseUrl } from "@/lib/env";

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
 */
export function getDatabase(url = requireDatabaseUrl()) {
  let database = databases.get(url);
  if (!database) {
    database = openDatabase(url);
    databases.set(url, database);
  }
  return database;
}
