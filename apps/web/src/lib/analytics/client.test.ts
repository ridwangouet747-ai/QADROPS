import { beforeEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { init, identify: vi.fn(), capture: vi.fn(), reset: vi.fn() } }));

describe("analytics config", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
  });

  it("reste désactivée quand la clé PostHog manque", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
    const analytics = await import("./client");
    expect(analytics.initializeAnalytics()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
