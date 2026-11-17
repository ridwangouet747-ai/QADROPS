import { describe, expect, it } from "vitest";
import { advisoryId, auditExceptions, blockingAdvisories, type NpmAuditReport } from "./dependency-audit";

const picomatch = { source: 1, name: "picomatch", title: "ReDoS", severity: "high", url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf" };
// Forme réelle de `npm audit --json` : l'alerte sur le paquet, puis les dépendants qui la citent par leur nom.
const report: NpmAuditReport = {
  vulnerabilities: {
    picomatch: { severity: "high", via: [picomatch] },
    "@rollup/plugin-commonjs": { severity: "high", via: ["picomatch", "fdir"] },
    glob: { severity: "moderate", via: [{ source: 2, name: "glob", severity: "moderate", url: "https://github.com/advisories/GHSA-3g3m-2fjr-6pw4" }] },
  },
};
const exception = auditExceptions.find((entry) => entry.id === "GHSA-fc5q-39xc-vjpf")!;

describe("audit des dépendances de production", () => {
  it("lit l'identifiant GHSA dans l'URL de l'alerte", () => {
    expect(advisoryId(picomatch.url)).toBe("GHSA-fc5q-39xc-vjpf");
    expect(advisoryId("https://example.com")).toBeNull();
  });

  it("sans exception, l'alerte high bloque une seule fois ; les dépendants et le moderate ne bloquent pas", () => {
    expect(blockingAdvisories(report, [], new Date("2026-11-17T12:00:00Z"))).toEqual([
      { id: "GHSA-fc5q-39xc-vjpf", packageName: "picomatch", severity: "high", title: "ReDoS" },
    ]);
  });

  it("l'exception datée couvre cette alerte jusqu'à sa date de revue incluse, puis elle bloque de nouveau", () => {
    expect(blockingAdvisories(report, auditExceptions, new Date("2026-11-17T12:00:00Z"))).toEqual([]);
    expect(blockingAdvisories(report, auditExceptions, new Date(`${exception.reviewBy}T23:59:00Z`))).toEqual([]);
    const after = new Date(`${exception.reviewBy}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    expect(blockingAdvisories(report, auditExceptions, after)).toHaveLength(1);
  });

  it("l'exception ne couvre ni une autre alerte du même paquet, ni la même alerte sur un autre paquet", () => {
    const other: NpmAuditReport = { vulnerabilities: {
      picomatch: { severity: "critical", via: [{ ...picomatch, severity: "critical", url: "https://github.com/advisories/GHSA-23cf-ghjm-pqrv" }] },
      minimatch: { severity: "high", via: [{ ...picomatch, name: "minimatch" }] },
    } };
    expect(blockingAdvisories(other, auditExceptions, new Date("2026-11-17T12:00:00Z")).map((a) => `${a.packageName} ${a.id}`).sort())
      .toEqual(["minimatch GHSA-fc5q-39xc-vjpf", "picomatch GHSA-23cf-ghjm-pqrv"]);
  });

  it("chaque exception est justifiée et datée de moins de trois mois", () => {
    for (const entry of auditExceptions) {
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(`${entry.reviewBy}T00:00:00Z`) - Date.parse("2026-11-17T00:00:00Z")).toBeLessThanOrEqual(92 * 86_400_000);
    }
  });
});
