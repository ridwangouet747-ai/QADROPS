import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

describe("verifyTurnstile", () => {
  it("laisse le développement local fonctionner si Turnstile est absent", async () => {
    await expect(verifyTurnstile(undefined, { secret: undefined, siteKey: undefined, isProduction: false }))
      .resolves.toEqual({ ok: true });
  });

  it("refuse de fonctionner en production sans configuration", async () => {
    await expect(verifyTurnstile("token", { secret: undefined, siteKey: undefined, isProduction: true }))
      .resolves.toEqual({ ok: false, reason: "not_configured" });
  });

  it("vérifie le jeton côté serveur et ne valide pas une réponse négative", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    await expect(verifyTurnstile("not-a-real-token", {
      secret: "test-secret",
      siteKey: "test-site",
      isProduction: true,
      fetcher,
    })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
