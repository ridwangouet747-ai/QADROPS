import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSchema } from "../db/schema";
import { readPublicPlans } from "./public-plans";

/* Formules de la page publique : seules les formules actives sont lues, triées par prix puis par code, avec un
   prix entier sérialisé sans passer par un nombre flottant et des limites illisibles ramenées à « sans limite ». */
describe("formules affichées sur la page publique (PGlite isolé)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: databaseSchema });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  });
  afterAll(async () => { await client.close(); });

  it("ne renvoie rien tant qu'aucune formule n'est publiée", async () => {
    expect(await readPublicPlans(db)).toEqual([]);
  });

  it("ne garde que les formules actives, triées par prix puis par code, sans perte sur les grands montants", async () => {
    await client.query(`insert into subscription_plan (id, code, name, price_xof, duration_days, active, features, description) values
      ('plan-team', 'TEAM', 'Équipe', 15000, 30, true, '{"productLimit": null, "userLimit": 0}', 'Pour plusieurs caisses'),
      ('plan-basic-b', 'BASIC-B', 'Essentiel B', 5000, 30, true, '{"productLimit": 250, "userLimit": 5}', null),
      ('plan-basic-a', 'BASIC-A', 'Essentiel A', 5000, 30, true, '{"productLimit": 2.5, "userLimit": "5"}', null),
      ('plan-old', 'OLD', 'Ancienne formule', 1000, 30, false, '{}', null),
      ('plan-free', 'FREE', 'Découverte', 0, 7, true, '{}', null),
      ('plan-huge', 'HUGE', 'Très grand compte', 9007199254740993, 365, true, '{"productLimit": 100000}', null)`);

    const plans = await readPublicPlans(db);

    expect(plans.map((plan) => plan.code)).toEqual(["FREE", "BASIC-A", "BASIC-B", "TEAM", "HUGE"]);
    expect(plans.find((plan) => plan.code === "OLD")).toBeUndefined();
    // 2^53 + 1 : un passage par `number` l'arrondirait à 9007199254740992.
    expect(plans.at(-1)?.priceXof).toBe("9007199254740993");
    expect(plans[0]).toEqual({ code: "FREE", name: "Découverte", priceXof: "0", durationDays: 7, description: null, productLimit: null, userLimit: null });
    expect(plans[2]).toMatchObject({ code: "BASIC-B", productLimit: 250, userLimit: 5 });
    // Limites non entières, nulles ou textuelles : affichées « sans limite », jamais devinées.
    expect(plans[1]).toMatchObject({ code: "BASIC-A", productLimit: null, userLimit: null });
    expect(plans[3]).toMatchObject({ code: "TEAM", description: "Pour plusieurs caisses", productLimit: null, userLimit: null });
  });
});
