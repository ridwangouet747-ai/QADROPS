import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import { authDurations, createQadrAuth } from "@/lib/auth/server";
import { HARNESS_ORIGIN, startHttpHarness, type HttpHarness } from "./http-harness";

vi.mock("@/lib/db/client", () => import("@/test/harness-database"));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

/*
 * Mission 18 : cookies de session et durée de vie, vérifiés sur les vraies réponses de Better Auth.
 * - en développement (harnais) : HttpOnly, SameSite=Lax, Path=/ ;
 * - en production (`isProduction: true`, URL en HTTPS) : en plus Secure et préfixe `__Secure-` ;
 * - expiration de la session en base : 7 jours (authDurations), révocation à la déconnexion.
 */

const PASSWORD = "mot-de-passe-cookies-2026";

function sessionCookie(response: Response) {
  const cookies = response.headers.getSetCookie();
  const token = cookies.find((cookie) => /session_token=/.test(cookie));
  expect(token, cookies.join(" | ")).toBeDefined();
  return token!;
}

describe("cookies de session et durée de vie", () => {
  let h: HttpHarness;
  beforeAll(async () => { h = await startHttpHarness(); });
  afterAll(async () => { await h?.close(); });

  it("développement : cookie HttpOnly, SameSite=Lax, Path=/, sans attribut Domain", async () => {
    const response = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: HARNESS_ORIGIN },
      body: JSON.stringify({ name: "Cookie Dev", email: "cookie-dev@qadr.test", password: PASSWORD }),
    }));
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    // Pas de Domain : le cookie n'est jamais envoyé à un sous-domaine frère.
    expect(cookie).not.toMatch(/;\s*Domain=/i);
    // Le corps de la réponse ne renvoie jamais le mot de passe ni son empreinte.
    expect(await response.text()).not.toMatch(new RegExp(`${PASSWORD}|scrypt|"password"`));
  });

  it("production : cookie Secure avec le préfixe __Secure-, HttpOnly et SameSite=Lax", async () => {
    const baseURL = "https://app.qadr-ops.test";
    // En production, l'inscription exige Turnstile : Siteverify est remplacé par une réponse valide (aucun appel réseau).
    const fetcher = (async () => Response.json({ success: true, hostname: "app.qadr-ops.test", action: "register" })) as unknown as typeof fetch;
    const auth = createQadrAuth({ db: h.db, secret: "secret-de-test-cookies-production-0000000000", baseURL, isProduction: true,
      turnstile: { secret: "cle-secrete-siteverify-de-test", siteKey: "cle-de-site-de-test", fetcher } });
    const request = (token?: string) => new Request(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: baseURL, ...(token ? { "x-turnstile-token": token } : {}) },
      body: JSON.stringify({ name: "Cookie Prod", email: "cookie-prod@qadr.test", password: PASSWORD }),
    });
    // Sans jeton Turnstile, la production refuse l'inscription et ne pose aucun cookie.
    const refused = await auth.handler(request());
    expect(refused.status).toBe(400);
    expect(refused.headers.getSetCookie().some((cookie) => /session_token=/.test(cookie))).toBe(false);
    const response = await auth.handler(request("jeton-turnstile-valide"));
    expect(response.status, await response.clone().text()).toBe(200);
    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/^__Secure-/);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
  });

  it("la session expire après 7 jours et la déconnexion la révoque côté serveur", async () => {
    const actor = await h.signUp("Session Durée", "session-duree@qadr.test");
    const [row] = (await h.client.query<{ expires_at: Date; created_at: Date }>(
      "select s.expires_at, s.created_at from session s where s.user_id = $1 order by s.created_at desc limit 1", [actor.userId])).rows;
    const lifetime = (new Date(row!.expires_at).getTime() - new Date(row!.created_at).getTime()) / 1000;
    expect(Math.abs(lifetime - authDurations.sessionSeconds)).toBeLessThan(60);

    const session = () => authRoute.GET(new Request(`${HARNESS_ORIGIN}/api/auth/get-session`, { headers: { cookie: actor.cookie, origin: HARNESS_ORIGIN } }));
    expect(await (await session()).json()).toMatchObject({ user: { id: actor.userId } });
    const signOut = await authRoute.POST(new Request(`${HARNESS_ORIGIN}/api/auth/sign-out`, {
      method: "POST", headers: { cookie: actor.cookie, origin: HARNESS_ORIGIN, "content-type": "application/json" }, body: "{}",
    }));
    expect(signOut.status).toBe(200);
    // Le même cookie, rejoué après la déconnexion, n'ouvre plus rien : la session est supprimée en base.
    expect(await (await session()).json()).toBeNull();
    const remaining = await h.client.query("select 1 from session where user_id = $1", [actor.userId]);
    expect(remaining.rows).toHaveLength(0);
  });
});
