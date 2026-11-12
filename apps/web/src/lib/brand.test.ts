import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "./brand";

const publicDir = resolve(process.cwd(), "public");
const sourceDir = resolve(process.cwd(), "src");

function pngSize(path: string) {
  const bytes = readFileSync(join(publicDir, path));
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("identité de marque : une seule source", () => {
  it("les fichiers du logo annoncés existent et sont des SVG", () => {
    for (const file of [brand.mark, brand.markMono]) {
      const content = readFileSync(join(publicDir, file.src), "utf8");
      expect(content.startsWith("<svg")).toBe(true);
      expect(file.width).toBeGreaterThan(0);
      expect(file.height).toBeGreaterThan(0);
    }
    expect(existsSync(join(publicDir, "brand/qadr-app-icon.svg")) || existsSync(join(publicDir, "brand/qadr-app-icon.png"))).toBe(true);
  });

  it("chaque icône a la taille que son nom annonce", () => {
    expect(pngSize(brand.icons.favicon32)).toBe("32x32");
    expect(pngSize(brand.icons.favicon48)).toBe("48x48");
    expect(pngSize(brand.icons.icon192)).toBe("192x192");
    expect(pngSize(brand.icons.icon512)).toBe("512x512");
    expect(pngSize(brand.icons.maskable512)).toBe("512x512");
    expect(pngSize(brand.icons.appleTouch)).toBe("180x180");
  });

  it("aucun écran n'écrit lui-même un chemin de logo : tout passe par lib/brand.ts", () => {
    const allowed = [join("lib", "brand.ts")];
    const offenders = sourceFiles(sourceDir)
      .filter((path) => !allowed.some((suffix) => path.endsWith(suffix)))
      .filter((path) => /["'`]\/brand\//.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(sourceDir.length + 1));
    expect(offenders).toEqual([]);
  });

  it("l'ancien « Q » en tuile n'est plus affiché dans les composants", () => {
    // Une tuile dont le seul contenu est la lettre Q : `…">Q</span>`.
    const offenders = sourceFiles(join(sourceDir, "components"))
      .filter((path) => />Q<\/(span|strong|div)>/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(sourceDir.length + 1));
    expect(offenders).toEqual([]);
  });
});
