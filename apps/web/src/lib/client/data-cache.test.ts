import { beforeEach, describe, expect, it } from "vitest";
import { clearClientCache, forgetCached, readCached, setClientCacheScope, writeCached } from "./data-cache";

describe("données gardées en mémoire de l'onglet", () => {
  beforeEach(() => clearClientCache());

  it("ne garde rien hors de l'espace commerçant (sans portée)", () => {
    writeCached("/api/business/products", { products: [1] });
    expect(readCached("/api/business/products")).toBeUndefined();
  });

  it("réaffiche la dernière réponse du même compte et du même commerce", () => {
    setClientCacheScope("user-a:business-a");
    writeCached("/api/business/products", { products: [1] });
    expect(readCached("/api/business/products")).toEqual({ products: [1] });
  });

  it("n'affiche jamais les données d'un autre commerce ni d'un autre compte", () => {
    setClientCacheScope("user-a:business-a");
    writeCached("/api/business/products", { products: ["de A"] });
    setClientCacheScope("user-a:business-b");
    expect(readCached("/api/business/products")).toBeUndefined();
    setClientCacheScope("user-a:business-a");
    expect(readCached("/api/business/products")).toBeUndefined();
    setClientCacheScope("user-b:business-a");
    expect(readCached("/api/business/products")).toBeUndefined();
  });

  it("vide tout à la déconnexion", () => {
    setClientCacheScope("user-a:business-a");
    writeCached("/api/business/dashboard", { today: 1 });
    clearClientCache();
    setClientCacheScope("user-a:business-a");
    expect(readCached("/api/business/dashboard")).toBeUndefined();
  });

  it("oublie les entrées rendues fausses par une écriture", () => {
    setClientCacheScope("user-a:business-a");
    writeCached("/api/business/sales?limit=25", { items: [] });
    writeCached("/api/business/dashboard", { today: 1 });
    forgetCached("/api/business/sales");
    expect(readCached("/api/business/sales?limit=25")).toBeUndefined();
    expect(readCached("/api/business/dashboard")).toEqual({ today: 1 });
  });

  it("reste borné en nombre d'entrées", () => {
    setClientCacheScope("user-a:business-a");
    for (let index = 0; index < 60; index++) writeCached(`/api/business/x?page=${index}`, index);
    expect(readCached("/api/business/x?page=0")).toBeUndefined();
    expect(readCached("/api/business/x?page=59")).toBe(59);
  });
});
