/**
 * Compte propriétaire de la plateforme Qadr Ops (mission 13). Usage contrôlé, jamais automatique :
 *
 *   # Initialisation (refusée si un propriétaire est déjà actif)
 *   $env:QADR_DB_TARGET = "production"; $env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_EMAIL = "..."
 *   $env:QADR_OWNER_NAME = "..."; $env:QADR_OWNER_PASSWORD = "..."   # au moins 12 caractères
 *   npx tsx scripts/platform-owner.ts bootstrap
 *
 *   # Second facteur (mission 14) : obligatoire pour ouvrir la console. bootstrap l'enchaîne aussitôt.
 *   npx tsx scripts/platform-owner.ts enroll-2fa      # QADR_OWNER_USERNAME + QADR_OWNER_PASSWORD
 *   npx tsx scripts/platform-owner.ts reset-2fa       # récupération : retire le facteur, puis relancer enroll-2fa
 *
 *   # Nouveau mot de passe (ferme toutes les sessions du propriétaire)
 *   $env:QADR_OWNER_USERNAME = "..."; $env:QADR_OWNER_PASSWORD = "..."
 *   npx tsx scripts/platform-owner.ts reset-password
 *
 * Les valeurs viennent de variables d'environnement de la session du terminal (jamais d'un fichier suivi,
 * jamais de l'historique de commandes si on les saisit avec Read-Host). Le script n'affiche ni mot de passe
 * ni URL de connexion complète. Effacer ensuite les variables : Remove-Item Env:QADR_OWNER_PASSWORD.
 * Exception voulue : enroll-2fa affiche UNE fois, dans ce terminal, l'adresse otpauth:// à saisir dans
 * l'application d'authentification et les codes de secours à recopier sur papier. Fermez ensuite le terminal.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createQadrAuth } from "../src/lib/auth/server";
import { closeDatabases, getDatabase } from "../src/lib/db/client";
import type { CommercialDatabase } from "../src/lib/domain/commercial";
import { readEnvironment, requireDatabaseUrl } from "../src/lib/env";
import { beginOwnerTwoFactorEnrollment, bootstrapPlatformOwner, resetOwnerTwoFactor, resetPlatformOwnerPassword } from "../src/lib/domain/platform-owner";

const actions = ["bootstrap", "reset-password", "enroll-2fa", "reset-2fa"] as const;
type Action = (typeof actions)[number];
const labels: Record<Action, string> = {
  "bootstrap": "Créer le propriétaire", "reset-password": "Renouveler le mot de passe du propriétaire", "enroll-2fa": "Activer le second facteur du propriétaire", "reset-2fa": "Retirer le second facteur du propriétaire",
};

async function enroll(auth: Parameters<typeof beginOwnerTwoFactorEnrollment>[0], db: CommercialDatabase, username: string, password: string) {
  const enrollment = await beginOwnerTwoFactorEnrollment(auth, db, { username, password });
  console.log("\nSecond facteur : ajoutez ce compte dans votre application d’authentification (saisie manuelle de l’adresse) :");
  console.log(enrollment.totpURI);
  console.log("\nCodes de secours (un seul usage chacun) : recopiez-les sur papier, conservez-les hors de l’ordinateur :");
  console.log(enrollment.backupCodes.join("\n"));
  const prompt = createInterface({ input: stdin, output: stdout });
  const code = await prompt.question("\nCode à 6 chiffres affiché par l’application : ");
  prompt.close();
  try {
    await enrollment.confirm(code);
  } catch (error) {
    await enrollment.cancel();
    throw error;
  }
  console.log("Second facteur actif. Connexion : /platform/login (mot de passe, puis code).");
}

async function main() {
  const action = process.argv[2];
  if (!actions.includes(action as Action)) throw new Error(`Action attendue : ${actions.join(", ")}.`);
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
  const confirmation = await prompt.question(`${labels[action as Action]} « ${username} » : saisissez exactement CONFIRMER : `);
  prompt.close();
  if (confirmation !== "CONFIRMER") throw new Error("Confirmation incorrecte ; rien n’a été modifié.");

  const db = getDatabase(url) as unknown as CommercialDatabase;
  const auth = createQadrAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, isProduction: process.env.QADR_DB_TARGET === "production" });
  if (action === "bootstrap") {
    const result = await bootstrapPlatformOwner(auth, db, {
      username, email: process.env.QADR_OWNER_EMAIL ?? "", name: process.env.QADR_OWNER_NAME ?? "", password: process.env.QADR_OWNER_PASSWORD ?? "",
    });
    console.log(`Propriétaire créé (utilisateur ${result.userId}).`);
    await enroll(auth, db, username, process.env.QADR_OWNER_PASSWORD ?? "");
  } else if (action === "enroll-2fa") {
    await enroll(auth, db, username, process.env.QADR_OWNER_PASSWORD ?? "");
  } else if (action === "reset-2fa") {
    const result = await resetOwnerTwoFactor(db, { username });
    console.log(`Second facteur retiré ; ${result.sessionsClosed} session(s) fermée(s). Relancez enroll-2fa.`);
  } else {
    const result = await resetPlatformOwnerPassword(auth, db, { username, password: process.env.QADR_OWNER_PASSWORD ?? "" });
    console.log(`Mot de passe renouvelé ; ${result.sessionsClosed} session(s) fermée(s).`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inconnue");
  process.exitCode = 1;
}).finally(async () => {
  // Ferme le pool Neon : le script se termine dès la fin de l’action, sans attendre les connexions inactives.
  await closeDatabases().catch(() => undefined);
});
