import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { authSchema, businessProfile, inventoryLine, productVariant, sale, stockMovement } from "./schema";

describe("QADR OPS Drizzle schema invariants", () => {
  it("uses Better Auth Organization membership without a competing business-member table", () => {
    expect(Object.keys(authSchema)).toContain("member");
    expect(Object.keys(authSchema)).not.toContain("businessMember");
    expect(getTableConfig(businessProfile).columns.find((column) => column.name === "business_id")?.primary).toBe(true);
  });

  it("scopes sales and inventory relations to the same business", () => {
    const saleConfig = getTableConfig(sale);
    expect(saleConfig.foreignKeys.map((foreignKey) => foreignKey.getName())).toContain("sale_cashier_membership_tenant_fk");
    expect(saleConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain("sale_business_idempotency_unique");
    expect(getTableConfig(inventoryLine).foreignKeys.map((foreignKey) => foreignKey.getName())).toContain("inventory_line_variant_tenant_fk");
    expect(getTableConfig(productVariant).columns.find((column) => column.name === "sale_price_xof")?.dataType).toBe("bigint");
  });

  it("allows only one source per stock movement and prevents duplicate inventory application", () => {
    expect(getTableConfig(stockMovement).checks.map((constraint) => constraint.name)).toContain("stock_movement_source_one_check");
    expect(getTableConfig(stockMovement).indexes.map((index) => index.config.name)).toContain("stock_movement_inventory_line_unique");
  });
});
