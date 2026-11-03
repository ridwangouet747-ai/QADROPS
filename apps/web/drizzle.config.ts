import { defineConfig } from "drizzle-kit";

// Migrations : connexion directe Neon (`DATABASE_URL_UNPOOLED`, sans `-pooler`) si elle est déclarée,
// sinon `DATABASE_URL` (même règle que `migrationDatabaseUrl` dans src/lib/env.ts).
// `drizzle-kit generate` et `check` ne contactent aucune base ; l'URL n'est lue que par les commandes distantes.
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim() || "postgresql://localhost/not_configured";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
