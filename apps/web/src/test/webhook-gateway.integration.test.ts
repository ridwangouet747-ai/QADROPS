import type { PGlite } from "@electric-sql/pglite";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as checkoutRoute from "@/app/api/business/subscription/checkout/route";
import * as webhookRoute from "@/app/api/webhooks/geniuspay/route";
import { getPreviewDatabase } from "@/lib/preview/database";
import { createGateway, WEBHOOK_PATH } from "../../../webhook-gateway/src/gateway.mjs";
import { FAKE_GENIUSPAY_ENV, FakeGeniusPay, signedWebhook } from "./fake-geniuspay";

/**
 * Chaîne complète de l'essai sandbox, sans réseau public : passerelle (`apps/webhook-gateway`) → vraie route
 * Next.js du webhook → base de démonstration de l'aperçu. Seul GeniusPay est simulé. Montre que la signature
 * reste vérifiée par le code existant et que la passerelle ne change ni le corps ni les en-têtes signés.
 */
describe("passerelle → route webhook réelle (aperçu local)", () => {
  const fake = new FakeGeniusPay();
  let upstream: Server;
  let gateway: Server;
  let port = 0;
  const routeCalls: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("QADR_PREVIEW_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://qadr:faux@neon.invalid/qadr");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    for (const [name, value] of Object.entries(FAKE_GENIUSPAY_ENV)) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", fake.fetch);

    // « Next.js » : un serveur local qui remet la requête reçue, octets compris, au gestionnaire de la vraie route.
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        routeCalls.push(`${req.method} ${req.url}`);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
        const response = await webhookRoute.POST(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: Buffer.concat(chunks) }));
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(await response.text());
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    gateway = createGateway({ upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, log: () => {} }).server;
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    port = (gateway.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((resolve) => gateway?.close(resolve));
    await new Promise((resolve) => upstream?.close(resolve));
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const send = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method: init.method ?? "POST", headers: init.headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(init.body);
    });
  const viaGateway = (signed: { body: string; headers: Record<string, string> }) => send(WEBHOOK_PATH, signed);
  const query = async <T,>(text: string, params: unknown[] = []) =>
    (await (await getPreviewDatabase() as unknown as { $client: PGlite }).$client.query<T>(text, params)).rows;

  it("événement signé relayé : 200 et enregistré ; sans signature ou corps modifié : 401 de la route", async () => {
    const signed = signedWebhook("webhook.test", "TEST-PASSERELLE", { eventId: "evt_passerelle_test" });
    expect(await viaGateway(signed)).toEqual({ status: 200, body: '{"received":true}' });
    expect(await query("select outcome from payment_provider_event where event_id=$1", ["evt_passerelle_test"])).toEqual([{ outcome: "ignored" }]);

    expect(await send(WEBHOOK_PATH, { body: signed.body, headers: { "content-type": "application/json" } }))
      .toEqual({ status: 401, body: '{"error":"invalid_signature"}' });
    expect(await viaGateway({ body: signed.body.replace("TEST-PASSERELLE", "TEST-PASSERELLX"), headers: signed.headers }))
      .toEqual({ status: 401, body: '{"error":"invalid_signature"}' });
  }, 60_000);

  it("paiement : activation unique via la passerelle, rejeu sans seconde prolongation", async () => {
    const opened = await checkoutRoute.POST(new Request("http://localhost:3001/api/business/subscription/checkout", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planCode: "PRO", idempotencyKey: "passerelle-0001" }),
    }));
    const { attemptId } = await opened.json() as { attemptId: string };
    expect(opened.status).toBe(201);
    const [attempt] = await query<{ provider_reference: string; business_id: string }>("select provider_reference,business_id from subscription_payment where id=$1", [attemptId]);
    fake.set(attempt!.provider_reference, { status: "completed", payment_method: "wave" });
    const periods = () => query<{ id: string; ends_at: Date }>("select id,ends_at from business_subscription where business_id=$1 order by created_at", [attempt!.business_id]);

    const success = signedWebhook("payment.success", attempt!.provider_reference, { eventId: "evt_passerelle_succes" });
    expect(await viaGateway(success)).toEqual({ status: 200, body: '{"received":true}' });
    expect(await query("select status from subscription_payment where id=$1", [attemptId])).toEqual([{ status: "confirmed" }]);
    const once = await periods();

    expect(await viaGateway(success)).toEqual({ status: 200, body: '{"received":true,"duplicate":true}' });
    expect((await viaGateway(signedWebhook("payment.success", attempt!.provider_reference, { eventId: "evt_passerelle_succes_bis" }))).status).toBe(200);
    expect(await periods()).toEqual(once);
    expect(await query("select i.status from subscription_invoice i join subscription_payment p on p.invoice_id=i.id where p.id=$1", [attemptId])).toEqual([{ status: "paid" }]);
  }, 60_000);

  it("le reste de l'application n'est jamais atteint par la passerelle", async () => {
    const before = routeCalls.length;
    for (const path of ["/", "/platform", "/business/subscription", "/api/platform/businesses", "/api/business/subscription/checkout", `${WEBHOOK_PATH}/`, `${WEBHOOK_PATH}?a=1`]) {
      expect((await send(path, { method: "GET" })).status, path).toBe(404);
      expect((await send(path, { body: "{}" })).status, path).toBe(404);
    }
    expect((await send(WEBHOOK_PATH, { method: "GET" })).status).toBe(405);
    expect(routeCalls.length).toBe(before);
  });
});
