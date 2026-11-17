import { describe, expect, it } from "vitest";
import { computeSettlement } from "./settlement";

const cash = (amountXof = "", touched = amountXof !== "") => ({ method: "cash", amountXof, touched });

describe("règlement à la caisse (exemples du mandat)", () => {
  it("paiement exact : le montant reçu est prérempli avec le total, sans ressaisie", () => {
    const s = computeSettlement(1000n, [cash()]);
    expect(s.rows[0]!.value).toBe(1000n);
    expect(s).toMatchObject({ paidXof: 1000n, dueXof: 0n, changeXof: 0n, overpaid: false });
    expect(s.payload).toEqual([{ method: "cash", amountXof: "1000" }]);
  });

  it("2 000 F payés avec un billet de 10 000 F : 8 000 F de monnaie, 2 000 F encaissés", () => {
    const s = computeSettlement(2000n, [cash("10000")]);
    expect(s).toMatchObject({ paidXof: 2000n, dueXof: 0n, cashGivenXof: 10000n, changeXof: 8000n });
    expect(s.payload).toEqual([{ method: "cash", amountXof: "2000", tenderedXof: "10000" }]);
  });

  it("paiement inférieur : jamais marqué payé, le solde reste dû", () => {
    const s = computeSettlement(2000n, [cash("1500")]);
    expect(s).toMatchObject({ paidXof: 1500n, dueXof: 500n, changeXof: 0n });
    expect(s.payload).toEqual([{ method: "cash", amountXof: "1500" }]);
  });

  it("mixte : 1 200 F Wave + 800 F espèces (champ espèces automatique)", () => {
    const s = computeSettlement(2000n, [{ method: "wave", amountXof: "1200", touched: true }, cash()]);
    expect(s).toMatchObject({ paidXof: 2000n, dueXof: 0n, changeXof: 0n });
    expect(s.payload).toEqual([{ method: "wave", amountXof: "1200" }, { method: "cash", amountXof: "800" }]);
  });

  it("mixte avec monnaie : 1 200 F Wave + 1 000 F remis en espèces → 800 F affectés, 200 F rendus", () => {
    const s = computeSettlement(2000n, [{ method: "wave", amountXof: "1200", touched: true }, cash("1000")]);
    expect(s).toMatchObject({ paidXof: 2000n, dueXof: 0n, cashGivenXof: 1000n, changeXof: 200n });
    expect(s.payload).toEqual([{ method: "wave", amountXof: "1200" }, { method: "cash", amountXof: "800", tenderedXof: "1000" }]);
  });

  it("Mobile Money déclaré supérieur au total : refusé, aucune monnaie sur un transfert", () => {
    const s = computeSettlement(2000n, [{ method: "moov_money", amountXof: "2500", touched: true }]);
    expect(s.overpaid).toBe(true);
  });

  it("vente à crédit : espèces vidées, tout reste dû", () => {
    const s = computeSettlement(3000n, [cash("0")]);
    expect(s).toMatchObject({ paidXof: 0n, dueXof: 3000n, payload: [] });
  });
});
