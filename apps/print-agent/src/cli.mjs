#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createAgent, VERSION } from "./agent.mjs";

/* Lancement : node src/cli.mjs [chemin/vers/config.json]. Par défaut : ./agent-config.json */
const configPath = resolve(process.argv[2] ?? "agent-config.json");
let config;
try { config = JSON.parse(await readFile(configPath, "utf8")); }
catch { console.error(`Configuration introuvable ou illisible : ${configPath}\nCopiez config.example.json en agent-config.json et adaptez-le.`); process.exit(1); }
const port = Number(config.port ?? 17777);
const stateDir = resolve(config.stateDir ?? join(homedir(), ".qadr-print-agent"));
await mkdir(stateDir, { recursive: true, mode: 0o700 });

const agent = await createAgent({ config, stateDir, log: (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`) });
agent.server.listen(port, "127.0.0.1", () => {
  console.log(`Qadr Ops — service d'impression ${VERSION}`);
  console.log(`Écoute sur http://127.0.0.1:${port} (cet ordinateur uniquement)`);
  console.log(`Origines autorisées : ${(config.allowedOrigins ?? []).join(", ") || "aucune"}`);
  console.log(`Imprimantes : ${(config.printers ?? []).map((printer) => `${printer.id} (${printer.transport})`).join(", ") || "aucune"}`);
  console.log(`\nCode d'appairage (10 minutes) : ${agent.newPairingCode()}\n`);
});
