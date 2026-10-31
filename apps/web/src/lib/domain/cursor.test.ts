import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, likePattern, movementCursorSchema, pageLimit, productCursorSchema } from "./cursor";

describe("curseurs de pagination", () => {
  it("encode puis relit un curseur produit, y compris avec des caractères arabes", () => {
    const cursor = encodeCursor({ name: "إسمنت « 50 kg »", id: "variant-1" });
    expect(decodeCursor(cursor, productCursorSchema)).toEqual({ name: "إسمنت « 50 kg »", id: "variant-1" });
  });

  it("refuse un curseur altéré ou d’un autre type avec une erreur 400", () => {
    expect(() => decodeCursor("pas-un-curseur", productCursorSchema)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => decodeCursor(encodeCursor({ name: "x", id: "y" }), movementCursorSchema)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => decodeCursor("a".repeat(600), productCursorSchema)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("ignore un curseur absent", () => {
    expect(decodeCursor(null, productCursorSchema)).toBeNull();
    expect(decodeCursor("", productCursorSchema)).toBeNull();
  });

  it("borne la taille de page", () => {
    expect(pageLimit(undefined)).toBe(24);
    expect(pageLimit("500")).toBe(100);
    expect(pageLimit("0")).toBe(1);
    expect(pageLimit("abc")).toBe(24);
  });

  it("échappe les jokers SQL saisis dans la recherche", () => {
    expect(likePattern(" 50%_off ")).toBe("%50\\%\\_off%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
});
