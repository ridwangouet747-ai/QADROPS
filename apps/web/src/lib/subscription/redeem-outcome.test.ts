import { describe, expect, it } from "vitest";
import { finalizeCode, interpretRedeemResponse, isPlausibleCode, normalizeCodeInput, redeemPromotionCode } from "./redeem-outcome";

const success = { kind: "access", replayed: false, plan: { code: "ESSAI", name: "Essentiel" }, status: "trialing", endsAt: "2026-11-21T10:00:00.000Z", grantDays: 21 };

describe("saisie et résultat d’un code Qadr Agency", () => {
  it("normalise un code recopié avec espaces et minuscules, sans fusionner les groupes", () => {
    expect(finalizeCode(" qadr-7k2m - 9pqr\t-xw3a ")).toBe("QADR-7K2M-9PQR-XW3A");
    expect(finalizeCode("qadr 7k2m 9pqr xw3a")).toBe("QADR-7K2M-9PQR-XW3A");
    // Pendant la frappe, le séparateur que l'on vient de taper reste visible.
    expect(normalizeCodeInput("qadr ")).toBe("QADR-");
    expect(isPlausibleCode("QADR-7K2M-9PQR-XW3A")).toBe(true);
    expect(isPlausibleCode("AB")).toBe(false);
    expect(isPlausibleCode("QADR/../../")).toBe(false);
  });

  it("n’affiche une activation que si le serveur l’a confirmée", () => {
    expect(interpretRedeemResponse(200, success)).toEqual({ ok: true, result: success });
    expect(interpretRedeemResponse(200, { ok: true })).toEqual({ ok: false, reason: "unavailable" });
    expect(interpretRedeemResponse(200, null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("traduit chaque refus du serveur par son code, et tout le reste en indisponibilité", () => {
    for (const code of ["invalid", "expired", "revoked", "already_used", "exhausted", "business_suspended", "incompatible_subscription", "rate_limited"]) {
      expect(interpretRedeemResponse(code === "rate_limited" ? 429 : 400, { error: "…", code })).toEqual({ ok: false, reason: code });
    }
    expect(interpretRedeemResponse(401, { error: "Authentification requise." })).toEqual({ ok: false, reason: "forbidden" });
    expect(interpretRedeemResponse(400, { error: "?", code: "inconnu" })).toEqual({ ok: false, reason: "unavailable" });
    expect(interpretRedeemResponse(503, { error: "x", code: "invalid" })).toEqual({ ok: false, reason: "unavailable" });
    expect(interpretRedeemResponse(502, null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("signale une perte de connexion sans rien considérer comme activé", async () => {
    const offline = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    await expect(redeemPromotionCode("QADR-AAAA-BBBB-CCCC", null, offline)).resolves.toEqual({ ok: false, reason: "network" });
  });

  it("envoie le code au serveur et lit une page d’erreur HTML comme une indisponibilité", async () => {
    const calls: RequestInit[] = [];
    const html = ((_url: string, init: RequestInit) => { calls.push(init); return Promise.resolve(new Response("<html>502</html>", { status: 502 })); }) as unknown as typeof fetch;
    await expect(redeemPromotionCode("QADR-AAAA-BBBB-CCCC", "sub-1", html)).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ code: "QADR-AAAA-BBBB-CCCC", subscriptionId: "sub-1" });
  });
});
