import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startHttpHarness, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

// La page lit les en-têtes de la requête et redirige par une exception, comme Next.js.
const requestCookie = { value: "" };
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: requestCookie.value }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

/*
 * Garde serveur des pages `/business/*` : une URL tapée à la main ou un ancien favori ne montre jamais l'espace
 * de gestion d'un commerce sans droit d'usage. Vraie session Better Auth, base PGlite migrée.
 */
describe("pages de gestion : garde serveur du droit d'usage", () => {
  let h: HttpHarness;
  let guard: () => Promise<void>;

  beforeAll(async () => {
    h = await startHttpHarness();
    guard = (await import("@/lib/domain/business-page-access")).requireBusinessPageAccess;
  });
  afterAll(async () => { await h?.close(); });

  const outcome = async (cookie: string) => {
    requestCookie.value = cookie;
    try { await guard(); return "open"; } catch (error) { return (error as Error).message; }
  };

  it("sans session, sans commerce actif, sans droit d'usage, puis avec un essai en cours", async () => {
    expect(await outcome("")).toBe("REDIRECT:/login");
    const owner = await h.signUp("Commerçant page", "page@parcours.test");
    expect(await outcome(owner.cookie)).toBe("REDIRECT:/select-business");
    const businessId = await h.createBusiness(owner, "Boutique page", "general", { access: "none" });
    expect(await outcome(owner.cookie)).toBe("REDIRECT:/business/subscription");
    await h.grantTrialAccess(businessId);
    expect(await outcome(owner.cookie)).toBe("open");
  });
});
