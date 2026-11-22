import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPendingSale, pendingSaleKey, pendingSaleTtlMs, rememberPendingSale, saleDigest } from "./pending-sale";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key), dump: () => [...values.values()].join("") };
}

describe("vente en attente de réponse", () => {
  let store: ReturnType<typeof memoryStorage>;
  beforeEach(() => { store = memoryStorage(); vi.stubGlobal("sessionStorage", store); });

  it("la même vente retrouve sa clé après un rechargement ; une autre vente non", async () => {
    const sale = JSON.stringify({ lines: [{ variantId: "v1", quantity: "2" }], payments: [{ method: "cash", amountXof: "5000" }] });
    const digest = await saleDigest(sale);
    rememberPendingSale(digest, "cle-vente-1", 1_000);
    expect(pendingSaleKey(await saleDigest(sale), 2_000)).toBe("cle-vente-1");
    expect(pendingSaleKey(await saleDigest(sale.replace("5000", "6000")), 2_000)).toBeNull();
  });

  it("ne garde ni article, ni montant, ni identifiant : seulement une empreinte", async () => {
    const digest = await saleDigest(JSON.stringify({ customerId: "client-awa", lines: [{ variantId: "variante-ciment" }], payments: [{ amountXof: "123456" }] }));
    rememberPendingSale(digest, "cle-vente-2", 1_000);
    expect(store.dump()).not.toMatch(/client-awa|variante-ciment|123456/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expire, et s'efface à la réponse du serveur ou à la déconnexion", async () => {
    const digest = await saleDigest("vente");
    rememberPendingSale(digest, "cle-vente-3", 0);
    expect(pendingSaleKey(digest, pendingSaleTtlMs + 1)).toBeNull();
    rememberPendingSale(digest, "cle-vente-3", 0);
    forgetPendingSale();
    expect(pendingSaleKey(digest, 1)).toBeNull();
  });

  it("stockage indisponible ou contenu illisible : aucune erreur, aucune clé inventée", async () => {
    store.setItem("qadr-pos-pending-sale", "{pas du json");
    expect(pendingSaleKey(await saleDigest("vente"))).toBeNull();
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("bloqué"); }, removeItem: () => { throw new Error("bloqué"); } });
    expect(() => rememberPendingSale("d", "k")).not.toThrow();
    expect(pendingSaleKey("d")).toBeNull();
    expect(() => forgetPendingSale()).not.toThrow();
  });
});
