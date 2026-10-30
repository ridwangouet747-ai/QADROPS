import { migrate } from "drizzle-orm/neon-http/migrator";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { requireDatabaseUrl } from "../src/lib/env";

async function main() {
  const url = requireDatabaseUrl();
  if (process.env.QADR_DB_TARGET !== "development") {
    throw new Error("Refus : définissez QADR_DB_TARGET=development uniquement après avoir vérifié la cible.");
  }
  const connection = new URL(url);
  const target = `${connection.hostname}/${connection.pathname.replace(/^\//, "")}`;
  console.log(`Cible déclarée pour migration : ${target}`);
  const prompt = createInterface({ input: stdin, output: stdout });
  const confirmation = await prompt.question("Pour confirmer, saisissez exactement MIGRER CETTE BASE DE DÉVELOPPEMENT : ");
  prompt.close();
  if (confirmation !== "MIGRER CETTE BASE DE DÉVELOPPEMENT") {
    throw new Error("Confirmation incorrecte ; aucune migration exécutée.");
  }
  const db = drizzle(neon(url));
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations Drizzle appliquées à la cible explicitement confirmée.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Erreur inconnue";
  console.error(message);
  process.exitCode = 1;
});
