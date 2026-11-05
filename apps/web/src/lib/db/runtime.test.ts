import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalPreview } from "@/lib/preview/mode";
import { getDatabase } from "./client";

describe("aperçu local : le client Neon est fermé", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("reconnaît l'aperçu seulement avec QADR_PREVIEW_MODE=true en développement", () => {
    expect(isLocalPreview({ NODE_ENV: "development", QADR_PREVIEW_MODE: "true" })).toBe(true);
    expect(isLocalPreview({ NODE_ENV: "development" })).toBe(false);
    expect(isLocalPreview({ NODE_ENV: "development", QADR_PREVIEW_MODE: "1" })).toBe(false);
    expect(isLocalPreview({ NODE_ENV: "production", QADR_PREVIEW_MODE: "true" })).toBe(false);
    expect(isLocalPreview({ NODE_ENV: "test", QADR_PREVIEW_MODE: "true" })).toBe(false);
  });

  it("refuse getDatabase en aperçu, même avec une DATABASE_URL rechargée depuis .env.local", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("QADR_PREVIEW_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://qadr:faux@neon.invalid/qadr");
    expect(() => getDatabase()).toThrow(/Aperçu local/);
    expect(() => getDatabase("postgresql://qadr:faux@neon.invalid/autre")).toThrow(/Aperçu local/);
  });
});
