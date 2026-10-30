import { neon } from "@neondatabase/serverless";
import { requireDatabaseUrl } from "../src/lib/env";

async function main() {
  const url = requireDatabaseUrl();
  const sql = neon(url);
  await sql`select 1 as connected`;
  console.log("Connexion de lecture réussie. Aucune donnée modifiée.");
}

main().catch(() => {
  console.error("Vérification impossible. Contrôlez DATABASE_URL et l’accès réseau sans l’afficher.");
  process.exitCode = 1;
});
