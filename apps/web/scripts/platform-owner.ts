/**
 * Compte propriétaire de la plateforme Qadr Ops (mission 13). Usage contrôlé, jamais automatique :
 *
 *   # Initialisation (refusée si un propriétaire est déjà actif)
 *   $env:QADR_DB_TARGET = "production"; $env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_EMAIL = "..."
 *   $env:QADR_OWNER_NAME = "..."; $env:QADR_OWNER_PASSWORD = "..."   # au moins 12 caractères
 *   npx tsx scripts/platform-owner.ts bootstrap
 *
 *   # Nouveau mot de passe (ferme toutes les sessions du propriétaire)
 *   $env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_PASSWORD = "..."
 *   npx tsx scripts/platform-owner.ts reset-password
 *
 * Les valeurs viennent de variables d'environnement de la session du terminal (jamais d'un fichier suivi,
 * jamais de l'historique de commandes si on les saisit avec Read-Host). Le script n'affiche ni mot de passe
 * ni URL de connexion complète. Effacer ensuite les variables : Remove-Item Env:QADR_OWNER_PASSWORD.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createQadrAuth } from "../src/lib/auth/server";
import { getDatabase } from "../src/lib/db/client";
import type { CommercialDatabase } from "../src/lib/domain/commercial";
import { bootstrapPlatformOwner, resetPlatformOwnerPassword } from "../src/lib/domain/platform-owner";
import { readEnvironment, requireDatabaseUrl } from "../src/lib/env";

async function main() {
  const action = process.argv[2];
  if (action !== "bootstrap" && action !== "reset-password") throw new Error("Action attendue : bootstrap ou reset-password.");
  if (process.env.QADR_DB_TARGET !== "development" && process.env.QADR_DB_TARGET !== "production") {
    throw new Error("Refus : définissez QADR_DB_TARGET (development ou production) après avoir vérifié la cible.");
  }
  const env = readEnvironment();
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error("BETTER_AUTH_SECRET (32 caractères au moins) est requis.");
  const url = requireDatabaseUrl();
  const target = new URL(url);
  console.log(`Cible : ${target.hostname}${target.pathname} (${process.env.QADR_DB_TARGET})`);
  const username = process.env.QADR_OWNER_USERNAME ?? "";
  const prompt = createInterface({ input: stdin, output: stdout });
  const confirmation = await prompt.question(`${action === "bootstrap" ? "Créer" : "Renouveler le mot de passe de"} le propriétaire « ${username} » : saisissez exactement CONFIRMER : `);
  prompt.close();
  if (confirmation !== "CONFIRMER") throw new Error("Confirmation incorrecte ; rien n’a été modifié.");

  const db = getDatabase(url) as unknown as CommercialDatabase;
  const auth = createQadrAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, isProduction: process.env.QADR_DB_TARGET === "production" });
  if (action === "bootstrap") {
    const result = await bootstrapPlatformOwner(auth, db, {
      username, email: process.env.QADR_OWNER_EMAIL ?? "", name: process.env.QADR_OWNER_NAME ?? "", password: process.env.QADR_OWNER_PASSWORD ?? "",
    });
    console.log(`Propriétaire créé (utilisateur ${result.userId}). Connexion : /platform/login.`);
  } else {
    const result = await resetPlatformOwnerPassword(auth, db, { username, password: process.env.QADR_OWNER_PASSWORD ?? "" });
    console.log(`Mot de passe renouvelé ; ${result.sessionsClosed} session(s) fermée(s).`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inconnue");
  process.exitCode = 1;
});
