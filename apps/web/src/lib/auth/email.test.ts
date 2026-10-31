import { describe, expect, it, vi } from "vitest";
import { createResendTransport, deliverEmail, idempotencyKeyFrom, resolveEmailTransport, type EmailLogEntry, type EmailMessage, type ResendClient, type SendResult } from "./email";

const apiKey = "re_test_cle_secrete_ne_doit_jamais_sortir";
const message: EmailMessage = {
  kind: "password_reset", locale: "fr", to: "awa@qadr.test", subject: "Sujet", html: "<p>html</p>", text: "texte",
  actionUrl: "http://localhost:3000/api/auth/reset-password/jeton-secret-123", idempotencyKey: idempotencyKeyFrom("password-reset", "jeton-secret-123"),
};
const noSleep = () => Promise.resolve();

function capture() {
  const entries: EmailLogEntry[] = [];
  return { entries, logger: (entry: EmailLogEntry) => entries.push(entry) };
}

function fakeClient(responses: Awaited<ReturnType<ResendClient["emails"]["send"]>>[]) {
  const send = vi.fn<ResendClient["emails"]["send"]>(async () => responses.shift() ?? { data: { id: "em_ok" }, error: null, headers: null });
  return { client: { emails: { send } } satisfies ResendClient, send };
}

describe("envoi des e-mails : réessais, idempotence et journal", () => {
  it("journalise un envoi réussi sans destinataire, lien, jeton ni clé", async () => {
    const log = capture();
    const outcome = await deliverEmail({ send: async () => ({ ok: true }) }, message, { logger: log.logger, sleep: noSleep });
    expect(outcome).toEqual({ status: "sent", attempts: 1 });
    expect(log.entries).toEqual([{ event: "email.delivery", kind: "password_reset", status: "sent", attempts: 1 }]);
    const written = JSON.stringify(log.entries);
    for (const secret of ["awa@qadr.test", "jeton-secret-123", message.idempotencyKey, apiKey]) expect(written).not.toContain(secret);
  });

  it("réessaie une limitation de débit avec la même clé d’idempotence", async () => {
    const keys: string[] = [];
    const results: SendResult[] = [{ ok: false, code: "rate_limit_exceeded", retryable: true, retryAfterMs: 1000 }, { ok: true }];
    const sleep = vi.fn(noSleep);
    const outcome = await deliverEmail({ send: async (sent) => { keys.push(sent.idempotencyKey); return results.shift()!; } }, message, { logger: () => undefined, sleep });
    expect(outcome).toEqual({ status: "sent", attempts: 2 });
    expect(new Set(keys).size).toBe(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("n’insiste pas sur une erreur définitive du fournisseur", async () => {
    const send = vi.fn(async (): Promise<SendResult> => ({ ok: false, code: "validation_error", retryable: false }));
    await expect(deliverEmail({ send }, message, { logger: () => undefined, sleep: noSleep })).resolves.toEqual({ status: "failed", attempts: 1, code: "validation_error" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("s’arrête après trois essais si le réseau tombe, sans lever d’exception", async () => {
    const log = capture();
    const send = vi.fn(async (): Promise<SendResult> => { throw new Error(`panne ${apiKey}`); });
    await expect(deliverEmail({ send }, message, { logger: log.logger, sleep: noSleep })).resolves.toEqual({ status: "failed", attempts: 3, code: "network_error" });
    expect(JSON.stringify(log.entries)).not.toContain(apiKey);
  });

  it("dérive une clé d’idempotence stable sans y laisser le jeton", () => {
    expect(idempotencyKeyFrom("password-reset", "abc")).toBe(idempotencyKeyFrom("password-reset", "abc"));
    expect(idempotencyKeyFrom("password-reset", "abc")).not.toBe(idempotencyKeyFrom("password-reset", "abd"));
    expect(idempotencyKeyFrom("password-reset", "jeton-secret-123")).not.toContain("jeton-secret-123");
  });
});

describe("transport Resend", () => {
  it("envoie côté serveur avec expéditeur, réponse, catégorie et clé d’idempotence", async () => {
    const { client, send } = fakeClient([]);
    const transport = createResendTransport({ apiKey, from: "QADR OPS <no-reply@example.test>", replyTo: "support@example.test", client });
    await expect(transport.send(message)).resolves.toEqual({ ok: true, providerId: "em_ok" });
    const [payload, options] = send.mock.calls[0]!;
    expect(payload).toEqual({
      from: "QADR OPS <no-reply@example.test>", to: ["awa@qadr.test"], subject: "Sujet", html: "<p>html</p>", text: "texte",
      replyTo: "support@example.test", tags: [{ name: "category", value: "password_reset" }],
    });
    expect(options).toEqual({ idempotencyKey: message.idempotencyKey });
    expect(JSON.stringify(payload)).not.toContain(apiKey);
  });

  it("classe les erreurs : limitation et panne réessayables, validation définitive", async () => {
    const { client } = fakeClient([
      { data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" }, headers: { "retry-after": "2" } },
      { data: null, error: { name: "internal_server_error", statusCode: 500, message: "boom" }, headers: null },
      { data: null, error: { name: "validation_error", statusCode: 422, message: "Invalid from" }, headers: null },
      { data: null, error: { name: "daily_quota_exceeded", statusCode: 429, message: "quota" }, headers: null },
    ]);
    const transport = createResendTransport({ apiKey, from: "no-reply@example.test", client });
    await expect(transport.send(message)).resolves.toEqual({ ok: false, code: "rate_limit_exceeded", retryable: true, retryAfterMs: 2000 });
    await expect(transport.send(message)).resolves.toEqual({ ok: false, code: "internal_server_error", retryable: true });
    await expect(transport.send(message)).resolves.toEqual({ ok: false, code: "validation_error", retryable: false });
    await expect(transport.send(message)).resolves.toMatchObject({ ok: false, code: "daily_quota_exceeded" });
  });

  it("traite une exception ou une absence de réponse comme une erreur réseau temporaire", async () => {
    const throwing = createResendTransport({ apiKey, from: "no-reply@example.test", client: { emails: { send: async () => { throw new Error("ECONNRESET"); } } } });
    await expect(throwing.send(message)).resolves.toEqual({ ok: false, code: "network_error", retryable: true });
    const hanging = createResendTransport({ apiKey, from: "no-reply@example.test", timeoutMs: 10, client: { emails: { send: () => new Promise(() => undefined) } } });
    await expect(hanging.send(message)).resolves.toEqual({ ok: false, code: "timeout", retryable: true });
  });

  it("n’existe que si la clé et l’expéditeur sont configurés ensemble", () => {
    expect(resolveEmailTransport({ NODE_ENV: "test" })).toBeNull();
    expect(resolveEmailTransport({ NODE_ENV: "test", RESEND_API_KEY: apiKey, RESEND_FROM_EMAIL: "no-reply@example.test" })).not.toBeNull();
    expect(() => resolveEmailTransport({ NODE_ENV: "test", RESEND_API_KEY: apiKey })).toThrow(/RESEND_FROM_EMAIL/);
    expect(() => resolveEmailTransport({ NODE_ENV: "test", RESEND_API_KEY: apiKey })).not.toThrow(new RegExp(apiKey));
  });
});
