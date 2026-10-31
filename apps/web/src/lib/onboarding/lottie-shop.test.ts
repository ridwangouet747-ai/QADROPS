import { describe, expect, it } from "vitest";
import { buildShopLottie, lottieFrames, lottieSegments } from "./lottie-shop";

describe("animation Lottie de la boutique", () => {
  const animation = buildShopLottie();

  it("reste très légère et sans ressource externe", () => {
    const json = JSON.stringify(animation);
    expect(json.length).toBeLessThan(60_000);
    expect(animation.assets).toEqual([]);
    expect(json).not.toMatch(/https?:|\.mp4|\.webm|\.png|\.jpg/);
  });

  it("enchaîne une séquence par étape, sans trou ni chevauchement", () => {
    const order = ["account", "identity", "details", "branding", "review", "welcome"] as const;
    expect(lottieSegments.account[0]).toBe(0);
    for (let step = 1; step < order.length; step++) expect(lottieSegments[order[step]!][0]).toBe(lottieSegments[order[step - 1]!][1]);
    expect(lottieSegments.welcome[1]).toBe(lottieFrames);
  });

  it("prévoit un aménagement par activité, identifiable par classe", () => {
    const classes = animation.layers.map((layer) => (layer as { cl?: string }).cl).filter(Boolean);
    expect(classes.sort()).toEqual(["act-clothing", "act-general", "act-hardware", "act-phones"]);
    expect(new Set(animation.layers.map((layer) => layer.ind)).size).toBe(animation.layers.length);
  });

  it("produit la même animation à chaque construction", () => {
    expect(JSON.stringify(buildShopLottie())).toBe(JSON.stringify(animation));
  });
});
