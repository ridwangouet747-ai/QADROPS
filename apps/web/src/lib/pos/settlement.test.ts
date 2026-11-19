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

/*
 * Mission du 2026-11-19 : R = max(0, T − M) ; A = min(C, R) ; D = max(0, C − R) ; P = M + A ; S = max(0, T − P) ;
 * tiroir net = C − D. Le Mobile Money ne produit jamais de monnaie et n'entre jamais dans le tiroir.
 */
const mobile = (method: string, amountXof: string, extra: { received?: boolean; reference?: string } = { received: true }) => ({ method, amountXof, touched: true, ...extra });

describe("formules de la caisse (mission du 2026-11-19)", () => {
  it.each([
    [1000n, "1000", 1000n, 0n, 0n, 1000n],
    [2000n, "10000", 2000n, 8000n, 0n, 2000n],
    [300000n, "301000", 300000n, 1000n, 0n, 300000n],
    [5000n, "3000", 3000n, 0n, 2000n, 3000n],
  ])("total %s F, %s F remis : payé %s, monnaie %s, reste %s, tiroir %s", (total, given, paid, change, due, drawer) => {
    const s = computeSettlement(total, [cash(given)]);
    expect(s).toMatchObject({ paidXof: paid, changeXof: change, dueXof: due, drawerNetXof: drawer, cashGivenXof: BigInt(given) });
  });

  it.each(["wave", "orange_money", "mtn_momo", "moov_money"])("%s seul : payé, aucune monnaie, rien dans le tiroir", (method) => {
    const s = computeSettlement(4500n, [mobile(method, "4500")]);
    expect(s).toMatchObject({ paidXof: 4500n, dueXof: 0n, changeXof: 0n, drawerNetXof: 0n, overpaid: false, unconfirmed: false });
    expect(s.payload).toEqual([{ method, amountXof: "4500" }]);
  });

  it("Mobile Money non confirmé reçu : la vente est bloquée", () => {
    expect(computeSettlement(4500n, [mobile("wave", "4500", {})]).unconfirmed).toBe(true);
    expect(computeSettlement(4500n, [mobile("wave", "4500", { received: false })]).unconfirmed).toBe(true);
  });

  it("référence facultative transmise sans espaces autour, jamais pour les espèces", () => {
    const s = computeSettlement(4500n, [mobile("orange_money", "3000", { received: true, reference: "  OM2611.1234 " }), cash("2000")]);
    expect(s.payload).toEqual([{ method: "orange_money", amountXof: "3000", reference: "OM2611.1234" }, { method: "cash", amountXof: "1500", tenderedXof: "2000" }]);
  });

  it("mixte avec monnaie : 7 000 Wave + 5 000 espèces pour 10 000 → 3 000 affectés, 2 000 rendus, tiroir 3 000", () => {
    const s = computeSettlement(10000n, [mobile("wave", "7000"), cash("5000")]);
    expect(s).toMatchObject({ paidXof: 10000n, dueXof: 0n, changeXof: 2000n, drawerNetXof: 3000n });
  });

  it("surplus Mobile Money : jamais transformé en monnaie, la vente est refusée", () => {
    const s = computeSettlement(10000n, [mobile("mtn_momo", "12000"), cash("0")]);
    expect(s).toMatchObject({ overpaid: true, changeXof: 0n, drawerNetXof: 0n });
  });

  it("paiement partiel mixte : 2 000 Moov + 1 000 espèces sur 5 000 → 2 000 restent dus", () => {
    const s = computeSettlement(5000n, [mobile("moov_money", "2000"), cash("1000")]);
    expect(s).toMatchObject({ paidXof: 3000n, dueXof: 2000n, changeXof: 0n, drawerNetXof: 1000n });
  });

  it("champ espèces prérempli avec le solde restant après le Mobile Money", () => {
    const s = computeSettlement(10000n, [mobile("wave", "6000"), cash()]);
    expect(s.rows[1]).toMatchObject({ value: 4000n, applied: 4000n, change: 0n });
  });
});
