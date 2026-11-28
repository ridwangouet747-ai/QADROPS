import { describe, expect, it } from "vitest";
import { businessLifecycle, byCoverage, effectiveSubscriptionStatus, isInForce, isLifetime, remainingDays, type SubscriptionTerms } from "./subscription-lifecycle";

/*
 * Règle d'accès unique (docs/lifetime-access.md), sans base : l'horloge est passée en paramètre, ce qui permet de
 * vérifier le comportement des années plus tard.
 */
const now = new Date("2026-11-27T12:00:00Z");
const year = 365 * 86_400_000;
const fixed = (overrides: Partial<SubscriptionTerms> = {}): SubscriptionTerms => ({
  status: "active", startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 30 * 86_400_000), durationKind: "fixed_duration", ...overrides,
});
const lifetime = (overrides: Partial<SubscriptionTerms> = {}): SubscriptionTerms => ({
  status: "active", startsAt: new Date(now.getTime() - 86_400_000), endsAt: null, durationKind: "lifetime", ...overrides,
});

describe("règle d'accès (isInForce)", () => {
  it("durée déterminée : en vigueur avant la fin, plus du tout à l'échéance", () => {
    const subscription = fixed();
    expect(isInForce(subscription, now)).toBe(true);
    expect(isInForce(subscription, subscription.endsAt!)).toBe(false);
    expect(isInForce(subscription, new Date(subscription.endsAt!.getTime() + 1))).toBe(false);
  });

  it("accès à vie : toujours en vigueur, même 50 ans plus tard", () => {
    expect(isInForce(lifetime(), now)).toBe(true);
    expect(isInForce(lifetime(), new Date(now.getTime() + 50 * year))).toBe(true);
  });

  it("suspendu, annulé, en attente ou expiré : jamais en vigueur, accès à vie compris", () => {
    for (const status of ["suspended", "canceled", "pending", "expired"]) {
      expect(isInForce(lifetime({ status }), now)).toBe(false);
      expect(isInForce(fixed({ status }), now)).toBe(false);
    }
  });

  it("date de début non atteinte : pas encore en vigueur", () => {
    const future = new Date(now.getTime() + 86_400_000);
    expect(isInForce(lifetime({ startsAt: future }), now)).toBe(false);
    expect(isInForce(fixed({ startsAt: future }), now)).toBe(false);
    expect(isInForce(lifetime({ startsAt: future }), future)).toBe(true);
  });

  it("une date de fin nulle ne vaut jamais « à vie » : durée déterminée sans fin = échue", () => {
    expect(isInForce(fixed({ endsAt: null }), now)).toBe(false);
    expect(effectiveSubscriptionStatus(fixed({ endsAt: null }), now)).toBe("expired");
    expect(isLifetime(fixed({ endsAt: null }))).toBe(false);
  });

  it("type inconnu : traité comme une durée déterminée (jamais comme un accès permanent)", () => {
    expect(isInForce({ ...lifetime(), durationKind: "forever" }, now)).toBe(false);
  });
});

describe("statut affiché, jours restants, ordre de couverture, cycle de vie", () => {
  it("effectiveSubscriptionStatus : un accès à vie n'est jamais lu « expired »", () => {
    expect(effectiveSubscriptionStatus(lifetime(), new Date(now.getTime() + 30 * year))).toBe("active");
    expect(effectiveSubscriptionStatus(fixed(), new Date(now.getTime() + year))).toBe("expired");
  });

  it("remainingDays : nul pour un accès à vie (aucun compte à rebours), jours entiers sinon", () => {
    expect(remainingDays(null, now)).toBeNull();
    expect(remainingDays(new Date(now.getTime() + 2.5 * 86_400_000), now)).toBe(3);
    expect(remainingDays(new Date(now.getTime() - 86_400_000), now)).toBe(0);
  });

  it("byCoverage : l'accès à vie passe avant toute période fixe, puis la fin la plus lointaine", () => {
    const short = fixed({ endsAt: new Date(now.getTime() + 86_400_000) });
    const long = fixed({ endsAt: new Date(now.getTime() + 90 * 86_400_000) });
    const permanent = lifetime();
    expect([short, permanent, long].sort(byCoverage)).toEqual([permanent, long, short]);
  });

  it("businessLifecycle : actif avec un accès à vie des années plus tard ; suspendu si le commerce l'est ; fermé après révocation", () => {
    expect(businessLifecycle("active", [lifetime()], new Date(now.getTime() + 20 * year))).toBe("active");
    expect(businessLifecycle("suspended", [lifetime()], now)).toBe("suspended");
    expect(businessLifecycle("active", [lifetime({ status: "canceled" })], now)).toBe("pending");
    expect(businessLifecycle("active", [fixed({ endsAt: new Date(now.getTime() - 1) })], now)).toBe("expired");
  });
});
