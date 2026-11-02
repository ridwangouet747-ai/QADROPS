import { describe, expect, it } from "vitest";
import { encodeText, EscPosBuilder, initCommands, rasterCommands } from "./escpos";
import { chooseRender, codePageSelector, resolveProfile } from "./profiles";
import { logoBitmap, logoSize, packCentered, rgbaToGray, scaleGray, stackBitmaps, toMonochrome, type MonoBitmap } from "./raster";
import { encodeRasterTicket, encodeTicketText, layoutTestTicket } from "./receipt-ticket";

/** Image RGBA unie de `width` × `height`. */
const solid = (width: number, height: number, [r, g, b, a]: [number, number, number, number]) =>
  Uint8Array.from({ length: width * height * 4 }, (_, index) => [r, g, b, a][index % 4]!);

describe("profils d'imprimante", () => {
  it("58 mm = 384 points / 32 colonnes, 80 mm = 576 points / 48 colonnes ; valeurs inconnues ramenées au défaut", () => {
    expect(resolveProfile({ paperWidthMm: 58 })).toEqual({ paperWidthMm: 58, dots: 384, columns: 32, codePage: "pc858", renderMode: "auto" });
    expect(resolveProfile({ paperWidthMm: 80, codePage: "wpc1252", renderMode: "raster" })).toEqual({ paperWidthMm: 80, dots: 576, columns: 48, codePage: "wpc1252", renderMode: "raster" });
    expect(resolveProfile({ paperWidthMm: 112, codePage: "cp864", renderMode: "magie" })).toMatchObject({ paperWidthMm: 80, codePage: "pc858", renderMode: "auto" });
  });

  it("automatique : image pour l'arabe ou un caractère hors page de codes, texte sinon ; un choix forcé est respecté", () => {
    const auto = resolveProfile({ paperWidthMm: 58 });
    expect(chooseRender(auto, { direction: "ltr", unsupportedCharacters: 0 })).toBe("text");
    expect(chooseRender(auto, { direction: "rtl", unsupportedCharacters: 0 })).toBe("raster");
    expect(chooseRender(auto, { direction: "ltr", unsupportedCharacters: 1 })).toBe("raster");
    expect(chooseRender({ ...auto, renderMode: "text" }, { direction: "rtl", unsupportedCharacters: 9 })).toBe("text");
    expect(chooseRender({ ...auto, renderMode: "raster" }, { direction: "ltr", unsupportedCharacters: 0 })).toBe("raster");
  });
});

describe("pages de codes", () => {
  it("ESC t n selon le profil : PC858 = 19, PC850 = 2, WPC1252 = 16", () => {
    expect(initCommands("pc858")).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(initCommands("pc850")).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
    expect(initCommands("wpc1252")).toEqual([0x1b, 0x40, 0x1b, 0x74, 16]);
    expect(codePageSelector).toEqual({ pc858: 19, pc850: 2, wpc1252: 16 });
    expect([...new EscPosBuilder(58, "wpc1252").build()]).toEqual([0x1b, 0x40, 0x1b, 0x74, 16]);
  });

  it("encode les accents dans chaque page ; l'euro n'existe pas en PC850", () => {
    expect(encodeText("é€", "pc858")).toEqual({ bytes: [0x82, 0xd5], unsupported: 0 });
    expect(encodeText("é€", "pc850")).toEqual({ bytes: [0x82, 0x3f], unsupported: 1 });
    expect(encodeText("éèàçÉ€Š", "wpc1252")).toEqual({ bytes: [0xe9, 0xe8, 0xe0, 0xe7, 0xc9, 0x80, 0x8a], unsupported: 0 });
  });

  it("les isolants bidirectionnels (LRI, PDI) ne produisent aucun octet", () => {
    expect(encodeText("⁦12 500 F⁩")).toEqual({ bytes: [...Buffer.from("12 500 F")], unsupported: 0 });
  });
});

describe("images en trame (GS v 0)", () => {
  it("octets exacts : en-tête GS v 0 m xL xH yL yH puis les données", () => {
    const bitmap: MonoBitmap = { width: 16, height: 2, data: Uint8Array.from([0xff, 0x00, 0x0f, 0xf0]) };
    expect(rasterCommands(bitmap)).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0]);
  });

  it("découpe une image haute en bandes de 128 lignes au plus", () => {
    const bitmap: MonoBitmap = { width: 384, height: 300, data: new Uint8Array(48 * 300) };
    const bytes = rasterCommands(bitmap);
    expect(bytes.length).toBe(3 * 8 + 48 * 300);
    expect(bytes.slice(0, 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 128, 0]);
    expect(bytes.slice(8 + 48 * 128, 16 + 48 * 128)).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 128, 0]);
    expect(bytes.slice(16 + 48 * 256, 24 + 48 * 256)).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 44, 0]);
  });

  it("refuse une image mal formée", () => {
    expect(() => rasterCommands({ width: 10, height: 1, data: new Uint8Array(2) })).toThrow();
    expect(() => rasterCommands({ width: 8, height: 2, data: new Uint8Array(1) })).toThrow();
  });

  it("ticket entièrement en image : initialisation, bandes, avance, coupe", () => {
    const bitmap: MonoBitmap = { width: 8, height: 1, data: Uint8Array.from([0x80]) };
    expect([...encodeRasterTicket(bitmap)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19, 0x1d, 0x76, 0x30, 0x00, 1, 0, 1, 0, 0x80, 0x0a, 0x0a, 0x1d, 0x56, 66, 3]);
  });
});

