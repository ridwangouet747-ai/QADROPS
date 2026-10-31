import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

describe("redirection après connexion", () => {
  it("accepte un chemin interne avec sa requête", () => {
    expect(safeNext("/invitations/abc")).toBe("/invitations/abc");
    expect(safeNext("/business/inventory?session=1")).toBe("/business/inventory?session=1");
  });

  it("refuse toute destination externe ou ambiguë", () => {
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/ok\nSet-Cookie: x", "/\tx", "", null, undefined]) {
      expect(safeNext(value)).toBeNull();
    }
  });
});
