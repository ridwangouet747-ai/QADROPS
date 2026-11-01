import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

const secret = "s".repeat(40);
const other = "o".repeat(40);

describe("autorisation des tâches planifiées", () => {
  it("accepte le jeton Bearer égal à l'un des secrets", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, [undefined, secret])).toBe(true);
    expect(isCronAuthorized(`Bearer ${other}`, [other, secret])).toBe(true);
  });

  it("refuse un jeton absent, faux ou de longueur différente", () => {
    expect(isCronAuthorized(null, [secret])).toBe(false);
    expect(isCronAuthorized("Bearer ", [secret])).toBe(false);
    expect(isCronAuthorized(`Bearer ${other}`, [secret])).toBe(false);
    expect(isCronAuthorized(`Bearer ${secret}x`, [secret])).toBe(false);
  });

  it("n'autorise jamais rien sans secret suffisant", () => {
    expect(isCronAuthorized("Bearer ", [undefined, ""])).toBe(false);
    expect(isCronAuthorized("Bearer court", ["court"])).toBe(false);
    expect(isCronAuthorized(`Bearer ${"a".repeat(31)}`, ["a".repeat(31)])).toBe(false);
  });
});
