"use client";

/*
 * Liaison navigateur ↔ service local d'impression (apps/print-agent). Le jeton d'appairage ne donne accès
 * qu'au service de CET ordinateur (127.0.0.1) ; il est rangé dans ce navigateur seulement, jamais envoyé
 * à Qadr Ops. Le serveur Qadr Ops prépare le ticket (vente validée) ; ce module le transmet et rapporte
 * le résultat. En cas de doute (réponse perdue), la tâche est « incertaine » : pas de relance automatique.
 */

import { bytesForPrinter, RenderError, type TicketProfile } from "./raster-canvas";
import type { TicketLayout } from "./receipt-ticket";

const storageKey = "qadr-print-pairing";
export type Pairing = { agentUrl: string; agentId: string; token: string; deviceId: string; printerId: string };
export type AgentPrinter = { id: string; name: string; transport: string; paperWidthMm: 58 | 80; profile: string };
export type PrintStatus = "printed" | "failed" | "uncertain";

export function readPairing(): Pairing | null {
  try { const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Pairing | null; return value?.token ? value : null; } catch { return null; }
}
export function savePairing(pairing: Pairing) { try { localStorage.setItem(storageKey, JSON.stringify(pairing)); } catch { /* stockage bloqué : appairage à refaire */ } }
export function forgetPairing() { try { localStorage.removeItem(storageKey); } catch { /* rien */ } }

/** Seule une adresse locale est acceptée : le service ne doit jamais être cherché sur Internet. */
export function normalizeAgentUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

async function agentFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 5000), cache: "no-store" });
}

export async function agentStatus(agentUrl: string, token?: string) {
  try {
    const response = await agentFetch(`${agentUrl}/status`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (response.status === 403) return { reachable: true as const, allowed: false as const };
    const body = await response.json() as { agentId: string; paired: boolean; version: string; pairingExpired?: boolean };
    return { reachable: true as const, allowed: true as const, ...body };
  } catch { return { reachable: false as const }; }
}

export async function pairWithAgent(agentUrl: string, code: string) {
  const response = await agentFetch(`${agentUrl}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  const body = await response.json().catch(() => ({})) as { agentId?: string; token?: string; error?: string };
  if (!response.ok || !body.token || !body.agentId) return { ok: false as const, error: body.error ?? "pairing_failed" };
  return { ok: true as const, agentId: body.agentId, token: body.token };
}

/** Code stable d'un refus 401 du service local : appairage échu (« pairing_expired ») ou absent. */
async function unpairedCode(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error === "pairing_expired" ? "pairing_expired" : "not_paired";
}

export async function listAgentPrinters(agentUrl: string, token: string) {
  const response = await agentFetch(`${agentUrl}/printers`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 401 ? await unpairedCode(response) : "agent_error");
  return ((await response.json()) as { printers: AgentPrinter[] }).printers;
}

export async function agentPrinterStatus(pairing: Pairing) {
  try {
    const response = await agentFetch(`${pairing.agentUrl}/printers/${encodeURIComponent(pairing.printerId)}/status`, { headers: { authorization: `Bearer ${pairing.token}` } });
    return await response.json() as { reachable: boolean; status?: { printer?: number; offline?: number; paper?: number } | null; error?: string };
  } catch { return { reachable: false, error: "agent_unreachable" }; }
}

/** Envoi au service local. Délai dépassé ou coupure pendant l'envoi : résultat incertain. */
export async function sendToAgent(pairing: Pairing, jobId: string, payload: string): Promise<{ status: PrintStatus; error?: string }> {
  let response: Response;
  try {
    response = await agentFetch(`${pairing.agentUrl}/print`, { method: "POST", timeoutMs: 20_000, headers: { "content-type": "application/json", authorization: `Bearer ${pairing.token}` },
      body: JSON.stringify({ jobId, printerId: pairing.printerId, data: payload }) });
  } catch (error) {
    // Service injoignable avant l'envoi : rien n'a pu partir. Délai dépassé : on ne sait pas.
    return (error as Error).name === "TimeoutError" ? { status: "uncertain", error: "timeout" } : { status: "failed", error: "agent_unreachable" };
  }
  const body = await response.json().catch(() => ({})) as { status?: string; error?: string };
  // 401 : jeton inconnu ou échu ; dans les deux cas rien n'est parti vers l'imprimante.
  if (response.status === 401) return { status: "failed", error: body.error === "pairing_expired" ? "pairing_expired" : "not_paired" };
  if (body.status === "printed" || body.status === "failed") return { status: body.status, error: body.error };
  // Requête refusée avant tout envoi à l'imprimante (ticket trop gros, mal formé) : échec certain, pas incertain.
  if (response.status >= 400 && response.status < 500) return { status: "failed", error: body.error ?? "invalid_job" };
  return { status: "uncertain", error: body.error ?? "unknown" };
}

type JobResponse = {
  job: { id: string; status: string; duplicate: boolean };
  deliver: boolean; render: "text" | "raster" | null; layout: TicketLayout | null; profile: TicketProfile | null;
  payload: string | null; preview: string[] | null; unsupportedCharacters: number;
};
export type PrintRequest = { kind: "receipt" | "test"; saleId?: string; reprintOfJobId?: string; language?: "fr" | "en" | "ar"; idempotencyKey?: string };
const errorCode = (value: unknown) => (typeof value === "string" && /^[a-z_]{1,40}$/.test(value) ? value : undefined);

async function reportResult(jobId: string, status: PrintStatus, error?: string) {
  const code = errorCode(error);
  await fetch(`/api/business/printing/jobs/${encodeURIComponent(jobId)}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, ...(code ? { errorCode: code } : {}) }) }).catch(() => undefined);
}

