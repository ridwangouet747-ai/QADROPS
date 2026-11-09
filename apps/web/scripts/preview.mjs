import { spawn } from "node:child_process";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "production") {
  console.error("QADR OPS local preview cannot start with NODE_ENV=production.");
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: "development", QADR_PREVIEW_MODE: "true" };
delete env.DATABASE_URL;

const port = env.PORT || "3001";
const nextCli = resolve("node_modules/next/dist/bin/next");
// Par défaut `next dev` écoute sur toutes les interfaces (réseau local compris). Pendant un essai par tunnel,
// QADR_PREVIEW_HOSTNAME=127.0.0.1 limite l'aperçu à ce poste.
const hostname = env.QADR_PREVIEW_HOSTNAME?.trim();
const args = [nextCli, "dev", "--webpack", "--port", port, ...(hostname ? ["--hostname", hostname] : [])];
const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 1));
