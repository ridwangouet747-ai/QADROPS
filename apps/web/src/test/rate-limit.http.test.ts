import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import { createQadrAuth } from "@/lib/auth/server";
import { consumeRateLimit, consumeRateLimits, purgeRateLimitBuckets, rateLimitKey, rateRules, refundRateLimit, type RateRule } from "@/lib/security/rate-limit";
import { HARNESS_ORIGIN, startHttpHarness, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

/*
 * Mission 14 : limitation des tentatives partagée par toutes les instances, dans PostgreSQL (PGlite ici, Neon
 * de staging avec QADR_TEST_POSTGRES_URL). Les « instances » sont des appels concurrents et deux objets Better
 * Auth distincts sur la même base : c'est exactement ce que partagent deux fonctions Vercel.
 */
const SECRET = "secret-de-test-limitation-qadr-ops-0123456789";
const rule = (name: string, limit = 5, windowMs = 15 * 60_000): RateRule => ({ name, limit, windowMs });
const T0 = new Date("2026-11-09T10:00:00.000Z");

describe("limitation distribuée des tentatives (PostgreSQL)", () => {
  let h: HttpHarness;
  beforeAll(async () => { h = await startHttpHarness(); });
  afterAll(async () => { await h?.close(); });

  const bucket = async (key: string) => (await h.client.query<{ hits: number }>("select hits from rate_limit_bucket where key = $1", [key])).rows[0]?.hits;

  it("clé : empreinte HMAC, jamais le sujet en clair, dépendante du secret", async () => {
    const key = rateLimitKey(rateRules.signInAccount, "awa@boutique.test", SECRET);
    expect(key).toMatch(/^auth\.sign_in\.account:[0-9a-f]{40}$/);
    expect(key).not.toContain("awa");
    expect(rateLimitKey(rateRules.signInAccount, "awa@boutique.test", `${SECRET}-autre`)).not.toBe(key);
    await consumeRateLimit(h.db, rateRules.signInAccount, "awa@boutique.test", SECRET, T0);
    const stored = JSON.stringify((await h.client.query("select * from rate_limit_bucket")).rows);
    expect(stored).not.toContain("awa@boutique.test");
  });

  it("séquentiel : la limite exacte passe, la suivante est refusée avec un délai borné", async () => {
    const r = rule("test.sequentiel");
    const decisions = [];
    for (let i = 0; i < 7; i += 1) decisions.push(await consumeRateLimit(h.db, r, "client-a", SECRET, new Date(T0.getTime() + 60_000)));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, true, true, false, false]);
    expect(decisions[5]!.retryAfterSeconds).toBe(14 * 60);
    // Un autre sujet a son propre compteur.
    expect((await consumeRateLimit(h.db, r, "client-b", SECRET, T0)).allowed).toBe(true);
  });

  it("concurrence : 40 tentatives simultanées sur la même clé, exactement la limite autorisée, aucun compte perdu", async () => {
    const r = rule("test.concurrent", 7);
    const results = await Promise.all(Array.from({ length: 40 }, () => consumeRateLimit(h.db, r, "rafale", SECRET, T0)));
    expect(results.filter((d) => d.allowed)).toHaveLength(7);
    expect(results.map((d) => d.hits).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(await bucket(results[0]!.key)).toBe(40);
  });

  it("fenêtre suivante : le compteur repart ; une horloge en retard ne remet jamais la fenêtre récente à zéro", async () => {
    const r = rule("test.fenetre", 2, 60_000);
    for (let i = 0; i < 3; i += 1) await consumeRateLimit(h.db, r, "x", SECRET, T0);
    expect((await consumeRateLimit(h.db, r, "x", SECRET, T0)).allowed).toBe(false);
    const next = await consumeRateLimit(h.db, r, "x", SECRET, new Date(T0.getTime() + 60_000));
    expect(next).toMatchObject({ allowed: true, hits: 1 });
    // Instance dont l'horloge retarde (encore dans la fenêtre précédente) : elle incrémente la fenêtre récente.
    const late = await consumeRateLimit(h.db, r, "x", SECRET, new Date(T0.getTime() + 59_000));
    expect(late).toMatchObject({ allowed: true, hits: 2 });
    expect((await consumeRateLimit(h.db, r, "x", SECRET, new Date(T0.getTime() + 61_000))).allowed).toBe(false);
  });

  it("plusieurs règles : refus dès qu'une seule est dépassée ; remboursement sans passer sous zéro", async () => {
    const strict = rule("test.multi.strict", 1);
    const wide = rule("test.multi.large", 100);
    const first = await consumeRateLimits(h.db, [{ rule: strict, subject: "s" }, { rule: wide, subject: "s" }], SECRET, T0);
    expect(first.allowed).toBe(true);
    const second = await consumeRateLimits(h.db, [{ rule: strict, subject: "s" }, { rule: wide, subject: "s" }], SECRET, T0);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    await refundRateLimit(h.db, second.decisions);
    await refundRateLimit(h.db, second.decisions);
    await refundRateLimit(h.db, second.decisions);
    expect(await bucket(second.decisions[0]!.key)).toBe(0);
    expect((await consumeRateLimits(h.db, [{ rule: strict, subject: "s" }], SECRET, T0)).allowed).toBe(true);
  });

  it("purge : seules les fenêtres échues depuis plus d'un jour disparaissent", async () => {
    const old = await consumeRateLimit(h.db, rule("test.purge"), "ancien", SECRET, new Date(T0.getTime() - 3 * 24 * 3_600_000));
    const recent = await consumeRateLimit(h.db, rule("test.purge"), "recent", SECRET, T0);
    const removed = await purgeRateLimitBuckets(h.db, T0);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await bucket(old.key)).toBeUndefined();
    expect(await bucket(recent.key)).toBe(1);
  });

  describe("routes Better Auth des commerçants", () => {
    const signIn = (body: unknown, ip: string, handler: (request: Request) => Promise<Response> = authRoute.POST) =>
      handler(new Request(`${HARNESS_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": ip }, body: JSON.stringify(body),
      }));

    it("compte visé protégé même quand l'attaque change d'adresse et d'instance ; les autres comptes passent", async () => {
      const victim = await h.signUp("Mariam Tissus", "mariam@tissus.test");
      await h.signUp("Yao Quincaillerie", "yao@quincaillerie.test");
      // Seconde instance Better Auth sur la même base (autre fonction Vercel) : compteurs en mémoire séparés,
      // compteur PostgreSQL commun.
      const other = createQadrAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: HARNESS_ORIGIN, isProduction: false });
      const statuses: number[] = [];
      for (let attempt = 0; attempt < rateRules.signInAccount.limit; attempt += 1) {
        const handler = attempt % 2 ? (request: Request) => other.handler(request) : authRoute.POST;
        statuses.push((await signIn({ email: victim.email, password: `faux-mot-de-passe-${attempt}` }, `203.0.113.${attempt + 1}`, handler)).status);
      }
      expect(statuses.every((status) => status === 401)).toBe(true);
      const blocked = await signIn({ email: victim.email, password: "mot-de-passe-de-test-harnais" }, "203.0.113.200", (request) => other.handler(request));
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(blocked.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(false);
      // Casse et espaces ne contournent pas la clé du compte.
      expect((await signIn({ email: "  MARIAM@tissus.test ", password: "faux" }, "203.0.113.201")).status).toBe(429);
      const bystander = await signIn({ email: "yao@quincaillerie.test", password: "mot-de-passe-de-test-harnais" }, "203.0.113.1");
      expect(bystander.status).toBe(200);
    });

    it("mission 15 : des requêtes sans défi Turnstile réussi ne consomment pas la limite du compte visé", async () => {
      const owner = await h.signUp("Koffi Téléphones", "koffi@telephones.test");
      const hostname = new URL(HARNESS_ORIGIN).hostname;
      const siteverify = vi.fn<typeof fetch>(async (_url, init) => {
        const { response: token } = JSON.parse(String(init!.body)) as { response: string };
        return new Response(JSON.stringify(token.startsWith("ok-") ? { success: true, hostname, action: "login" } : { success: false, "error-codes": ["invalid-input-response"] }));
      });
      const protectedAuth = createQadrAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: HARNESS_ORIGIN, isProduction: false,
        turnstile: { secret: "0x4AAAAAAA-secret-essai", siteKey: "0x4AAAAAAA-cle-essai", fetcher: siteverify } });
      const attempt = (password: string, ip: string, token?: string) => protectedAuth.handler(new Request(`${HARNESS_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": ip, ...(token ? { "x-turnstile-token": token } : {}) },
        body: JSON.stringify({ email: owner.email, password }),
      }));
      const statuses: number[] = [];
      for (let index = 0; index < rateRules.signInAccount.limit + 2; index += 1) statuses.push((await attempt("faux", `192.0.2.${index + 1}`)).status);
      expect(statuses.every((status) => status === 400), JSON.stringify(statuses)).toBe(true);
      const real = await attempt("mot-de-passe-de-test-harnais", "192.0.2.100", "ok-login-1");
      expect(real.status).toBe(200);
    });

    it("demande de réinitialisation : trois par heure et par compte, quelle que soit l'adresse", async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/request-password-reset`, {
          method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN, "x-forwarded-for": `198.51.100.${attempt + 1}` },
          body: JSON.stringify({ email: "mariam@tissus.test", redirectTo: "/reset-password" }),
        }));
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 3), JSON.stringify(statuses)).not.toContain(429);
      expect(statuses.slice(3)).toEqual([429, 429]);
    });
  });
});
