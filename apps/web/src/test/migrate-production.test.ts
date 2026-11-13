import { describe, expect, it } from "vitest";
import { pendingMigrations, productionMigrationTarget } from "../../scripts/migrate-production";

const direct = "postgresql://proprio:secret-de-test@ep-exemple.c-16.us-east-1.aws.neon.tech/neondb?sslmode=require";
const phrase = "MIGRER LA PRODUCTION ep-exemple.c-16.us-east-1.aws.neon.tech/neondb";

describe("migration de production : garde-fous", () => {
  it("exige la cible déclarée production", () => {
    expect(() => productionMigrationTarget({ DATABASE_URL_UNPOOLED: direct, QADR_MIGRATION_CONFIRM: phrase })).toThrow(/QADR_DB_TARGET=production/);
    expect(() =>
      productionMigrationTarget({ DATABASE_URL_UNPOOLED: direct, QADR_DB_TARGET: "development", QADR_MIGRATION_CONFIRM: phrase }),
    ).toThrow(/QADR_DB_TARGET=production/);
  });

  it("refuse la connexion poolée", () => {
    const pooled = direct.replace("ep-exemple", "ep-exemple-pooler");
    expect(() =>
      productionMigrationTarget({ DATABASE_URL_UNPOOLED: pooled, QADR_DB_TARGET: "production", QADR_MIGRATION_CONFIRM: phrase }),
    ).toThrow(/-pooler/);
  });

  it("exige la phrase qui nomme l'hôte et la base exacts", () => {
    const env = { DATABASE_URL_UNPOOLED: direct, QADR_DB_TARGET: "production" };
    expect(() => productionMigrationTarget(env)).toThrow(/MIGRER LA PRODUCTION ep-exemple/);
    expect(() => productionMigrationTarget({ ...env, QADR_MIGRATION_CONFIRM: "MIGRER LA PRODUCTION autre-hote/neondb" })).toThrow();
    expect(productionMigrationTarget({ ...env, QADR_MIGRATION_CONFIRM: phrase }).label).toBe(
      "ep-exemple.c-16.us-east-1.aws.neon.tech/neondb",
    );
  });

  it("ne révèle jamais le mot de passe dans un message de refus", () => {
    try {
      productionMigrationTarget({ DATABASE_URL_UNPOOLED: direct, QADR_DB_TARGET: "production", QADR_MIGRATION_CONFIRM: "non" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("secret-de-test");
    }
  });

  it("calcule les migrations en attente d'après la date du dernier journal", () => {
    const journal = [
      { tag: "0000_a", when: 100 },
      { tag: "0001_b", when: 200 },
      { tag: "0002_c", when: 300 },
    ];
    expect(pendingMigrations(journal, null).map((m) => m.tag)).toEqual(["0000_a", "0001_b", "0002_c"]);
    expect(pendingMigrations(journal, 200).map((m) => m.tag)).toEqual(["0002_c"]);
    expect(pendingMigrations(journal, 300)).toEqual([]);
  });
});
