import { describe, expect, it } from "vitest";
import { closeDatabases, getDatabase } from "./client";

// Aucune connexion n'est ouverte : le pool ne se connecte qu'à la première requête SQL.
describe("getDatabase", () => {
  it("réutilise la même base pour la même URL au lieu d'ouvrir un pool par requête", () => {
    const url = "postgresql://utilisateur:motdepasse@exemple.invalid/qadr";
    expect(getDatabase(url)).toBe(getDatabase(url));
  });

  it("ouvre une base distincte pour une autre URL", () => {
    expect(getDatabase("postgresql://a:b@exemple.invalid/une")).not.toBe(getDatabase("postgresql://a:b@exemple.invalid/deux"));
  });

  it("closeDatabases ferme chaque pool (un script se termine aussitôt) et oublie les bases fermées", async () => {
    const url = "postgresql://a:b@exemple.invalid/script";
    const before = getDatabase(url);
    const pool = before.$client;
    await closeDatabases();
    expect(pool.ended).toBe(true);
    expect(getDatabase(url)).not.toBe(before);
    await closeDatabases();
  });
});