/**
 * Parcours complet : le serveur prépare la tâche (vente validée), le navigateur compose les octets (logo
 * ou ticket en image si besoin), le service local les transmet, le résultat est enregistré. « printed »
 * veut dire transmis sans erreur signalée, pas « vu sorti ». Ne lève jamais d'exception vers la caisse :
 * une panne d'impression ne bloque pas la vente. Les erreurs sont des codes stables, traduits par l'interface.
 */
export async function printThroughAgent(request: PrintRequest) {
  const pairing = readPairing();
  if (!pairing) return { status: "failed" as const, error: "not_paired", preview: null, jobId: null };
  let prepared: JobResponse;
  try {
    const response = await fetch("/api/business/printing/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, deviceId: pairing.deviceId }) });
    const body = await response.json().catch(() => ({})) as JobResponse & { code?: string };
    // 403 sans code : refus de `assertBusinessOperational` (commerce suspendu ou abonnement expiré).
    if (!response.ok) return { status: "failed" as const, error: errorCode(body.code) ?? (response.status === 403 ? "business_blocked" : "server"), preview: null, jobId: null };
    prepared = body;
  } catch { return { status: "failed" as const, error: "network", preview: null, jobId: null }; }
  if (!prepared.deliver || !prepared.layout || !prepared.profile || !prepared.render) {
    return prepared.job.status === "failed" ? { status: "failed" as const, error: "job_final", preview: null, jobId: prepared.job.id }
      : { status: "printed" as const, error: "already_printed", preview: null, jobId: prepared.job.id };
  }
  let payload: string;
  try {
    payload = await bytesForPrinter({ render: prepared.render, layout: prepared.layout, profile: prepared.profile, payload: prepared.payload });
  } catch (error) {
    // Rien n'a été envoyé à l'imprimante : échec certain, la tâche est close et une réimpression reste possible.
    const code = error instanceof RenderError ? error.code : "raster_unavailable";
    await reportResult(prepared.job.id, "failed", code);
    return { status: "failed" as const, error: code, preview: prepared.preview, jobId: prepared.job.id };
  }
  const result = await sendToAgent(pairing, prepared.job.id, payload);
  await reportResult(prepared.job.id, result.status, result.error);
  return { ...result, preview: prepared.preview, jobId: prepared.job.id };
}
