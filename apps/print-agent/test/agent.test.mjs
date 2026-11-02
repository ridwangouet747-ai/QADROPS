import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createAgent } from "../src/agent.mjs";

const origin = "http://localhost:3001";
/** Imprimante réseau simulée (port 9100) : reçoit les octets et répond aux demandes d'état DLE EOT. */
function fakeNetworkPrinter({ paperOut = false } = {}) {
  const received = [];
  const server = createServer((socket) => {
    const chunks = [];
    socket.on("data", (data) => {
      if (data.length === 3 && data[0] === 0x10 && data[1] === 0x04) socket.write(Buffer.from([data[2] === 4 && paperOut ? 0x72 : 0x12]));
      else chunks.push(data);
    });
    socket.on("end", () => { if (chunks.length) received.push(Buffer.concat(chunks)); });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, received })));
}

describe("service local d'impression", () => {
  let dir, agent, base, network, simulatedFile, token, code;
  const call = (path, { method = "GET", body, auth = token, from = origin } = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(from ? { origin: from } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "qadr-agent-test-"));
    network = await fakeNetworkPrinter({ paperOut: true });
    simulatedFile = join(dir, "tickets.bin");
    agent = await createAgent({ stateDir: dir, config: { allowedOrigins: [origin], printers: [
      { id: "reseau", name: "Réseau", transport: "tcp", host: "127.0.0.1", port: network.port, timeoutMs: 1500 },
      { id: "demo", name: "Simulée", transport: "simulated", file: simulatedFile },
      { id: "panne", name: "En panne", transport: "simulated", file: simulatedFile, fail: "paper_out" },
      { id: "debranchee", name: "Débranchée", transport: "tcp", host: "127.0.0.1", port: 1, timeoutMs: 800 },
    ] } });
    await new Promise((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${agent.server.address().port}`;
    code = agent.newPairingCode();
  });
  after(async () => { agent.server.close(); network.server.close(); await rm(dir, { recursive: true, force: true }); });

  it("refuse toute origine non autorisée et toute requête sans origine", async () => {
    assert.equal((await call("/status", { from: "https://evil.example" })).status, 403);
    assert.equal((await call("/status", { from: null })).status, 403);
    const preflight = await fetch(`${base}/print`, { method: "OPTIONS", headers: { origin, "access-control-request-private-network": "true" } });
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  });

  it("appairage : mauvais code refusé, bon code accepté une seule fois, jeton exigé ensuite", async () => {
    assert.equal((await call("/printers", { auth: null })).status, 401);
    assert.equal((await call("/pair", { method: "POST", body: { code: "00000000" }, auth: null })).status, code === "00000000" ? 200 : 401);
    const paired = await call("/pair", { method: "POST", body: { code }, auth: null });
    assert.equal(paired.status, 200);
    ({ token } = await paired.json());
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await call("/pair", { method: "POST", body: { code }, auth: null })).status, 410);
    assert.equal((await call("/printers", { auth: "x".repeat(43) })).status, 401);
    const state = JSON.parse(await readFile(join(dir, "agent-state.json"), "utf8"));
    assert.ok(!JSON.stringify(state).includes(token), "le jeton n'est jamais stocké en clair");
    const list = await (await call("/printers")).json();
    assert.deepEqual(list.printers.map((printer) => printer.id), ["reseau", "demo", "panne", "debranchee"]);
  });

  it("limite les essais d'appairage", async () => {
    agent.newPairingCode();
    for (let i = 0; i < 5; i += 1) await call("/pair", { method: "POST", body: { code: "12" }, auth: null });
    assert.equal((await call("/pair", { method: "POST", body: { code: "12" }, auth: null })).status, 429);
  });

  it("imprime sur une imprimante réseau et ne réimprime jamais la même tâche", async () => {
    const data = Buffer.from([0x1b, 0x40, 0x48, 0x69, 0x0a]).toString("base64");
    const first = await (await call("/print", { method: "POST", body: { jobId: "job-aaaaaaaa", printerId: "reseau", data } })).json();
    assert.deepEqual(first, { status: "printed", replayed: false });
    const again = await (await call("/print", { method: "POST", body: { jobId: "job-aaaaaaaa", printerId: "reseau", data } })).json();
    assert.equal(again.replayed, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(network.received.length, 1);
    assert.deepEqual([...network.received[0]], [0x1b, 0x40, 0x48, 0x69, 0x0a]);
  });

  it("remonte l'état matériel quand l'imprimante le communique (papier absent)", async () => {
    const result = await (await call("/printers/reseau/status")).json();
    assert.deepEqual(result, { reachable: true, status: { printer: 0x12, offline: 0x12, paper: 0x72 } });
    const simulated = await (await call("/printers/demo/status")).json();
    assert.equal(simulated.reachable, true);
  });

  it("pannes : imprimante débranchée, panne matérielle ; rien n'est réessayé en silence", async () => {
    const data = Buffer.from("test").toString("base64");
    assert.deepEqual(await (await call("/print", { method: "POST", body: { jobId: "job-bbbbbbbb", printerId: "debranchee", data } })).json(), { status: "failed", error: "connection_refused", replayed: false });
    assert.deepEqual(await (await call("/print", { method: "POST", body: { jobId: "job-cccccccc", printerId: "panne", data } })).json(), { status: "failed", error: "paper_out", replayed: false });
    assert.equal((await (await call("/printers/debranchee/status")).json()).reachable, false);
  });

  it("reconnexion : après redémarrage de l'imprimante réseau, une nouvelle tâche passe", async () => {
    const port = network.port;
    await new Promise((resolve) => network.server.close(resolve));
    const data = Buffer.from("reconnexion").toString("base64");
    assert.equal((await (await call("/print", { method: "POST", body: { jobId: "job-dddddddd", printerId: "reseau", data } })).json()).status, "failed");
    await new Promise((resolve) => network.server.listen(port, "127.0.0.1", resolve));
    assert.equal((await (await call("/print", { method: "POST", body: { jobId: "job-eeeeeeee", printerId: "reseau", data } })).json()).status, "printed");
  });

  it("refuse les requêtes mal formées : imprimante inconnue, données vides, corps non JSON", async () => {
    assert.equal((await call("/print", { method: "POST", body: { jobId: "job-ffffffff", printerId: "inconnue", data: "AA==" } })).status, 400);
    assert.equal((await call("/print", { method: "POST", body: { jobId: "x", printerId: "demo", data: "AA==" } })).status, 400);
    const text = await fetch(`${base}/print`, { method: "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: "rm -rf /" });
    assert.equal(text.status, 415);
    await call("/print", { method: "POST", body: { jobId: "job-gggggggg", printerId: "demo", data: Buffer.from("ok").toString("base64") } });
    assert.equal((await readFile(simulatedFile)).toString(), "ok");
  });
});

/** Requête brute avec un en-tête `Host` choisi (fetch le fixe lui-même et ne permet pas de le changer). */
function rawRequest(port, { host, path = "/status", headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers: { host, origin, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") }));
    });
    request.on("error", reject);
    request.end();
  });
}

describe("service local d'impression : en-tête Host et expiration de l'appairage (mission 11, phase 5)", () => {
  const DAY = 24 * 60 * 60_000;
  let dir, agent, port, clock;
  const call = (path, { method = "GET", body, auth } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { origin, ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const pair = async () => {
    const code = agent.newPairingCode();
    const response = await call("/pair", { method: "POST", body: { code } });
    assert.equal(response.status, 200);
    return response.json();
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "qadr-agent-phase5-"));
    clock = Date.parse("2026-11-01T08:00:00Z");
    agent = await createAgent({ stateDir: dir, now: () => clock, config: { tokenTtlDays: 30, allowedOrigins: [origin], printers: [
      { id: "demo", name: "Simulée", transport: "simulated", file: join(dir, "tickets.bin") },
    ] } });
    await new Promise((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
    port = agent.server.address().port;
  });
  after(async () => { agent.server.close(); await rm(dir, { recursive: true, force: true }); });

  it("refuse un nom d'hôte étranger (DNS rebinding) avant toute autre vérification", async () => {
    for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`, `localhost.evil.example:${port}`]) {
      const response = await rawRequest(port, { host });
      assert.equal(response.status, 421, host);
      assert.deepEqual(response.body, { error: "host_not_allowed" });
    }
  });

  it("accepte 127.0.0.1, localhost et [::1] avec le port écouté", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
      assert.equal((await rawRequest(port, { host })).status, 200, host);
    }
  });

  it("un appairage expire après tokenTtlDays : 401 pairing_expired, puis jeton oublié", async () => {
    const { token, expiresAt } = await pair();
    assert.equal(expiresAt, new Date(clock + 30 * DAY).toISOString());
    assert.equal((await call("/printers", { auth: token })).status, 200);
    clock += 29 * DAY;
    assert.equal((await call("/printers", { auth: token })).status, 200, "encore valable la veille de l'échéance");
    clock += 2 * DAY;
    const expired = await call("/print", { method: "POST", auth: token, body: { jobId: "job-expire01", printerId: "demo", data: "AA==" } });
    assert.equal(expired.status, 401);
    assert.deepEqual(await expired.json(), { error: "pairing_expired" });
    const again = await call("/printers", { auth: token });
    assert.deepEqual([again.status, await again.json()], [401, { error: "not_paired" }]);
    const status = await (await call("/status", { auth: token })).json();
    assert.equal(status.paired, false);
  });

  it("/status signale l'expiration pour que l'interface demande un nouveau code", async () => {
    const { token } = await pair();
    clock += 31 * DAY;
    const status = await (await call("/status", { auth: token })).json();
    assert.equal(status.paired, false);
    assert.equal(status.pairingExpired, true);
  });

  it("refuse un ticket de plus de 1 Mio", async () => {
    const { token } = await pair();
    const data = Buffer.alloc(1024 * 1024 + 1, 0x41).toString("base64");
    const response = await call("/print", { method: "POST", auth: token, body: { jobId: "job-tropgros", printerId: "demo", data } });
    assert.equal(response.status, 413);
  });
});

