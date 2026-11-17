/*
 * Contrôle des dépendances de production en CI (`npm run audit:prod`, appelé par .github/workflows/ci.yml).
 *
 * Règle : toute alerte « high » ou « critical » bloque, sauf une exception listée ci-dessous, nommée par son
 * identifiant GHSA et son paquet, justifiée, et datée : passé `reviewBy`, elle bloque de nouveau. Une exception ne
 * couvre jamais une autre alerte du même paquet. N'en ajoutez une qu'avec l'accord du propriétaire, quand aucune
 * version corrigée n'existe ou que le code vulnérable n'est pas atteignable en production.
 */

export type AuditException = {
  id: string;
  packageName: string;
  reason: string;
  /** Date (AAAA-MM-JJ, UTC) jusqu'à laquelle l'exception vaut ; le lendemain, l'alerte bloque de nouveau. */
  reviewBy: string;
};

export const auditExceptions: readonly AuditException[] = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    packageName: "picomatch",
    reason:
      "ReDoS sur un motif glob fourni par l'appelant ; aucune version corrigée publiée (<= 4.0.7, dernière version). " +
      "Présent par @sentry/nextjs (outillage de build) et vitest (via better-auth) : aucun motif venant d'un visiteur " +
      "n'atteint picomatch en production. Accord du propriétaire le 2026-11-17.",
    reviewBy: "2026-12-17",
  },
];

type Via = string | { source?: number; name?: string; title?: string; url?: string; severity?: string };
export type NpmAuditReport = { vulnerabilities?: Record<string, { severity?: string; via?: Via[] }> };
export type BlockingAdvisory = { id: string; packageName: string; severity: string; title: string };

const blockingSeverities = new Set(["high", "critical"]);

/** Identifiant GHSA d'une alerte npm, lu dans son URL (https://github.com/advisories/GHSA-…). */
export function advisoryId(url: string | undefined) {
  return url?.match(/GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}/)?.[0] ?? null;
}

/**
 * Alertes qui doivent faire échouer la CI. Seules les alertes elles-mêmes sont examinées : un paquet marqué
 * « high » parce qu'il dépend d'un paquet vulnérable est couvert par l'alerte de ce dernier.
 */
export function blockingAdvisories(report: NpmAuditReport, exceptions: readonly AuditException[], today: Date): BlockingAdvisory[] {
  const day = today.toISOString().slice(0, 10);
  const found = new Map<string, BlockingAdvisory>();
  for (const [packageName, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via === "string") continue;
      const severity = via.severity ?? entry.severity ?? "unknown";
      if (!blockingSeverities.has(severity)) continue;
      const name = via.name ?? packageName;
      const id = advisoryId(via.url) ?? `${name}:${via.source ?? via.title ?? "inconnu"}`;
      const excused = exceptions.some((exception) => exception.id === id && exception.packageName === name && day <= exception.reviewBy);
      if (!excused) found.set(`${id}|${name}`, { id, packageName: name, severity, title: via.title ?? "" });
    }
  }
  return [...found.values()];
}
