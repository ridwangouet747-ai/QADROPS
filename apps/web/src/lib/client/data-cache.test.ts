import { beforeEach, describe, expect, it, vi } from "vitest";
import { announceAccountChange, clearClientCache, forgetAfterRefusal, forgetCached, isApiWrite, readCached, setClientCacheScope, watchApiWrites, writeCached } from "./data-cache";

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

  it("un refus 401 ou 403 vide tout et révoque la portée ; un autre refus n'oublie que l'entrée", () => {
    setClientCacheScope("user-r:business-r");
    writeCached("/api/business/dashboard", { today: 1 });
    writeCached("/api/business/sales", { items: [] });
    forgetAfterRefusal("/api/business/sales", 404);
    expect(readCached("/api/business/sales")).toBeUndefined();
    expect(readCached("/api/business/dashboard")).toEqual({ today: 1 });
    forgetAfterRefusal("/api/business/dashboard", 401);
    expect(readCached("/api/business/dashboard")).toBeUndefined();
    // La mise en page de l'onglet repose la même portée : elle reste éteinte (session ou droit changé).
    setClientCacheScope("user-r:business-r");
    writeCached("/api/business/dashboard", { today: 2 });
    expect(readCached("/api/business/dashboard")).toBeUndefined();
    // Une autre portée (nouveau rendu serveur après reconnexion) fonctionne normalement.
    setClientCacheScope("user-r2:business-r");
    writeCached("/api/business/dashboard", { today: 3 });
    expect(readCached("/api/business/dashboard")).toEqual({ today: 3 });
  });

  it("un changement de compte ou de commerce annoncé par un autre onglet vide et révoque cet onglet", async () => {
    setClientCacheScope("user-t:business-t");
    writeCached("/api/business/products", { products: ["de T"] });
    const otherTab = new BroadcastChannel("qadr-client-cache");
    otherTab.postMessage("account-changed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    otherTab.close();
    expect(readCached("/api/business/products")).toBeUndefined();
    setClientCacheScope("user-t:business-t");
    writeCached("/api/business/products", { products: ["encore T"] });
    expect(readCached("/api/business/products")).toBeUndefined();
  });

  it("l'onglet qui annonce le changement se vide sans révoquer : la nouvelle portée reprend", () => {
    setClientCacheScope("user-u:business-u");
    writeCached("/api/business/products", { products: ["de U"] });
    announceAccountChange();
    expect(readCached("/api/business/products")).toBeUndefined();
    setClientCacheScope("user-u:business-u2");
    writeCached("/api/business/products", { products: ["de U2"] });
    expect(readCached("/api/business/products")).toEqual({ products: ["de U2"] });
  });

  it("reconnaît une écriture vers l'API, pas une lecture ni un appel externe", () => {
    expect(isApiWrite("/api/business/sales", { method: "POST" })).toBe(true);
    expect(isApiWrite("/api/business/products/p1", { method: "patch" })).toBe(true);
    expect(isApiWrite(new Request("http://local/api/business/stock/opening", { method: "PUT" }))).toBe(true);
    expect(isApiWrite("/api/business/products")).toBe(false);
    expect(isApiWrite("/api/business/products", { method: "GET" })).toBe(false);
    expect(isApiWrite("https://exemple.test/autre", { method: "POST" })).toBe(false);
  });

  it("toute écriture vers l'API vide les données gardées, au départ comme à l'arrivée", async () => {
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const fakeWindow = { fetch: async (input: RequestInfo | URL) => { calls.push(String(input)); await pending; return new Response("{}"); } };
    vi.stubGlobal("window", fakeWindow);
    try {
      watchApiWrites();
      setClientCacheScope("user-w:business-w");
      writeCached("/api/business/dashboard", { today: 1 });
      const sale = window.fetch("/api/business/sales", { method: "POST" });
      expect(readCached("/api/business/dashboard")).toBeUndefined();
      // Une lecture partie avant l'écriture et revenue pendant : effacée à l'arrivée de l'écriture.
      writeCached("/api/business/dashboard", { today: 1 });
      release();
      await sale;
      expect(readCached("/api/business/dashboard")).toBeUndefined();
      // Une lecture ne vide rien.
      writeCached("/api/business/dashboard", { today: 2 });
      await window.fetch("/api/business/dashboard");
      expect(readCached("/api/business/dashboard")).toEqual({ today: 2 });
      expect(calls).toEqual(["/api/business/sales", "/api/business/dashboard"]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("reste borné en nombre d'entrées", () => {
    setClientCacheScope("user-a:business-a");
    for (let index = 0; index < 60; index++) writeCached(`/api/business/x?page=${index}`, index);
    expect(readCached("/api/business/x?page=0")).toBeUndefined();
    expect(readCached("/api/business/x?page=59")).toBe(59);
  });
});
