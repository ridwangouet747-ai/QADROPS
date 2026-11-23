import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/version", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renvoie une empreinte opaque, jamais mise en cache, qui change avec le déploiement", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_AAAA");
    const first = GET();
    expect(first.headers.get("cache-control")).toBe("no-store");
    const { version } = await first.json() as { version: string };
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(version).not.toContain("AAAA");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_BBBB");
    expect((await GET().json() as { version: string }).version).not.toBe(version);
  });
});
