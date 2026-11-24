import { describe, expect, it } from "vitest";
import { reportOnlyContentSecurityPolicy, securityHeaderRules } from "./security-headers";

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

  it("garde la CSP appliquée minimale, inchangée en production comme en développement", () => {
    for (const isProduction of [true, false]) {
      expect(headersOf(securityHeaderRules(isProduction), "/(.*)")["Content-Security-Policy"])
        .toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
    }
  });

  it("envoie la politique complète en mode rapport seulement, figée directive par directive", () => {
    const headers = headersOf(securityHeaderRules(true), "/(.*)");
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(reportOnlyContentSecurityPolicy(true));
    expect(reportOnlyContentSecurityPolicy(true)).toBe([
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io http://127.0.0.1:* http://localhost:*",
      "media-src 'self' https:",
      "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "));
  });

  it("mode rapport : 'unsafe-eval' seulement hors production, et aucun point de collecte inventé", () => {
    const production = reportOnlyContentSecurityPolicy(true);
    const development = reportOnlyContentSecurityPolicy(false);
    expect(production).not.toContain("'unsafe-eval'");
    expect(development).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com");
    for (const policy of [production, development]) {
      expect(policy).not.toMatch(/report-uri|report-to/);
      // Aucune source joker qui viderait la politique de son sens.
      expect(policy).not.toMatch(/(^|\s)\*(\s|;|$)/);
      expect(policy.split("; ").find((directive) => directive.startsWith("script-src"))).not.toMatch(/\shttps?:(\s|$)|\sdata:|\sblob:/);
    }
    expect(headersOf(securityHeaderRules(false), "/(.*)")["Content-Security-Policy-Report-Only"]).toBe(development);
  });
});
