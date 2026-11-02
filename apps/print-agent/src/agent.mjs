import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { createTransport } from "./transports.mjs";

/*
 * Service local d'impression Qadr Ops (mission 10).
 * - N'écoute que sur 127.0.0.1 : jamais exposé au réseau ni à un serveur public.
 * - Origines autorisées seulement (CORS strict), en-tête « Private Network Access » pour Chrome.
 * - Appairage : code à 8 chiffres affiché dans la console, valable 10 minutes, 5 essais ; il donne un
 *   jeton aléatoire (32 octets) dont seule l'empreinte SHA-256 est conservée.
 * - Chaque tâche porte l'identifiant créé par Qadr Ops : une même tâche n'est jamais imprimée deux fois.
 * - Aucune commande arbitraire : le navigateur ne choisit qu'une imprimante configurée et envoie des octets ESC/POS.
 *
 * Mission 11, phase 5 (I-10) :
 * - En-tête `Host` contrôlé : seuls `127.0.0.1`, `localhost` et `[::1]` suivis du port réellement écouté
 *   sont acceptés. Une page piégée qui ferait pointer son propre nom de domaine vers 127.0.0.1 (DNS
 *   rebinding) envoie son nom dans `Host` : elle est refusée avant toute lecture.
 * - Jetons d'appairage à durée limitée (`tokenTtlDays`, 90 jours par défaut, entre 1 et 365). Un jeton
 *   expiré reçoit 401 `pairing_expired` (l'interface demande un nouvel appairage) puis est effacé. Les
 *   appairages créés avant cette version n'avaient pas d'échéance : au premier démarrage, ils en reçoivent
 *   une (date d'appairage + durée, et au moins 30 jours à partir de ce démarrage), annoncée dans la console.
 *   Rien n'est donc coupé sans prévenir.
 */

