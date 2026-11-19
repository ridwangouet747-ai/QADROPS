import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as platformPlanRoute from "@/app/api/platform/plans/[planId]/route";
import * as platformPlansRoute from "@/app/api/platform/plans/route";
import { readPublicPlans } from "@/lib/domain/public-plans";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * 2026-11-19 : un forfait créé et publié dans /platform/plans doit apparaître sur la page publique, quel que
 * soit leur nombre ; un forfait non publié n'y apparaît pas ; la page publique ne reçoit que des champs sûrs.
 * Les routes de la console invalident le cache de la page (sans effet hors de Next.js, jamais en erreur).
 */
const features = { pos: true, reports: true, inventory: true, procurement: true, productLimit: null, userLimit: null };

describe("forfaits publiés depuis la console → page publique", () => {
  let h: HttpHarness;
  let owner: Actor;
  const ids: string[] = [];
  beforeAll(async () => {
    h = await startHttpHarness();
    owner = await h.signUp("Propriétaire Plateforme", "proprio-forfaits@plateforme.test");
    await h.grantPlatformAdmin(owner);
  });
  afterAll(async () => { await h?.close(); });

  const create = (index: number, active = true) => h.call(platformPlansRoute.POST, {
    path: "/api/platform/plans", actor: owner,
    body: { code: `F${String(index).padStart(2, "0")}`, name: `Formule ${index}`, priceXof: String(1000 * index), durationDays: 30, active, features, description: `Offre ${index}` },
  });

  it("dix forfaits publiés : tous visibles, triés par prix, sans champ interne", async () => {
    for (let index = 1; index <= 10; index += 1) {
      const response = await create(index);
      expect(response.status).toBe(201);
      ids.push(response.body.id);
    }
    const plans = await readPublicPlans(h.db as never);
    expect(plans.map((plan) => plan.code)).toEqual(Array.from({ length: 10 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`));
    for (const plan of plans) {
      expect(Object.keys(plan).sort()).toEqual(["code", "description", "durationDays", "name", "priceXof", "productLimit", "userLimit"]);
      expect(typeof plan.priceXof).toBe("string");
    }
  });

  it("un forfait créé non publié n'apparaît pas", async () => {
    const response = await create(11, false);
    expect(response.status).toBe(201);
    expect((await readPublicPlans(h.db as never)).map((plan) => plan.code)).not.toContain("F11");
  });

  it("retrait puis republication : la page suit la console", async () => {
    const id = ids[2];
    const hidden = await h.call(platformPlanRoute.PATCH, { method: "PATCH", path: `/api/platform/plans/${id}`, actor: owner, params: { planId: id }, body: { active: false } });
    expect(hidden.status).toBe(200);
    expect((await readPublicPlans(h.db as never)).map((plan) => plan.code)).not.toContain("F03");

    const shown = await h.call(platformPlanRoute.PATCH, { method: "PATCH", path: `/api/platform/plans/${id}`, actor: owner, params: { planId: id }, body: { active: true, priceXof: "3500" } });
    expect(shown.status).toBe(200);
    expect((await readPublicPlans(h.db as never)).find((plan) => plan.code === "F03")).toMatchObject({ priceXof: "3500" });
  });

  it("le retrait n'efface rien : le forfait reste en base et ses abonnements gardent leur référence", async () => {
    const id = ids[0];
    await h.call(platformPlanRoute.PATCH, { method: "PATCH", path: `/api/platform/plans/${id}`, actor: owner, params: { planId: id }, body: { active: false } });
    expect(await h.count(`select count(*) n from subscription_plan where id = '${id}'`)).toBe(1);
    expect(await h.count("select count(*) n from audit_event where event_type = 'platform.plan_updated'")).toBeGreaterThanOrEqual(3);
  });
});
