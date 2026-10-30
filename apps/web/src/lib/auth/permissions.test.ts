import { describe, expect, it } from "vitest";
import { businessRoles } from "./permissions";

describe("Qadr Ops organization roles", () => {
  it("allows cashiers to record sales but not refunds or inventory validation", () => {
    expect(businessRoles.cashier.authorize({ sale: ["create"] }).success).toBe(true);
    expect(businessRoles.cashier.authorize({ sale: ["refund"] }).success).toBe(false);
    expect(businessRoles.cashier.authorize({ inventory: ["validate"] }).success).toBe(false);
  });

  it("allows inventory managers to validate counts but not refund sales", () => {
    expect(businessRoles.stock_manager.authorize({ inventory: ["validate"] }).success).toBe(true);
    expect(businessRoles.stock_manager.authorize({ sale: ["refund"] }).success).toBe(false);
  });

  it("does not grant organization deletion to a business administrator", () => {
    expect(businessRoles.admin.authorize({ organization: ["delete"] }).success).toBe(false);
  });
});
