import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUSINESS_DEFAULT_TIME_ZONE, formatDateTime, formatTime, safeTimeZone } from "./format";

// L'appareil simulé est en GMT+1 : sans fuseau explicite, l'ancien formateur affichait 20:08 au lieu de 19:08.
const deviceZone = process.env.TZ;
beforeAll(() => { process.env.TZ = "Europe/Paris"; });
afterAll(() => { if (deviceZone === undefined) delete process.env.TZ; else process.env.TZ = deviceZone; });

// 19:08 UTC : 19:08 à Abidjan (GMT, sans heure d'été), 20:08 à Paris en hiver.
const instant = "2026-11-02T19:08:00Z";

describe("dates et heures au fuseau du commerce", () => {
  it("par défaut, l'heure d'Abidjan, jamais celle de l'appareil (régression : +1 h sur un PC en GMT+1)", () => {
    expect(BUSINESS_DEFAULT_TIME_ZONE).toBe("Africa/Abidjan");
    expect(formatTime(instant, "fr")).toBe("19:08");
    expect(formatDateTime(instant, "fr")).toContain("19:08");
    expect(formatDateTime(instant, "en")).toMatch(/7:08|19:08/);
  });

  it("le fuseau du commerce est appliqué quand il est fourni", () => {
    expect(formatTime(instant, "fr", "Europe/Paris")).toBe("20:08");
    expect(formatDateTime("2026-10-31T23:30:00Z", "fr", "Europe/Paris")).toContain("1 nov.");
  });

  it("un fuseau absent ou invalide retombe sur Abidjan au lieu de faire planter l'écran", () => {
    expect(safeTimeZone(null)).toBe("Africa/Abidjan");
    expect(safeTimeZone(" ")).toBe("Africa/Abidjan");
    expect(safeTimeZone("Pas/UnFuseau")).toBe("Africa/Abidjan");
    expect(formatTime(instant, "fr", "Pas/UnFuseau")).toBe("19:08");
  });
});
