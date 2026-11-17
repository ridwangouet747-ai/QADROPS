/*
 * CI : audit des dépendances de production (`npm run audit:prod`). Échoue sur toute alerte high/critical qui n'est
 * pas une exception datée de src/lib/security/dependency-audit.ts.
 */
import { spawnSync } from "node:child_process";
import { auditExceptions, blockingAdvisories, type NpmAuditReport } from "../src/lib/security/dependency-audit";

// Commande fixe, sans argument venu de l’extérieur : le shell sert seulement à trouver npm sous Windows.
const run = spawnSync("npm audit --omit=dev --json", { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
let report: NpmAuditReport;
try {
  report = JSON.parse(run.stdout) as NpmAuditReport;
} catch (error) {
  console.error("Audit illisible : npm audit n'a pas renvoyé de JSON.", run.stderr);
  throw error;
}
if (!report.vulnerabilities) {
  console.error("Audit illisible : champ « vulnerabilities » absent.", run.stderr);
  process.exit(1);
}

const now = new Date();
const blocking = blockingAdvisories(report, auditExceptions, now);
const day = now.toISOString().slice(0, 10);
for (const exception of auditExceptions) {
  const state = day <= exception.reviewBy ? `valable jusqu'au ${exception.reviewBy}` : `EXPIRÉE le ${exception.reviewBy}`;
  console.log(`Exception ${exception.id} (${exception.packageName}) : ${state}.`);
}
if (blocking.length) {
  for (const advisory of blocking) console.error(`Bloquant : ${advisory.severity} ${advisory.packageName} ${advisory.id} ${advisory.title}`);
  process.exit(1);
}
console.log("Aucune alerte high ou critical non couverte dans les dépendances de production.");
