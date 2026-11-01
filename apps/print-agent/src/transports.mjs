import { execFile } from "node:child_process";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/*
 * Adaptateurs de connexion. Chacun reçoit des octets ESC/POS déjà prêts et renvoie
 * { ok: true } ou { ok: false, error, uncertain } — `uncertain` : les octets ont pu partir
 * (coupure en cours d'envoi) ; ne pas réimprimer sans décision humaine.
 */

class TransportError extends Error {
  constructor(code, uncertain = false) { super(code); this.code = code; this.uncertain = uncertain; }
}

/** Imprimante réseau : port brut 9100 (ou autre), délai court, aucune autre adresse que celle configurée. */
export function tcpTransport({ host, port = 9100, timeoutMs = 5000 }) {
  const connect = () => new Promise((resolve, reject) => {
    const socket = new Socket();
    const fail = (code) => { socket.destroy(); reject(new TransportError(code)); };
    socket.setTimeout(timeoutMs, () => fail("timeout"));
    socket.once("error", (error) => fail(error.code === "ECONNREFUSED" ? "connection_refused" : error.code === "EHOSTUNREACH" ? "unreachable" : "communication_error"));
    socket.connect(port, host, () => resolve(socket));
  });
  return {
    kind: "tcp",
    async send(bytes) {
      const socket = await connect();
      await new Promise((resolve, reject) => {
        socket.once("error", () => reject(new TransportError("communication_error", true)));
        socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new TransportError("timeout", true)); });
        socket.end(Buffer.from(bytes), () => resolve());
      });
      socket.destroy();
    },
    /** État temps réel DLE EOT 1/2/4 : seulement si l'imprimante répond ; sinon `null` (inconnu). */
    async status() {
      const socket = await connect();
      const ask = (n) => new Promise((resolve) => {
        const timer = setTimeout(() => { socket.off("data", onData); resolve(undefined); }, 800);
        const onData = (data) => { clearTimeout(timer); socket.off("data", onData); resolve(data[0]); };
        socket.on("data", onData);
        socket.write(Buffer.from([0x10, 0x04, n]));
      });
      try { return { printer: await ask(1), offline: await ask(2), paper: await ask(4) }; } finally { socket.destroy(); }
    },
  };
}

/** Fichier de périphérique : /dev/usb/lp0 (Linux), \\.\COM3 ou LPT1 (Windows). Chemin fixé par la configuration. */
export function deviceTransport({ path }) {
  return {
    kind: "device",
    async send(bytes) {
      try { await writeFile(path, Buffer.from(bytes), { flag: "a" }); }
      catch (error) { throw new TransportError(error.code === "ENOENT" ? "disconnected" : error.code === "EBUSY" ? "busy" : "communication_error"); }
    },
    async status() { return null; },
  };
}

/**
 * Imprimante USB installée sous Windows et partagée (ex. partage « XP58 ») : copie binaire vers
 * \\localhost\<partage>, sans pilote spécifique. Le nom du partage est contrôlé (pas d'injection).
 */
export function windowsShareTransport({ share }) {
  if (!/^[A-Za-z0-9 _.-]{1,64}$/.test(share)) throw new Error("Nom de partage invalide.");
  return {
    kind: "windows_share",
    async send(bytes) {
      if (process.platform !== "win32") throw new TransportError("unsupported_platform");
      const dir = join(tmpdir(), "qadr-print-agent");
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${randomUUID()}.bin`);
      await writeFile(file, Buffer.from(bytes));
      try {
        await new Promise((resolve, reject) => execFile("cmd.exe", ["/d", "/c", "copy", "/b", file, `\\\\localhost\\${share}`], { windowsHide: true, timeout: 15000 },
          (error) => (error ? reject(new TransportError("communication_error", true)) : resolve())));
      } finally { await rm(file, { force: true }); }
    },
    async status() { return null; },
  };
}

/** Imprimante simulée : ajoute les octets à un fichier (tests, démonstration, sans matériel). */
export function simulatedTransport({ file, fail }) {
  return {
    kind: "simulated",
    async send(bytes) {
      if (fail) throw new TransportError(fail, fail === "uncertain");
      await appendFile(file, Buffer.from(bytes));
    },
    async status() { return { printer: 0x16, offline: 0x12, paper: 0x12 }; },
  };
}

export function createTransport(printer) {
  switch (printer.transport) {
    case "tcp": return tcpTransport(printer);
    case "device": return deviceTransport(printer);
    case "windows_share": return windowsShareTransport(printer);
    case "simulated": return simulatedTransport(printer);
    default: throw new Error(`Transport inconnu : ${printer.transport}`);
  }
}
