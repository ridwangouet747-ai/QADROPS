import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as activeBusinessRoute from "@/app/api/account/active-business/route";
import * as meRoute from "@/app/api/account/me/route";
import * as settingsRoute from "@/app/api/business/settings/route";
import { startHttpHarness, type Actor, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Identité du commerce (mission CTO du 2026-11-14) : le logo et le nom saisis par le commerçant sont ceux que
 * l'en-tête lit (`/api/account/me`, ouvert à tous les rôles), modifiables dans les réglages, propres à chaque
 * commerce. Aucun stockage objet : data URL contrôlée (type annoncé = premiers octets, taille bornée).
 */

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const otherPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("identité du commerce : nom et logo dans l'en-tête et les réglages", () => {
  let h: HttpHarness;
  let owner: Actor;
  let first: string;
  let second: string;

  beforeAll(async () => {
    h = await startHttpHarness();
    owner = await h.signUp("Awa Koné", "awa@identite.test");
    first = await h.createBusiness(owner, "Quincaillerie du Plateau", "hardware");
    second = await h.createBusiness(owner, "Boutique Awa Mode", "clothing");
  });
  afterAll(async () => { await h?.close(); });

  const active = async (actor: Actor) => ((await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor })).body.businesses as
    { id: string; name: string; logo: string | null; active: boolean; timezone: string; lifecycle: string }[]).find((item) => item.active);
  const switchTo = (actor: Actor, businessId: string) => h.call(activeBusinessRoute.POST, { path: "/api/account/active-business", actor, body: { businessId } });
  async function save(actor: Actor, changes: Record<string, unknown>) {
    const current = (await h.call(settingsRoute.GET, { method: "GET", path: "/api/business/settings", actor })).body.settings;
    // Champs lus mais non modifiables (rôle, devise, fuseau) et logo (seulement quand le test le fournit) : retirés.
    const editable = Object.fromEntries(Object.entries(current).filter(([key]) => !["role", "currency", "timezone", "logo"].includes(key)));
    return h.call(settingsRoute.PATCH, { method: "PATCH", path: "/api/business/settings", actor, body: { ...editable, email: editable.email ?? "", ...changes } });
  }

  it("sans logo : nom complet, aucune image ; le fuseau et l'état commercial sont fournis à l'en-tête", async () => {
    expect(await active(owner)).toMatchObject({ id: second, name: "Boutique Awa Mode", logo: null, timezone: "Africa/Abidjan", lifecycle: "trial" });
  });

  it("logo ajouté puis changé dans les réglages ; deux commerces gardent chacun leur nom et leur logo", async () => {
    expect((await save(owner, { logo: png })).status).toBe(200);
    expect(await active(owner)).toMatchObject({ id: second, logo: png });
    expect((await switchTo(owner, first)).status).toBe(200);
    expect(await active(owner)).toMatchObject({ id: first, name: "Quincaillerie du Plateau", logo: null });
    expect((await save(owner, { logo: otherPng, name: "Quincaillerie du Plateau — Adjamé" })).status).toBe(200);
    expect(await active(owner)).toMatchObject({ id: first, name: "Quincaillerie du Plateau — Adjamé", logo: otherPng });
    expect((await switchTo(owner, second)).status).toBe(200);
    expect(await active(owner)).toMatchObject({ id: second, name: "Boutique Awa Mode", logo: png });
    expect(await h.count("select count(*)::text n from audit_event where business_id=$1 and event_type='business.settings_updated'", [first])).toBe(1);
  });

  it("logo absent de la requête : inchangé ; null : retiré ; reconnexion : même identité", async () => {
    expect((await save(owner, { phone: "+225 07 00 00 00 00" })).status).toBe(200);
    expect((await active(owner))?.logo).toBe(png);
    expect((await save(owner, { logo: null })).status).toBe(200);
    expect((await active(owner))?.logo).toBeNull();
    expect((await save(owner, { logo: png })).status).toBe(200);
    const again = await h.signIn(owner);
    expect((await switchTo(again, second)).status).toBe(200);
    expect(await active(again)).toMatchObject({ name: "Boutique Awa Mode", logo: png });
  });

  it("fichier déguisé, autre format ou image trop lourde : 400, logo conservé", async () => {
    const disguised = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    const tooLarge = `data:image/png;base64,iVBORw0KGgo${"A".repeat(70_000)}`;
    for (const logo of [disguised, "data:image/svg+xml;base64,PHN2Zz4=", "https://exemple.test/logo.png", tooLarge]) {
      const refused = await save(owner, { logo });
      expect([400, 413]).toContain(refused.status);
    }
    expect((await active(owner))?.logo).toBe(png);
  });

  it("caissier : lit le nom et le logo de son commerce dans l'en-tête, ne peut pas les modifier", async () => {
    const cashier = await h.addMember(owner, "Caissier", "caissier@identite.test", "cashier");
    expect(await active(cashier)).toMatchObject({ id: second, name: "Boutique Awa Mode", logo: png });
    const refused = await h.call(settingsRoute.PATCH, { method: "PATCH", path: "/api/business/settings", actor: cashier, body: { logo: otherPng } });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await active(owner))?.logo).toBe(png);
  });

  it("isolation : un autre commerçant ne voit ni le nom ni le logo de ces commerces", async () => {
    const stranger = await h.signUp("Inconnu", "inconnu@identite.test");
    await h.createBusiness(stranger, "Autre commerce");
    const listed = (await h.call(meRoute.GET, { method: "GET", path: "/api/account/me", actor: stranger })).body.businesses as { id: string }[];
    expect(listed.map((item) => item.id)).not.toContain(first);
    expect(listed.map((item) => item.id)).not.toContain(second);
    expect((await switchTo(stranger, first)).status).toBeGreaterThanOrEqual(400);
  });
});
