import { describe, expect, it } from "vitest";
import { canonicalHostRedirects } from "./canonical-host";

const production = { VERCEL_ENV: "production", BETTER_AUTH_URL: "https://web-phi-beryl-45.vercel.app" };

describe("canonicalHostRedirects", () => {
  it("ne redirige rien hors production Vercel (local, aperçu, Preview)", () => {
    expect(canonicalHostRedirects({ BETTER_AUTH_URL: production.BETTER_AUTH_URL })).toEqual([]);
    expect(canonicalHostRedirects({ ...production, VERCEL_ENV: "preview" })).toEqual([]);
  });

  it("ne redirige rien sans adresse HTTPS valide", () => {
    expect(canonicalHostRedirects({ VERCEL_ENV: "production" })).toEqual([]);
    expect(canonicalHostRedirects({ VERCEL_ENV: "production", BETTER_AUTH_URL: "pas une adresse" })).toEqual([]);
    expect(canonicalHostRedirects({ VERCEL_ENV: "production", BETTER_AUTH_URL: "http://web-phi-beryl-45.vercel.app" })).toEqual([]);
  });

  it("renvoie toute page d'un autre nom vers l'adresse de BETTER_AUTH_URL, en 307", () => {
    const rules = canonicalHostRedirects(production);
    expect(rules.map((rule) => [rule.source, rule.destination])).toEqual([
      ["/", "https://web-phi-beryl-45.vercel.app/"],
      ["/:path((?!api/|_next/).+)", "https://web-phi-beryl-45.vercel.app/:path"],
    ]);
    for (const rule of rules) {
      expect(rule.permanent).toBe(false);
      expect(rule.missing).toEqual([{ type: "host", value: "^web-phi-beryl-45\\.vercel\\.app$" }]);
    }
  });

  it("le nom officiel n'est jamais redirigé, un autre nom l'est (points échappés)", () => {
    const host = new RegExp(canonicalHostRedirects(production)[0].missing[0].value);
    expect(host.test("web-phi-beryl-45.vercel.app")).toBe(true);
    expect(host.test("web-qadragency.vercel.app")).toBe(false);
    expect(host.test("web-phi-beryl-45xvercelxapp")).toBe(false);
    expect(host.test("evil.web-phi-beryl-45.vercel.app")).toBe(false);
  });

  it("laisse passer les API (crons, webhooks) et les fichiers /_next", () => {
    const pattern = /^\/((?!api\/|_next\/).+)$/;
    expect(canonicalHostRedirects(production)[1].source).toBe("/:path((?!api/|_next/).+)");
    expect(pattern.test("/redeem-code")).toBe(true);
    expect(pattern.test("/business/pos")).toBe(true);
    expect(pattern.test("/api/webhooks/geniuspay")).toBe(false);
    expect(pattern.test("/api/cron/subscriptions")).toBe(false);
    expect(pattern.test("/_next/static/chunks/app.js")).toBe(false);
  });
});
