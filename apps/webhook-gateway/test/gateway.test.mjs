import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { createGateway, MAX_BODY_BYTES, parseUpstream, WEBHOOK_PATH } from "../src/gateway.mjs";

/** Amont simulé (à la place de Next.js) : garde la méthode, la cible brute, les en-têtes et les octets reçus. */
function fakeUpstream(respond = (res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"received":true}'); }) {
  const received = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => { received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); respond(res); });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, received })));
}

/** Requête HTTP brute : `fetch` normaliserait le chemin (`..`, `//`), ce que l'attaque cherche justement à exploiter. */
function raw(port, { method = "POST", path = WEBHOOK_PATH, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(5_000, () => req.destroy(new Error(`délai dépassé : ${method} ${path}`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

describe("passerelle des webhooks GeniusPay", () => {
  let upstream; let gateway; let port; const logs = [];

  before(async () => {
    upstream = await fakeUpstream();
    gateway = createGateway({ upstream: `http://127.0.0.1:${upstream.port}`, log: (entry) => logs.push(JSON.stringify(entry)) });
    port = await listen(gateway.server);
  });
  after(async () => { await close(gateway.server); await close(upstream.server); });
  beforeEach(() => { upstream.received.length = 0; logs.length = 0; });

  it("relaie POST sur le chemin exact, octets du corps et en-têtes signés inchangés", async () => {
    // Corps volontairement « inhabituel » : espaces, accents, échappements, CRLF final. Un ré-encodage JSON le changerait.
    const body = Buffer.from('{"id":"evt_1",  "event":"payment.success","data":{"reference":"MTX-1","note":"Café \\u00e9 \\/ ☕"}}\r\n', "utf8");
    const timestamp = "1762300000";
    const signature = createHmac("sha256", "whsec_valeur_factice_de_test").update(`${timestamp}.${body.toString("utf8")}`).digest("hex");
    const response = await raw(port, { body, headers: { "content-type": "application/json", "content-length": body.length,
      "x-webhook-signature": signature, "x-webhook-timestamp": timestamp, "x-webhook-event": "payment.success" } });

    assert.equal(response.status, 200);
    assert.equal(response.body, '{"received":true}');
    assert.equal(upstream.received.length, 1);
    const [forwarded] = upstream.received;
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.url, WEBHOOK_PATH);
    assert.ok(forwarded.body.equals(body), "le corps relayé doit être identique octet pour octet");
    assert.equal(forwarded.headers["x-webhook-signature"], signature);
    assert.equal(forwarded.headers["x-webhook-timestamp"], timestamp);
    assert.equal(forwarded.headers["x-webhook-event"], "payment.success");
    assert.equal(forwarded.headers["content-type"], "application/json");
    assert.equal(forwarded.headers["content-length"], String(body.length));
  });

  it("ne relaie ni cookie, ni autorisation, ni en-têtes du tunnel", async () => {
    await raw(port, { body: "{}", headers: { "content-type": "application/json", cookie: "better-auth.session_token=vol", authorization: "Bearer vol",
      "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9", origin: "https://exemple.invalid", "x-qadr-business-id": "autre" } });
    const [forwarded] = upstream.received;
    for (const name of ["cookie", "authorization", "x-forwarded-for", "cf-connecting-ip", "origin", "x-qadr-business-id"]) {
      assert.equal(forwarded.headers[name], undefined, `${name} ne doit pas atteindre Next.js`);
    }
    assert.equal(forwarded.headers.host, `127.0.0.1:${upstream.port}`);
  });

  it("renvoie 404 pour toute autre adresse, sans jamais contacter Next.js", async () => {
    const paths = ["/", "/platform", "/platform/subscriptions", "/business", "/business/subscription", "/login", "/design-system",
      "/api/platform/businesses", "/api/business/subscription/checkout", "/api/cron/subscriptions", "/api/internal/notifications/process",
      "/api/auth/get-session", "/api/webhooks", "/api/webhooks/geniuspay/", "/api/webhooks/geniuspay?x=1", "/api/webhooks/geniuspay#a",
      "/API/webhooks/geniuspay", "/api/webhooks//geniuspay", "//api/webhooks/geniuspay", "/api/webhooks/geniuspay/../../../platform",
      "/api/webhooks/./geniuspay", "/api/webhooks/geniuspay%2F", "/api/webhooks/%67eniuspay", "/api/webhooks/geniuspayx",
      "/api/webhooks/geniuspay.json", "/_next/webpack-hmr", "/sw.js", "http://127.0.0.1:3001/api/webhooks/geniuspay"];
    for (const path of paths) {
      for (const method of ["GET", "POST"]) {
        const response = await raw(port, { method, path, body: method === "POST" ? "{}" : undefined });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(response.body, '{"error":"not_found"}');
      }
    }
    assert.equal(upstream.received.length, 0);
  });

  it("refuse les autres méthodes sur le chemin exact (405, Allow: POST)", async () => {
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await raw(port, { method });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.allow, "POST");
    }
    assert.equal(upstream.received.length, 0);
  });

  it("refuse un corps trop volumineux (déclaré ou envoyé par morceaux) sans le relayer", async () => {
    const big = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
    assert.equal((await raw(port, { body: big, headers: { "content-length": big.length } })).status, 413);
    assert.equal((await raw(port, { body: big, headers: { "transfer-encoding": "chunked" } })).status, 413);
    const limit = Buffer.alloc(MAX_BODY_BYTES, 0x61);
    assert.equal((await raw(port, { body: limit, headers: { "content-length": limit.length } })).status, 200);
    assert.equal(upstream.received.length, 1);
    assert.equal(upstream.received[0].body.length, MAX_BODY_BYTES);
  });

  it("ne journalise ni chemin, ni en-tête, ni corps, ni signature", async () => {
    const signature = "a".repeat(64);
    await raw(port, { body: '{"secret_du_corps":"whsec_ne_doit_pas_sortir"}', headers: { "x-webhook-signature": signature, "x-webhook-timestamp": "1762300000", cookie: "jeton_cookie" } });
    await raw(port, { method: "GET", path: "/platform?jeton=xyz" });
    assert.equal(logs.length, 2);
    for (const line of logs) {
      for (const forbidden of [signature, "whsec_", "secret_du_corps", "jeton", "/platform", "1762300000", WEBHOOK_PATH]) {
        assert.ok(!line.includes(forbidden), `journal : ${forbidden} ne doit pas apparaître`);
      }
    }
    assert.deepEqual(logs.map((line) => JSON.parse(line).outcome), ["transmis", "route_refusee"]);
  });
});

describe("passerelle : amont et limites", () => {
  it("n'accepte qu'un amont HTTP local", () => {
    assert.equal(parseUpstream("http://127.0.0.1:3001").href, `http://127.0.0.1:3001${WEBHOOK_PATH}`);
    assert.equal(parseUpstream("http://localhost:3001/autre").href, `http://localhost:3001${WEBHOOK_PATH}`);
    for (const bad of ["https://127.0.0.1:3001", "http://example.com", "http://10.0.0.5:3001", "http://user:pw@127.0.0.1:3001", "pas une url"]) {
      assert.throws(() => parseUpstream(bad), undefined, bad);
    }
  });

  it("répond 502 si Next.js est arrêté, et relaie tel quel un refus de signature", async () => {
    const down = createGateway({ upstream: "http://127.0.0.1:1", log: () => {} });
    const downPort = await listen(down.server);
    assert.deepEqual(await raw(downPort, { body: "{}" }).then((r) => [r.status, r.body]), [502, '{"error":"upstream_unavailable"}']);
    await close(down.server);

    const refusing = await fakeUpstream((res) => { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"invalid_signature"}'); });
    const relay = createGateway({ upstream: `http://127.0.0.1:${refusing.port}`, log: () => {} });
    const relayPort = await listen(relay.server);
    assert.deepEqual(await raw(relayPort, { body: "{}" }).then((r) => [r.status, r.body]), [401, '{"error":"invalid_signature"}']);
    await close(relay.server); await close(refusing.server);
  });

  it("limite le débit (429) sans contacter Next.js au-delà", async () => {
    let clock = 0;
    const upstream = await fakeUpstream();
    const limited = createGateway({ upstream: `http://127.0.0.1:${upstream.port}`, log: () => {}, rateLimit: { limit: 2, windowMs: 1_000 }, now: () => clock });
    const limitedPort = await listen(limited.server);
    assert.equal((await raw(limitedPort, { body: "{}" })).status, 200);
    assert.equal((await raw(limitedPort, { body: "{}" })).status, 200);
    assert.equal((await raw(limitedPort, { body: "{}" })).status, 429);
    clock = 1_000;
    assert.equal((await raw(limitedPort, { body: "{}" })).status, 200);
    assert.equal(upstream.received.length, 3);
    await close(limited.server); await close(upstream.server);
  });
});
