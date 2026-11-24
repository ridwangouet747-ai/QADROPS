import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured: unknown[] = [];
const start = vi.fn(() => (error: unknown) => { captured.push(error); });
vi.mock("./browser-sentry", () => ({ startBrowserSentry: start }));

describe("Sentry du navigateur chargé à la première erreur", () => {
  beforeEach(() => {
    vi.resetModules();
    captured.length = 0;
    start.mockClear();
    vi.stubGlobal("window", { addEventListener: vi.fn() });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("ne charge rien tant qu'aucune erreur ne survient, puis envoie toutes les erreurs dans l'ordre, une seule initialisation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@o0.ingest.sentry.io/0");
    const { reportClientError } = await import("./client-errors");
    expect(start).not.toHaveBeenCalled();
    reportClientError(new Error("première"));
    reportClientError(new Error("pendant le chargement"));
    await vi.waitFor(() => expect(captured).toHaveLength(2));
    reportClientError(new Error("après"));
    expect(captured.map((error) => (error as Error).message)).toEqual(["première", "pendant le chargement", "après"]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("sans DSN configuré, ne charge jamais Sentry et n'écoute rien", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { reportClientError, listenForClientErrors } = await import("./client-errors");
    listenForClientErrors();
    reportClientError(new Error("ignorée"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(start).not.toHaveBeenCalled();
    expect((window as unknown as { addEventListener: ReturnType<typeof vi.fn> }).addEventListener).not.toHaveBeenCalled();
  });
});
