#!/usr/bin/env node
import { createGateway, WEBHOOK_PATH } from "./gateway.mjs";

/* Lancement : node src/cli.mjs [--port 8790] [--upstream http://127.0.0.1:3001] */
function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(option("port", "8790"));
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("Port invalide.");
  process.exit(1);
}
let gateway;
try { gateway = createGateway({ upstream: option("upstream", "http://127.0.0.1:3001") }); }
catch (error) { console.error(error instanceof Error ? error.message : "Configuration invalide."); process.exit(1); }

gateway.server.listen(port, "127.0.0.1", () => {
  console.log("Qadr Ops — passerelle des webhooks GeniusPay");
  console.log(`Écoute sur http://127.0.0.1:${port} (cet ordinateur uniquement)`);
  console.log(`Seule route relayée : POST ${WEBHOOK_PATH} → ${gateway.target.href}`);
  console.log("Tout le reste : 404. Aucun en-tête ni corps n'est journalisé.");
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => gateway.server.close(() => process.exit(0)));
