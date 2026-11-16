import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { landingAr, landingEn, landingFr } from "@/lib/i18n/messages/landing";
import { locales } from "@/lib/i18n/config";
import { interfaceScreen, interfaceScreenFiles, interfaceScreenKeys } from "@/lib/landing/interface-screens";

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

  it("les anciennes captures marquées « données fictives » ne sont plus servies par le site", () => {
    const publicLanding = resolve(process.cwd(), "public/landing");
    const images = existsSync(publicLanding) ? readdirSync(publicLanding).filter((file) => /\.(png|jpe?g|webp|avif)$/i.test(file)) : [];
    expect(images).toEqual([]);
  });
});

/*
 * Mission du 2026-11-16 : une seule exception, la section « Les vrais écrans ». Elle ne sert que les captures listées
 * dans lib/landing/interface-screens.ts (toutes présentes, aucune autre image) et annonce dans chaque langue qu'il
 * s'agit de données de test.
 */
describe("page publique : captures réelles annoncées comme données de test", () => {
  const screensDir = resolve(process.cwd(), "public/landing/apercu");
  const served = existsSync(screensDir) ? readdirSync(screensDir, { recursive: true, encoding: "utf8" }).filter((file) => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(file)).map((file) => file.replaceAll("\\", "/")).sort() : [];

  it("chaque image servie est déclarée dans le manifeste, et chaque image déclarée existe", () => {
    expect(served).toEqual([...interfaceScreenFiles()].sort());
    expect(served.length).toBe(3 * 8 * 2);
  });

  it("chaque image utilisée par la section vient du manifeste, avec un texte alternatif qui dit « données de test »", () => {
    for (const locale of locales) {
      for (const key of interfaceScreenKeys) {
        const image = interfaceScreen(locale, key);
        for (const candidate of image.srcSet.split(", ").map((entry) => entry.split(" ")[0]!)) expect(served).toContain(candidate.replace("/landing/apercu/", ""));
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
      }
    }
    for (const [messages, mention] of [[landingFr, /données de test/i], [landingEn, /test data/i], [landingAr, /بيانات اختبار/]] as const) {
      expect(messages.screens.intro).toMatch(mention);
      expect(messages.screens.badge).toMatch(mention);
      expect(messages.screens.alt).toMatch(mention);
      expect(Object.keys(messages.screens.items).sort()).toEqual([...interfaceScreenKeys].sort());
    }
  });
});
