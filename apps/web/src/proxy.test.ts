import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

// Hors aperçu : le proxy s'applique comme sur Vercel.
afterEach(() => vi.unstubAllEnvs());
function run(path: string, cookie?: string) {
  vi.stubEnv("QADR_PREVIEW_MODE", "");
  return proxy(new NextRequest(new URL(path, "https://qadr.example.ci"), cookie ? { headers: { cookie } } : undefined));
}

describe("proxy (redirection optimiste vers la connexion)", () => {
  it("laisse la page de connexion du propriétaire accessible sans session (mission 15)", () => {
    const response = run("/platform/login");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("renvoie toute autre page protégée vers /login sans cookie de session", () => {
    for (const path of ["/platform", "/platform/businesses", "/business", "/platform/login/autre"]) {
      const location = run(path).headers.get("location");
      expect(location, path).not.toBeNull();
      expect(new URL(location!).pathname, path).toBe("/login");
      expect(new URL(location!).searchParams.get("next"), path).toBe(path);
    }
  });

  it("laisse passer une page protégée quand un cookie de session Better Auth est présent", () => {
    const response = run("/business", "better-auth.session_token=jeton.signature");
    expect(response.headers.get("location")).toBeNull();
  });
});
