import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const live = { secret: "0x4AAAAAAA-vraie-cle-secrete", siteKey: "0x4AAAAAAA-vraie-cle-publique", isProduction: true, expectedHostname: "app.example.test", expectedAction: "login" as const };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetcherReturning = (...responses: (Response | Error)[]) => vi.fn<typeof fetch>(async () => {
  const next = responses.shift()!;
  if (next instanceof Error) throw next;
  return next;
});

describe("verifyTurnstile", () => {
  it("laisse le développement local fonctionner si Turnstile est absent", async () => {
    await expect(verifyTurnstile(undefined, { secret: undefined, siteKey: undefined, isProduction: false }))
      .resolves.toEqual({ ok: true });
  });

  it("refuse de fonctionner en production sans clé secrète", async () => {
    await expect(verifyTurnstile("token", { secret: undefined, siteKey: undefined, isProduction: true }))
      .resolves.toEqual({ ok: false, reason: "not_configured" });
    await expect(verifyTurnstile("token", { secret: undefined, siteKey: live.siteKey, isProduction: false }))
      .resolves.toEqual({ ok: false, reason: "not_configured" });
  });

  it("refuse un formulaire sans jeton sans appeler Cloudflare", async () => {
    const fetcher = fetcherReturning();
    await expect(verifyTurnstile(undefined, { ...live, fetcher })).resolves.toEqual({ ok: false, reason: "missing" });
    await expect(verifyTurnstile("x".repeat(2049), { ...live, fetcher })).resolves.toEqual({ ok: false, reason: "missing" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepte un jeton valide pour le bon domaine et la bonne action, vérifié par Siteverify", async () => {
    const fetcher = fetcherReturning(reply({ success: true, hostname: "app.example.test", action: "login", "error-codes": [] }));
    await expect(verifyTurnstile("jeton-valide", { ...live, remoteIp: "203.0.113.7", fetcher })).resolves.toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(JSON.parse(String(init!.body))).toMatchObject({ secret: live.secret, response: "jeton-valide", remoteip: "203.0.113.7" });
  });

  it("refuse un jeton invalide", async () => {
    const fetcher = fetcherReturning(reply({ success: false, "error-codes": ["invalid-input-response"] }));
    await expect(verifyTurnstile("faux", { ...live, fetcher })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("refuse un jeton expiré ou déjà utilisé", async () => {
    const fetcher = fetcherReturning(reply({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    await expect(verifyTurnstile("deja-servi", { ...live, fetcher })).resolves.toEqual({ ok: false, reason: "expired_or_used" });
  });

  it("refuse un jeton obtenu sur un autre site ou pour une autre action", async () => {
    await expect(verifyTurnstile("t", { ...live, fetcher: fetcherReturning(reply({ success: true, hostname: "phishing.example", action: "login" })) }))
      .resolves.toEqual({ ok: false, reason: "mismatch" });
    await expect(verifyTurnstile("t", { ...live, fetcher: fetcherReturning(reply({ success: true, hostname: "app.example.test", action: "register" })) }))
      .resolves.toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuse en cas de panne de Cloudflare, après un second essai avec la même clé d’idempotence", async () => {
    const fetcher = fetcherReturning(new Error("ECONNRESET"), reply({}, 503));
    await expect(verifyTurnstile("t", { ...live, fetcher })).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const keys = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).idempotency_key);
    expect(keys[0]).toBe(keys[1]);
  });

  it("se rétablit si le second essai réussit", async () => {
    const fetcher = fetcherReturning(reply({}, 502), reply({ success: true, hostname: "app.example.test", action: "login" }));
    await expect(verifyTurnstile("t", { ...live, fetcher })).resolves.toEqual({ ok: true });
  });

  it("parcours local avec les clés de test officielles (réponse factice localhost / test)", async () => {
    const fetcher = fetcherReturning(reply({ success: true, hostname: "localhost", action: "test", "error-codes": [] }));
    await expect(verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", {
      secret: "1x0000000000000000000000000000000AA", siteKey: "1x00000000000000000000AA", isProduction: false,
      expectedHostname: "localhost", expectedAction: "register", fetcher,
    })).resolves.toEqual({ ok: true });
  });

  it("refuse les clés de test en production, sans contournement possible", async () => {
    const fetcher = fetcherReturning(reply({ success: true }));
    await expect(verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", { secret: "1x0000000000000000000000000000000AA", siteKey: "1x00000000000000000000AA", isProduction: true, fetcher }))
      .resolves.toEqual({ ok: false, reason: "test_key_in_production" });
    await expect(verifyTurnstile("t", { secret: live.secret, siteKey: "1x00000000000000000000AA", isProduction: true, fetcher }))
      .resolves.toEqual({ ok: false, reason: "test_key_in_production" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
