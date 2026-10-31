/**
 * Procédure administrative d'attribution ou de retrait d'un droit Super Admin (Qadr Agency).
 * Aucune route HTTP ne peut le faire : seul un opérateur ayant accès à la base l'exécute, après
 * confirmation explicite. Chaque opération est tracée dans le journal d'audit.
 *
 *   npx tsx scripts/platform-admin.ts grant  --email admin@exemple.ci --reason "Ouverture de la console" [--by autre-admin@exemple.ci]
 *   npx tsx scripts/platform-admin.ts revoke --email ancien@exemple.ci --reason "Départ de l'équipe" --by admin@exemple.ci
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/lib/db/client";
import { user } from "../src/lib/db/schema";
import type { CommercialDatabase } from "../src/lib/domain/commercial";
import { grantPlatformAdmin, revokePlatformAdmin } from "../src/lib/domain/platform";
import { requireDatabaseUrl } from "../src/lib/env";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const action = process.argv[2];
  if (action !== "grant" && action !== "revoke") throw new Error("Action attendue : grant ou revoke.");
  const email = argument("email");
  const reason = argument("reason");
  if (!email || !reason) throw new Error("--email et --reason sont obligatoires.");
  if (process.env.QADR_DB_TARGET !== "development" && process.env.QADR_DB_TARGET !== "production") {
    throw new Error("Refus : définissez QADR_DB_TARGET (development ou production) après avoir vérifié la cible.");
  }
  const url = requireDatabaseUrl();
  const target = new URL(url);
  console.log(`Cible : ${target.hostname}${target.pathname} (${process.env.QADR_DB_TARGET})`);
  const prompt = createInterface({ input: stdin, output: stdout });
  const confirmation = await prompt.question(`Pour ${action === "grant" ? "ATTRIBUER" : "RETIRER"} le droit Super Admin à ${email}, saisissez exactement CONFIRMER : `);
  prompt.close();
  if (confirmation !== "CONFIRMER") throw new Error("Confirmation incorrecte ; rien n’a été modifié.");

  const db = createDatabase(url) as unknown as CommercialDatabase;
  const byEmail = argument("by");
  const [by] = byEmail ? await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${byEmail.toLowerCase()}`).limit(1) : [];
  if (byEmail && !by) throw new Error("Le compte indiqué par --by est introuvable.");
  const input = { email, reason, grantedByUserId: by?.id ?? null };
  const result = action === "grant" ? await grantPlatformAdmin(db, input) : await revokePlatformAdmin(db, input);
  console.log(`Opération enregistrée pour l’utilisateur ${result.userId}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inconnue");
  process.exitCode = 1;
});