export const VERSION = "0.2.0";
/** Un ticket en image (arabe) pèse bien plus lourd qu'un ticket texte : 1 Mio d'octets ESC/POS au plus. */
const MAX_TICKET_BYTES = 1024 * 1024;
const MAX_BODY = Math.ceil((MAX_TICKET_BYTES * 4) / 3) + 16 * 1024;
const DAY = 24 * 60 * 60_000;
const LEGACY_GRACE_DAYS = 30;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function createAgent({ config, stateDir, now = () => Date.now(), log = () => undefined }) {
  const statePath = join(stateDir, "agent-state.json");
  let state = { agentId: randomBytes(12).toString("base64url"), pairings: [], jobs: {} };
  try { state = { ...state, ...JSON.parse(await readFile(statePath, "utf8")) }; } catch { /* premier lancement */ }
  const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  const ttlDays = Number.isInteger(config.tokenTtlDays) && config.tokenTtlDays >= 1 && config.tokenTtlDays <= 365 ? config.tokenTtlDays : 90;
  // Appairages antérieurs à la version 0.2.0 : une échéance leur est donnée, jamais une coupure immédiate.
  for (const entry of state.pairings) {
    if (typeof entry.expiresAt === "string") continue;
    const created = Date.parse(entry.createdAt ?? "") || now();
    entry.expiresAt = new Date(Math.max(created + ttlDays * DAY, now() + LEGACY_GRACE_DAYS * DAY)).toISOString();
    log(`Appairage existant avec ${entry.origin} : valable jusqu'au ${entry.expiresAt.slice(0, 10)} (nouvelle règle d'expiration).`);
  }
  await save();

  const printers = new Map((config.printers ?? []).map((printer) => [printer.id, { ...printer, transport_: createTransport(printer) }]));
  const allowedOrigins = new Set(config.allowedOrigins ?? []);
  let pairing = null;
  const newPairingCode = () => {
    pairing = { code: String(randomInt(0, 100_000_000)).padStart(8, "0"), expiresAt: now() + 10 * 60_000, attempts: 0 };
    return pairing.code;
  };

  /** « valid », « expired » (jeton connu mais échu, effacé) ou « invalid ». */
  const tokenState = async (header, origin) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "")?.[1];
    if (!token) return "invalid";
    const digest = Buffer.from(sha256(token), "hex");
    const entry = state.pairings.find((pairingEntry) => pairingEntry.origin === origin && timingSafeEqual(Buffer.from(pairingEntry.tokenHash, "hex"), digest));
    if (!entry) return "invalid";
    if (Date.parse(entry.expiresAt) > now()) return "valid";
    state.pairings = state.pairings.filter((pairingEntry) => pairingEntry !== entry);
    await save();
    log(`Appairage avec ${origin} expiré : un nouveau code est nécessaire.`);
    return "expired";
  };

  /** Hôtes acceptés : adresses de bouclage avec le port réellement écouté (protection contre le DNS rebinding). */
  const hostAllowed = (host, port) => typeof host === "string" && [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...(origin && allowedOrigins.has(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {}) });
      response.end(JSON.stringify(body));
    };
    // Avant tout : le nom demandé doit être celui de cet ordinateur, jamais un domaine qui pointerait ici.
    if (!hostAllowed(request.headers.host, request.socket.localPort)) {
      response.writeHead(421, { "content-type": "application/json", "cache-control": "no-store" });
      return response.end(JSON.stringify({ error: "host_not_allowed" }));
    }
    // Toute requête navigateur porte une origine : elle doit être autorisée.
    if (!origin || !allowedOrigins.has(origin)) return send(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "authorization, content-type", "access-control-allow-private-network": "true", "access-control-max-age": "600" });
      return response.end();
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let body = {};
    if (request.method === "POST") {
      if (!(request.headers["content-type"] ?? "").startsWith("application/json")) return send(415, { error: "json_required" });
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) return send(413, { error: "too_large" }); chunks.push(chunk); }
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(400, { error: "invalid_json" }); }
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const token = await tokenState(request.headers.authorization, origin);
      return send(200, { agent: "qadr-print-agent", version: VERSION, agentId: state.agentId, paired: token === "valid", ...(token === "expired" ? { pairingExpired: true } : {}) });
    }

    if (request.method === "POST" && url.pathname === "/pair") {
      if (!pairing || pairing.expiresAt < now()) return send(410, { error: "pairing_closed" });
      if (pairing.attempts >= 5) return send(429, { error: "too_many_attempts" });
      pairing.attempts += 1;
      const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
      if (code.length !== 8 || !timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code))) return send(401, { error: "wrong_code" });
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now() + ttlDays * DAY).toISOString();
      state.pairings.push({ origin, tokenHash: sha256(token), createdAt: new Date(now()).toISOString(), expiresAt });
      pairing = null; // un code ne sert qu'une fois
      await save();
      log(`Appairé avec ${origin} (jusqu'au ${expiresAt.slice(0, 10)})`);
      return send(200, { agentId: state.agentId, token, expiresAt });
    }

    const token = await tokenState(request.headers.authorization, origin);
    if (token !== "valid") return send(401, { error: token === "expired" ? "pairing_expired" : "not_paired" });

    if (request.method === "GET" && url.pathname === "/printers") {
      return send(200, { printers: [...printers.values()].map((printer) => ({ id: printer.id, name: printer.name, transport: printer.transport, paperWidthMm: printer.paperWidthMm ?? 80, profile: printer.profile ?? "generic" })) });
    }

    const statusMatch = /^\/printers\/([A-Za-z0-9_-]{1,64})\/status$/.exec(url.pathname);
    if (request.method === "GET" && statusMatch) {
      const printer = printers.get(statusMatch[1]);
      if (!printer) return send(404, { error: "unknown_printer" });
      try { return send(200, { reachable: true, status: await printer.transport_.status() }); }
      catch (error) { return send(200, { reachable: false, error: error.code ?? "communication_error" }); }
    }

    if (request.method === "POST" && url.pathname === "/print") {
      const jobId = typeof body.jobId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.jobId) ? body.jobId : null;
      const printer = printers.get(body.printerId);
      if (!jobId || !printer || typeof body.data !== "string") return send(400, { error: "invalid_job" });
      const previous = state.jobs[jobId];
      // Même tâche déjà reçue : on renvoie le premier résultat, sans réimprimer.
      if (previous) return send(200, { ...previous, replayed: true });
      const bytes = Buffer.from(body.data, "base64");
      if (!bytes.length) return send(400, { error: "invalid_job" });
      if (bytes.length > MAX_TICKET_BYTES) return send(413, { error: "too_large" });
      state.jobs[jobId] = { status: "printing", at: new Date(now()).toISOString() };
      let result;
      try { await printer.transport_.send(bytes); result = { status: "printed" }; }
      catch (error) { result = { status: error.uncertain ? "uncertain" : "failed", error: error.code ?? "communication_error" }; }
      state.jobs[jobId] = { ...result, at: new Date(now()).toISOString() };
      const ids = Object.keys(state.jobs);
      if (ids.length > 500) for (const id of ids.slice(0, ids.length - 500)) delete state.jobs[id];
      await save();
      log(`Tâche ${jobId} : ${result.status}${result.error ? ` (${result.error})` : ""}`);
      return send(200, { ...result, replayed: false });
    }
    return send(404, { error: "not_found" });
  });

  return { server, newPairingCode, tokenTtlDays: ttlDays, get agentId() { return state.agentId; }, state: () => state };
}
