/**
 * Formule Standard (décision D-04, fiche : docs/product/landing-page.md § 3.1), créée une seule fois.
 *
 *   $env:QADR_DB_TARGET = "production"   # ou development, après avoir vérifié la cible
 *   npx tsx scripts/ensure-standard-plan.ts            # crée STANDARD **inactive** (rien n'est publié)
 *   npx tsx scripts/ensure-standard-plan.ts --publish  # crée STANDARD active (page publique, facturation)
 *
 * - Idempotent : si le code STANDARD existe déjà, rien n'est écrit (aucun doublon, aucune mise à jour).
 * - Passe par `createPlatformPlan` (même validation et même audit que la console), au nom du propriétaire
 *   actif de la plateforme : il doit exister (première connexion à /platform/login).
 * - Inactive par défaut : sous l'offre Vercel Hobby (usage personnel), aucune offre commerciale ne doit
 *   apparaître sur la page publique. L'activer ensuite depuis /platform/plans, avec une offre commerciale.
 * - Lit DATABASE_URL (jamais affichée : seuls l'hôte et la base le sont).
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabases, getDatabase } from "../src/lib/db/client";
import { platformAdmin, subscriptionPlan } from "../src/lib/db/schema";
import { createPlatformPlan } from "../src/lib/domain/platform";
import { requireDatabaseUrl } from "../src/lib/env";

export const standardPlan = (active: boolean) => ({
  code: "STANDARD", name: "Standard", priceXof: "5000", durationDays: 30, active, currency: "XOF" as const,
  features: { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null },
});

async function main() {
  if (process.env.QADR_DB_TARGET !== "development" && process.env.QADR_DB_TARGET !== "production") {
    throw new Error("Refus : définissez QADR_DB_TARGET (development ou production) après avoir vérifié la cible.");
  }
  const publish = process.argv.includes("--publish");
  const url = requireDatabaseUrl();
  const target = new URL(url);
  console.log(`Cible : ${target.hostname}${target.pathname} (${process.env.QADR_DB_TARGET})`);
  const db = getDatabase(url);

  const [existing] = await db.select({ id: subscriptionPlan.id, active: subscriptionPlan.active, priceXof: subscriptionPlan.priceXof, durationDays: subscriptionPlan.durationDays })
    .from(subscriptionPlan).where(eq(subscriptionPlan.code, "STANDARD")).limit(1);
  if (existing) {
    console.log(`STANDARD existe déjà (${existing.priceXof} XOF, ${existing.durationDays} jours, ${existing.active ? "active" : "inactive"}) : rien n'est modifié.`);
    return;
  }
  const [owner] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(isNull(platformAdmin.revokedAt)).limit(1);
  if (!owner) throw new Error("Aucun propriétaire actif : connectez-vous d'abord à /platform/login.");

  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question(`Créer STANDARD (5000 XOF, 30 jours, ${publish ? "ACTIVE" : "inactive"}) : saisissez exactement CONFIRMER : `);
  prompt.close();
  if (answer !== "CONFIRMER") throw new Error("Confirmation incorrecte ; rien n'a été modifié.");

  const created = await createPlatformPlan(db as unknown as Parameters<typeof createPlatformPlan>[0], owner.userId, standardPlan(publish));
  const [check] = await db.select({ id: subscriptionPlan.id }).from(subscriptionPlan)
    .where(and(eq(subscriptionPlan.code, "STANDARD"), eq(subscriptionPlan.id, created.id))).limit(1);
  console.log(check ? `STANDARD créée (${publish ? "active" : "inactive"}), audit platform.plan_created écrit.` : "Création non relue : vérifier dans /platform/plans.");
}

if (process.argv[1]?.endsWith("ensure-standard-plan.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Erreur inconnue");
    process.exitCode = 1;
  }).finally(async () => { await closeDatabases().catch(() => undefined); });
}
