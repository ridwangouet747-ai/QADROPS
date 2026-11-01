import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
