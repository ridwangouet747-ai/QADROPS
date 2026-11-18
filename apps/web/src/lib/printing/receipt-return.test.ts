import { describe, expect, it } from "vitest";
import { receiptOrigin, receiptReturnPath } from "./receipt-return";

describe("retour depuis la page du reçu", () => {
  it("ramène à la caisse par défaut", () => {
    expect(receiptReturnPath(receiptOrigin(undefined), "s1")).toBe("/business/pos");
    expect(receiptReturnPath(receiptOrigin("pos"), "s1")).toBe("/business/pos");
  });

  it("ne suit que les origines de la liste fermée", () => {
    expect(receiptReturnPath(receiptOrigin("sales"), "s1")).toBe("/business/sales");
    expect(receiptReturnPath(receiptOrigin("dashboard"), "s1")).toBe("/business/dashboard");
    expect(receiptReturnPath(receiptOrigin("sale"), "vente/../x")).toBe("/business/sales/vente%2F..%2Fx");
  });

  it("ignore toute adresse fournie par le navigateur", () => {
    for (const hostile of ["https://exemple.test", "//exemple.test", "/platform", "javascript:alert(1)", ["sales"], "SALES", " pos"]) {
      expect(receiptReturnPath(receiptOrigin(hostile), "s1")).toBe("/business/pos");
    }
  });
});
