import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { detectInstallPlatform } from "./client";

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG. */
function pngSize(path: string) {
  const bytes = readFileSync(resolve(process.cwd(), "public", path.replace(/^\//, "")));
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("application installable : manifest", () => {
  it("respecte les critères d'installation de Chrome (nom, démarrage, plein écran, icônes 192 et 512)", () => {
    const value = manifest();
    expect(value.name).toBeTruthy();
    expect(value.display).toBe("standalone");
    expect(value.start_url).toMatch(/^\/business\//);
    const sizes = (value.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(value.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("chaque icône annoncée existe et a la taille annoncée", () => {
    const value = manifest();
    const icons = [...(value.icons ?? []), ...(value.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? [])];
    for (const icon of icons) expect(pngSize(icon.src)).toBe(icon.sizes);
    expect(pngSize("/icons/apple-touch-icon.png")).toBe("180x180");
  });

  it("les raccourcis restent des pages internes", () => {
    for (const shortcut of manifest().shortcuts ?? []) expect(shortcut.url).toMatch(/^\/business\/[a-z-]+$/);
  });
});

describe("application installable : plateforme détectée", () => {
  const cases: [string, number, string][] = [
    ["Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", 5, "android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", 5, "ios"],
    // iPadOS se présente comme un Mac : seul l'écran tactile le distingue.
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0, "desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", 0, "desktop"],
  ];
  it.each(cases)("%s (%i points tactiles) → %s", (userAgent, touchPoints, expected) => {
    expect(detectInstallPlatform(userAgent, touchPoints)).toBe(expected);
  });
});