describe("logo du commerce", () => {
  it("gris : la transparence est posée sur du blanc", () => {
    expect([...rgbaToGray(Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]), 3, 1).data]).toEqual([0, 255, 255]);
    expect(() => rgbaToGray(new Uint8Array(3), 1, 1)).toThrow();
  });

  it("taille : au plus 60 % de la largeur (multiple de 8) et 120 / 160 points de haut, agrandi au plus deux fois", () => {
    expect(logoSize({ width: 1000, height: 100 }, 384)).toEqual({ width: 224, height: 22 });
    expect(logoSize({ width: 100, height: 1000 }, 576)).toEqual({ width: 16, height: 160 });
    expect(logoSize({ width: 40, height: 20 }, 384)).toEqual({ width: 80, height: 40 });
  });

  it("seuil et tramage Atkinson : noir reste noir, blanc reste blanc, gris moyen donne une trame", () => {
    const gray = (value: number) => ({ width: 8, height: 8, data: new Uint8Array(64).fill(value) });
    expect(toMonochrome(gray(0)).every((bit) => bit === 1)).toBe(true);
    expect(toMonochrome(gray(255), "atkinson").every((bit) => bit === 0)).toBe(true);
    const dithered = toMonochrome(gray(128), "atkinson");
    const ink = dithered.reduce((sum, bit) => sum + bit, 0);
    expect(ink).toBeGreaterThan(8);
    expect(ink).toBeLessThan(56);
    expect(toMonochrome(gray(100), "threshold", 90).every((bit) => bit === 0)).toBe(true);
  });

  it("mise à l'échelle par moyenne de zone", () => {
    const image = { width: 4, height: 1, data: Uint8Array.from([0, 0, 255, 255]) };
    expect([...scaleGray(image, 2, 1).data]).toEqual([0, 255]);
  });

  it("centrage dans la largeur du papier, bit de poids fort à gauche", () => {
    const packed = packCentered(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1]), 8, 1, 24);
    expect(packed).toEqual({ width: 24, height: 1, data: Uint8Array.from([0x00, 0x81, 0x00]) });
    expect(() => packCentered(new Uint8Array(32), 32, 1, 24)).toThrow();
  });

  it.each([[384, 48], [576, 72]] as const)("logo noir à %i points : image à la largeur du papier, centrée, imprimée avant le nom", (dots, bytesPerRow) => {
    const bitmap = logoBitmap(solid(100, 50, [0, 0, 0, 255]), 100, 50, dots)!;
    expect(bitmap.width).toBe(dots);
    expect(bitmap.data.length).toBe(bytesPerRow * bitmap.height);
    expect(bitmap.data[0]).toBe(0);
    expect(bitmap.data[bytesPerRow / 2]).toBe(0xff);
    const ticket = encodeTicketText({ language: "fr", direction: "ltr", logo: "data:", blocks: [{ type: "logo" }, { type: "text", text: "Koné", align: "center" }] },
      resolveProfile({ paperWidthMm: dots === 384 ? 58 : 80 }), { logo: bitmap });
    const bytes = [...ticket.bytes];
    expect(bytes.slice(5, 13)).toEqual([0x1d, 0x76, 0x30, 0x00, bytesPerRow, 0, bitmap.height, 0]);
    expect(ticket.preview).toEqual(["[logo]", "Koné"]);
  });

  it("logo blanc ou transparent : rien à imprimer", () => {
    expect(logoBitmap(solid(10, 10, [255, 255, 255, 255]), 10, 10, 384)).toBeNull();
    expect(logoBitmap(solid(10, 10, [0, 0, 0, 0]), 10, 10, 384)).toBeNull();
    expect(logoBitmap(new Uint8Array(0), 0, 0, 384)).toBeNull();
  });

  it("superpose des images de même largeur", () => {
    const a: MonoBitmap = { width: 8, height: 1, data: Uint8Array.from([0xf0]) };
    const b: MonoBitmap = { width: 8, height: 2, data: Uint8Array.from([0x0f, 0xff]) };
    expect(stackBitmaps([a, b])).toEqual({ width: 8, height: 3, data: Uint8Array.from([0xf0, 0x0f, 0xff]) });
    expect(() => stackBitmaps([a, { width: 16, height: 1, data: new Uint8Array(2) }])).toThrow();
  });
});

describe("page de test", () => {
  it("annonce la largeur, les colonnes et le mode d'écriture ; arabe en rtl", () => {
    const profile = resolveProfile({ paperWidthMm: 80 });
    const french = layoutTestTicket({ businessName: "Commerce Démo", language: "fr", profile, render: "text", now: new Date("2026-11-01T10:00:00Z") });
    const lines = french.blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
    expect(lines).toContain("Largeur : 80 mm / 48 col.");
    expect(lines).toContain("Écriture : texte");
    expect(lines).toContain("1234567890".repeat(5).slice(0, 48));
    const arabic = layoutTestTicket({ businessName: "Commerce Démo", language: "ar", profile, render: "raster" });
    expect(arabic.direction).toBe("rtl");
  });
});
