import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_ROUTES, cronRequest } from "./cron-schedule";

describe("cronRequest", () => {
  it("construit l'appel de la route planifiée avec le secret", () => {
    const request = cronRequest("0 1 * * *", "s".repeat(40), "https://app.example.ci");
    expect(request?.url).toBe("https://app.example.ci/api/cron/subscriptions");
    expect(request?.method).toBe("GET");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${"s".repeat(40)}`);
  });

  it("n'appelle rien pour un horaire inconnu ou sans secret", () => {
    expect(cronRequest("*/5 * * * *", "s".repeat(40), "https://app.example.ci")).toBeNull();
    expect(cronRequest("0 7 * * *", undefined, "https://app.example.ci")).toBeNull();
    expect(cronRequest("0 7 * * *", "   ", "https://app.example.ci")).toBeNull();
  });

  it("garde une origine valide même si BETTER_AUTH_URL manque", () => {
    expect(cronRequest("0 7 * * *", "s".repeat(40), undefined)?.url).toBe("https://localhost/api/internal/notifications/process");
    expect(cronRequest("0 7 * * *", "s".repeat(40), "pas une url")?.url).toBe("https://localhost/api/internal/notifications/process");
  });

  it("déclare exactement les mêmes horaires que wrangler.jsonc", () => {
    const config = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
    const crons = JSON.parse(config.replace(/^\s*\/\/.*$/gm, "")).triggers.crons as string[];
    expect([...crons].sort()).toEqual(Object.keys(CRON_ROUTES).sort());
  });

  it("déclare dans vercel.json les mêmes horaires et routes", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const declared = Object.fromEntries(config.crons.map(({ schedule, path }) => [schedule, path]));
    expect(declared).toEqual(CRON_ROUTES);
  });
});
