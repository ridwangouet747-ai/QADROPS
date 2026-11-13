import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { standardPlan } from "../../scripts/ensure-standard-plan";
import { createPlatformPlan } from "@/lib/domain/platform";
import { readPublicPlans } from "@/lib/domain/public-plans";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * 2026-11-13 : la formule Standard du script `ensure-standard-plan.ts` passe la validation de la console
 * (`createPlatformPlan`), n'existe qu'une fois, et reste absente de la page publique tant qu'elle est inactive.
 */
describe("formule Standard (script d'initialisation)", () => {
  let h: HttpHarness;
  let owner: Actor;
  beforeAll(async () => {
    h = await startHttpHarness();
    owner = await h.signUp("Propriétaire Plateforme", "proprio@plateforme.test");
    await h.grantPlatformAdmin(owner);
  });
  afterAll(async () => { await h?.close(); });

  it("inactive : créée avec la fiche D-04, auditée, absente de la page publique", async () => {
    const db = h.db as unknown as Parameters<typeof createPlatformPlan>[0];
    await createPlatformPlan(db, owner.userId, standardPlan(false));
    expect(await h.count("select count(*) n from subscription_plan where code = 'STANDARD' and price_xof = 5000 and duration_days = 30 and active = false")).toBe(1);
    expect(await h.count("select count(*) n from audit_event where event_type = 'platform.plan_created'")).toBe(1);
    expect((await readPublicPlans(h.db as never)).map((plan) => plan.code)).not.toContain("STANDARD");
  });

  it("aucun doublon : une seconde création est refusée (409) et rien n'est écrit", async () => {
    const db = h.db as unknown as Parameters<typeof createPlatformPlan>[0];
    await expect(createPlatformPlan(db, owner.userId, standardPlan(true))).rejects.toMatchObject({ status: 409 });
    expect(await h.count("select count(*) n from subscription_plan where code = 'STANDARD'")).toBe(1);
  });

  it("toutes les fonctions, sans limite d'articles ni de membres", () => {
    expect(standardPlan(true).features).toEqual({ pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null });
  });
});
