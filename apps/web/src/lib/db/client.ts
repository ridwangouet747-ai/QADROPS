import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { databaseSchema } from "./schema";
import { requireDatabaseUrl } from "@/lib/env";

export function createDatabase(url = requireDatabaseUrl()) {
  // Pool uses the Node.js WebSocket implementation and supports interactive transactions.
  if (typeof globalThis.WebSocket === "undefined") {
    throw new Error("QADR OPS database access requires the Node.js runtime with WebSocket support.");
  }
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString: url });
  return drizzle({ client: pool, schema: databaseSchema });
}
