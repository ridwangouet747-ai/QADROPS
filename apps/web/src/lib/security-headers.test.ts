import { describe, expect, it } from "vitest";
import { securityHeaderRules } from "./security-headers";

const headersOf = (rules: ReturnType<typeof securityHeaderRules>, source: string) =>
  Object.fromEntries(rules.find((rule) => rule.source === source)!.headers.map(({ key, value }) => [key, value]));

describe("securityHeaderRules", () => {
  it("interdit l'affichage dans un cadre et le reniflage de type sur toutes les pages", () => {
    const headers = headersOf(securityHeaderRules(true), "/(.*)");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("n'envoie pas HSTS hors production", () => {
    expect(headersOf(securityHeaderRules(false), "/(.*)")["Strict-Transport-Security"]).toBeUndefined();
  });

  it("empêche la mise en cache du service worker", () => {
    expect(headersOf(securityHeaderRules(true), "/sw.js")["Cache-Control"]).toBe("no-cache, no-store, must-revalidate");
  });
});
