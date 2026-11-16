import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registrationAllows, registrationPolicy } from "@/lib/auth/registration";
import { createQadrAuth, signUpRefusal } from "@/lib/auth/server";
import { count } from "drizzle-orm";
import { account, session, user, verification } from "@/lib/db/schema";
import { HARNESS_ORIGIN, startHttpHarness, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * 2026-11-13 : usage personnel sous l'offre Vercel Hobby. En production Vercel, seules les adresses de
 * QADR_REGISTRATION_ALLOWLIST peuvent créer un compte par requête HTTP ; sans liste, aucune. Vraie instance
 * Better Auth sur PGlite migrée.
 */
describe("ouverture des inscriptions", () => {
  describe("règle lue dans l'environnement", () => {
    it("ouverte hors production Vercel quand rien n'est déclaré", () => {
      expect(registrationPolicy({ NODE_ENV: "production" })).toEqual({ mode: "open" });
      expect(registrationPolicy({ VERCEL_ENV: "preview" })).toEqual({ mode: "open" });
    });
    it("fermée à tous en production Vercel sans liste", () => {
      const policy = registrationPolicy({ VERCEL_ENV: "production" });
      expect(policy.mode).toBe("allowlist");
      expect(registrationAllows(policy, "qui@que.ce.soit")).toBe(false);
    });
    it("liste : casse et espaces ignorés, valeurs vides écartées", () => {
      const policy = registrationPolicy({ VERCEL_ENV: "production", QADR_REGISTRATION_ALLOWLIST: " Proprio@Boutique.CI , ,autre@b.ci" });
      expect(registrationAllows(policy, "proprio@boutique.ci")).toBe(true);
      expect(registrationAllows(policy, " AUTRE@b.ci ")).toBe(true);
      expect(registrationAllows(policy, "intrus@boutique.ci")).toBe(false);
      expect(registrationAllows(policy, undefined)).toBe(false);
    });
    it("QADR_REGISTRATION=open l'emporte, même en production", () => {
      expect(registrationPolicy({ VERCEL_ENV: "production", QADR_REGISTRATION: "open", QADR_REGISTRATION_ALLOWLIST: "a@b.ci" }))
        .toEqual({ mode: "open" });
    });
  });

  describe("inscription HTTP avec une liste", () => {
    let h: HttpHarness;
    let auth: ReturnType<typeof createQadrAuth>;
    let ip = 0;
    const signUp = (email: string) => auth.handler(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": `198.19.0.${++ip}` },
      body: JSON.stringify({ name: "Essai", email, password: "mot-de-passe-de-test-liste" }),
    }));

    beforeAll(async () => {
      h = await startHttpHarness();
      auth = createQadrAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: HARNESS_ORIGIN, isProduction: false,
        registration: registrationPolicy({ VERCEL_ENV: "production", QADR_REGISTRATION_ALLOWLIST: "proprio@liste.test" }) });
    });
    afterAll(async () => { await h?.close(); });

    it("adresse hors liste : refus générique, aucun compte, aucun cookie", async () => {
      const response = await signUp("intrus@liste.test");
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual(signUpRefusal);
      expect(response.headers.get("set-cookie")).toBeNull();
      const accounts = await h.db.select({ email: user.email }).from(user);
      expect(accounts.map((row) => row.email)).not.toContain("intrus@liste.test");
    });

    it("adresse de la liste : compte créé, quelle que soit la casse", async () => {
      const response = await signUp("Proprio@Liste.test");
      expect(response.status).toBe(200);
      const accounts = await h.db.select({ email: user.email }).from(user);
      expect(accounts.map((row) => row.email)).toContain("proprio@liste.test");
    });

    it("création par le serveur (sans requête HTTP) : non visée", async () => {
      const created = await auth.api.signUpEmail({ body: { name: "Script", email: "script@hors-liste.test", password: "mot-de-passe-de-test-liste" } });
      expect(created.user.email).toBe("script@hors-liste.test");
    });

    it("hors liste, adresse déjà inscrite ou inconnue : même réponse, rien n'est créé (aucune comparaison de durée)", async () => {
      // script@hors-liste.test existe (essai précédent) ; inconnue@hors-liste.test n'existe pas.
      const before = await tableCounts();
      const existing = await signUp("script@hors-liste.test");
      const unknown = await signUp("inconnue@hors-liste.test");
      expect(existing.status).toBe(422);
      expect(unknown.status).toBe(existing.status);
      expect(await existing.json()).toEqual(signUpRefusal);
      expect(await unknown.json()).toEqual(signUpRefusal);
      const headerNames = (response: Response) => [...response.headers.keys()].filter((name) => name !== "date").sort();
      expect(headerNames(unknown)).toEqual(headerNames(existing));
      expect(existing.headers.get("set-cookie")).toBeNull();
      expect(unknown.headers.get("set-cookie")).toBeNull();
      expect(await tableCounts()).toEqual(before);
    });

    it("limitation : au-delà de 30 inscriptions par adresse IP et par heure, refus 429", async () => {
      const fixedIp = "198.19.7.7";
      const attempt = (index: number) => auth.handler(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": fixedIp },
        body: JSON.stringify({ name: "Rafale", email: `rafale-${index}@hors-liste.test`, password: "mot-de-passe-de-test-liste" }),
      }));
      for (let index = 0; index < 30; index += 1) expect((await attempt(index)).status).toBe(422);
      expect((await attempt(30)).status).toBe(429);
      const accounts = await h.db.select({ email: user.email }).from(user);
      expect(accounts.some((row) => row.email?.startsWith("rafale-"))).toBe(false);
    });

    async function tableCounts() {
      const counted = await Promise.all([user, account, session, verification].map(async (table) => (await h.db.select({ n: count() }).from(table))[0]!.n));
      return { user: counted[0], account: counted[1], session: counted[2], verification: counted[3] };
    }
  });
});
