import { describe, expect, it } from "vitest";
import { microsToQuantity, parseQuantityInput, stepQuantity, toApiQuantity } from "./quantity";

describe("saisie des quantités", () => {
  it("accepte la virgule et le point, jusqu’à six décimales", () => {
    expect(parseQuantityInput("2,5")).toBe(2_500_000n);
    expect(parseQuantityInput(" 12.125 ")).toBe(12_125_000n);
    expect(parseQuantityInput("0")).toBe(0n);
  });

  it("refuse les saisies ambiguës ou négatives", () => {
    for (const value of ["", "-1", "1,2,3", "01", "1.1234567", "1 000", "abc"]) expect(parseQuantityInput(value)).toBeNull();
  });

  it("convertit pour l’API et depuis les micro-unités", () => {
    expect(toApiQuantity("2,5")).toBe("2.5");
    expect(microsToQuantity(-1_500_000n)).toBe("-1.500000");
  });

  it("ajoute ou retire 1 sans passer sous zéro, dans le format de la langue", () => {
    expect(stepQuantity("2,5", 1, "fr")).toBe("3,5");
    expect(stepQuantity("0.5", -1, "en")).toBe("0");
    expect(stepQuantity("n’importe quoi", 1, "ar")).toBe("1");
  });
});
