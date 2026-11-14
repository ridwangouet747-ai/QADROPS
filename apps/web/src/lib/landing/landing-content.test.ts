import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { landingAr, landingEn, landingFr } from "@/lib/i18n/messages/landing";

/*
 * Mission CTO du 2026-11-14 : la page publique de production ne montre ni « données de démonstration », ni chiffre,
 * ni nom de client ou de commerce inventé, dans aucune langue. Les écrans illustrés sont schématiques.
 * Seuls les textes affichés hors production (aperçu local, emplacement vidéo vide) échappent au contrôle des mots.
 */

const previewOnly = new Set(["pricing.previewBadge", "video.placeholder", "video.placeholderNote"]);

const demoWording = /d[ée]monstration|\bd[ée]mos?\b|fictiv|fictif|\bexemple\b|\bexample\b|\bsample\b|\bdummy\b|تجريبي|وهمي|توضيحي|مثال/i;
const knownFakes = ["Quincaillerie du Plateau", "Moussa Traoré", "Dépôt Koné", "Client Démo", "Vente n° 0142", "0142", "14 350", "14350", "6 500", "12 000", "2 350", "84 500"];

function texts(tree: unknown, path: string[] = []): { key: string; value: string }[] {
  if (typeof tree === "string") return [{ key: path.join("."), value: tree }];
  if (tree && typeof tree === "object") return Object.entries(tree).flatMap(([key, value]) => texts(value, [...path, key]));
  return [];
}

const landingDir = resolve(process.cwd(), "src/components/landing");
const sources = readdirSync(landingDir).filter((file) => /\.(tsx|ts)$/.test(file)).map((file) => ({ file, code: readFileSync(resolve(landingDir, file), "utf8") }));

describe("page publique : aucun contenu de démonstration en production", () => {
  for (const [locale, messages] of [["fr", landingFr], ["en", landingEn], ["ar", landingAr]] as const) {
    it(`textes (${locale}) : ni mention de démonstration, ni exemple chiffré, ni nom inventé`, () => {
      const shown = texts(messages).filter(({ key }) => !previewOnly.has(key));
      expect(shown.length).toBeGreaterThan(50);
      expect(shown.filter(({ value }) => demoWording.test(value))).toEqual([]);
      expect(shown.filter(({ value }) => knownFakes.some((fake) => value.includes(fake)))).toEqual([]);
    });
  }

  it("composants : aucune capture de l'aperçu, aucun montant écrit en dur, aucun badge de démonstration", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/["'`]\/landing\//);
      expect(code, file).not.toMatch(/formatXof\(\s*["'`]\d/);
      expect(code, file).not.toMatch(/landing\.hero\.demo|landing\.day\.example/);
      expect(knownFakes.filter((fake) => code.includes(fake)), file).toEqual([]);
    }
  });

  it("les captures marquées « données fictives » ne sont plus servies par le site", () => {
    const publicLanding = resolve(process.cwd(), "public/landing");
    const images = existsSync(publicLanding) ? readdirSync(publicLanding).filter((file) => /\.(png|jpe?g|webp|avif)$/i.test(file)) : [];
    expect(images).toEqual([]);
  });
});
