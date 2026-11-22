import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsCatalog, countBucket, genericPath, sanitizeEvent } from "./events";

const { init, capture } = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { init, identify: vi.fn(), capture, reset: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn() } }));

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
}

describe("PostHog : configuration et consentement", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear(); capture.mockClear();
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { location: { pathname: "/business/sales/0b9a8c7d-1234-4bcd-9abc-1234567890ab" } });
  });

  it("reste désactivée quand la clé PostHog manque", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
    const analytics = await import("./client");
    analytics.setConsent("granted");
    expect(analytics.initializeAnalytics()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("ne charge rien sans accord, ni quand le navigateur refuse le suivi", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_public_key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    let analytics = await import("./client");
    expect(analytics.initializeAnalytics()).toBe(false);
    analytics.track("login_succeeded");
    expect(capture).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    vi.resetModules();
    analytics = await import("./client");
    analytics.setConsent("granted");
    expect(analytics.readConsent()).toBe("denied");
    expect(init).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("après accord : autocapture, pages vues et enregistrement de session désactivés ; propriétés filtrées avant l'envoi", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_public_key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    const analytics = await import("./client");
    expect(init).not.toHaveBeenCalled();
    analytics.setConsent("granted");
    // La bibliothèque est importée à la demande, après l'accord seulement.
    expect(await analytics.analyticsLoaded()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    analytics.track("login_succeeded");
    await analytics.analyticsLoaded();
    await Promise.resolve();
    expect(capture).toHaveBeenCalledWith("login_succeeded", {});
    const options = init.mock.calls[0]![1];
    expect(options).toMatchObject({ autocapture: false, capture_pageview: false, disable_session_recording: true, persistence: "memory", respect_dnt: true });
    const sent = options.before_send({ event: "sale_recorded", properties: { payment_mix: "mixed", line_count: "2-5", total_xof: "25000", customer_name: "Awa", $current_url: "https://app/business/sales/123", $os: "Android" }, $set: { email: "a@b.c" } });
    expect(sent.properties).toEqual({ payment_mix: "mixed", line_count: "2-5", $os: "Android", path: "/business/sales/:id" });
    expect(sent.$set).toBeUndefined();
    expect(options.before_send({ event: "$autocapture", properties: { $elements: [] } })).toBeNull();
    expect(options.before_send({ event: "custom_event", properties: {} })).toBeNull();
  });

  it("accord retiré pendant le téléchargement : rien n'est initialisé ni envoyé", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_public_key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    const analytics = await import("./client");
    analytics.setConsent("granted");
    analytics.track("login_succeeded");
    analytics.setConsent("denied");
    expect(await analytics.analyticsLoaded()).toBe(false);
    await Promise.resolve();
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("catalogue d'événements", () => {
  it("n'accepte que des valeurs prévues : jamais de texte libre ni de montant", () => {
    expect(sanitizeEvent("login_failed", { reason: "credentials", email: "awa@qadr.test", password: "secret" })).toEqual({ reason: "credentials" });
    expect(sanitizeEvent("login_failed", { reason: "Mot de passe incorrect pour awa@qadr.test" })).toEqual({});
    expect(sanitizeEvent("sale_recorded", { has_customer: "oui" })).toEqual({});
    expect(sanitizeEvent("unknown", { a: 1 })).toBeNull();
    expect(countBucket(1)).toBe("1");
    expect(countBucket(4)).toBe("2-5");
    expect(countBucket(12)).toBe("6+");
    expect(genericPath("/business/sales/V-MH2K123/receipt?x=1")).toBe("/business/sales/:id/receipt");
  });

  it("aucune propriété du catalogue ne peut porter de donnée personnelle ou financière", () => {
    const forbidden = /(amount|xof|total|price|name|phone|email|token|password|customer_id|business_id|reference)/;
    for (const [event, properties] of Object.entries(analyticsCatalog)) {
      for (const [key, allowed] of Object.entries(properties)) {
        expect(key, `${event}.${key}`).not.toMatch(forbidden);
        expect(allowed === "boolean" || Array.isArray(allowed), `${event}.${key}`).toBe(true);
      }
    }
  });
});