describe("service local d'impression : appairages créés avant la version 0.2.0", () => {
  it("reçoivent une échéance avec au moins 30 jours de délai, sans coupure immédiate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qadr-agent-legacy-"));
    try {
      const token = "a".repeat(43);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const now = Date.parse("2026-11-01T08:00:00Z");
      // Appairage vieux d'un an : la durée de 90 jours est déjà dépassée, le délai de grâce s'applique.
      await writeFile(join(dir, "agent-state.json"), JSON.stringify({ agentId: "ancien", jobs: {}, pairings: [
        { origin, tokenHash, createdAt: "2025-11-01T08:00:00.000Z" },
      ] }));
      const lines = [];
      const agent = await createAgent({ stateDir: dir, now: () => now, log: (line) => lines.push(line), config: { allowedOrigins: [origin], printers: [] } });
      const saved = JSON.parse(await readFile(join(dir, "agent-state.json"), "utf8"));
      assert.equal(saved.pairings[0].expiresAt, new Date(now + 30 * 24 * 60 * 60_000).toISOString());
      assert.ok(lines.some((line) => line.includes("2026-12-01")), "l'échéance est annoncée dans la console");
      await new Promise((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
      const response = await fetch(`http://127.0.0.1:${agent.server.address().port}/printers`, { headers: { origin, authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      agent.server.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
