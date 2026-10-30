import { describe, expect, it } from "vitest";
import { costOfGoodsSold, parseQuantityMicros, QUANTITY_SCALE, UNIT_COST_SCALE, weightedAverageCost } from "./costing";

describe("fixed-point inventory costing", () => {
  it("parses quantities without floating point", () => {
    expect(parseQuantityMicros("12.3456")).toBe(BigInt("12345600"));
    expect(parseQuantityMicros("2")).toBe(BigInt(2) * QUANTITY_SCALE);
    expect(() => parseQuantityMicros("1.0000001")).toThrow();
  });

  it("computes weighted average cost at 12 decimal places", () => {
    expect(weightedAverageCost({ oldQuantityMicros: BigInt(2) * QUANTITY_SCALE, oldUnitCostScaled: BigInt(100) * UNIT_COST_SCALE, receivedQuantityMicros: QUANTITY_SCALE, receivedUnitCostScaled: BigInt(130) * UNIT_COST_SCALE })).toBe(BigInt(110) * UNIT_COST_SCALE);
    expect(weightedAverageCost({ oldQuantityMicros: BigInt(0), oldUnitCostScaled: BigInt(400) * UNIT_COST_SCALE, receivedQuantityMicros: BigInt(1), receivedUnitCostScaled: BigInt(123) * UNIT_COST_SCALE })).toBe(BigInt(123) * UNIT_COST_SCALE);
  });

  it("rounds line COGS half-up to whole XOF", () => {
    expect(costOfGoodsSold(QUANTITY_SCALE, BigInt("10500000000000"))).toBe(BigInt(11));
    expect(costOfGoodsSold(QUANTITY_SCALE, BigInt("10499999999999"))).toBe(BigInt(10));
  });
});
