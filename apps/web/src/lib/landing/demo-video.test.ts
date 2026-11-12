import { describe, expect, it } from "vitest";
import { readDemoVideo } from "./demo-video";

describe("vidéo de démonstration de la page publique", () => {
  it("est prête quand l'adresse configurée est reconnue", () => {
    expect(readDemoVideo({ QADR_DEMO_VIDEO_URL: "https://youtu.be/dQw4w9WgXcQ", NODE_ENV: "production" })).toEqual({ status: "ready", source: { kind: "youtube", id: "dQw4w9WgXcQ" } });
  });

  it("n'affiche rien en production sans adresse : aucune vidéo fictive", () => {
    expect(readDemoVideo({ NODE_ENV: "production" })).toEqual({ status: "hidden" });
    expect(readDemoVideo({ QADR_DEMO_VIDEO_URL: "", NODE_ENV: "production" })).toEqual({ status: "hidden" });
  });

  it("n'affiche rien en production avec une adresse non reconnue", () => {
    expect(readDemoVideo({ QADR_DEMO_VIDEO_URL: "https://exemple.test/page.html", NODE_ENV: "production" })).toEqual({ status: "hidden" });
  });

  it("montre un emplacement vide hors production", () => {
    expect(readDemoVideo({ NODE_ENV: "development" })).toEqual({ status: "placeholder" });
  });
});
