import { AsyncLocalStorage } from "node:async_hooks";
import { signPass, verifyPass } from "@/lib/security/access-codes";

/**
 * Laissez-passer d'activation (2026-11-16) : après la vérification d'un code commercial sur /redeem-code, le
 * serveur pose un cookie HttpOnly signé qui désigne CE code (son identifiant, jamais le code lui-même) pendant
 * deux heures. Il permet de créer le compte puis le commerce sans ressaisir le code. Le cookie seul n'accorde rien :
 * à chaque étape, le code est relu en base (ni utilisé, ni révoqué, ni expiré) et il n'est consommé que dans la
 * transaction qui crée l'abonnement. Si la création du compte ou du commerce échoue, le code reste intact.
 */
export const ACCESS_PASS_TTL_MS = 2 * 60 * 60_000;

function secureCookies(source: Record<string, string | undefined> = process.env) {
  return (source.BETTER_AUTH_URL ?? "").startsWith("https://");
}

export function accessPassCookieName(source?: Record<string, string | undefined>) {
  return secureCookies(source) ? "__Host-qadr-access-pass" : "qadr-access-pass";
}

type PassPayload = { v: 1; c: string; e: number };

export function accessPassCookie(codeId: string, now = new Date(), source?: Record<string, string | undefined>) {
  const token = signPass({ v: 1, c: codeId, e: now.getTime() + ACCESS_PASS_TTL_MS } satisfies PassPayload, source);
  const secure = secureCookies(source) ? "; Secure" : "";
  return `${accessPassCookieName(source)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ACCESS_PASS_TTL_MS / 1000)}${secure}`;
}

export function clearAccessPassCookie(source?: Record<string, string | undefined>) {
  const secure = secureCookies(source) ? "; Secure" : "";
  return `${accessPassCookieName(source)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** Identifiant du code désigné par le cookie de la requête, s'il est authentique et non périmé. */
export function readAccessPass(headers: Headers, now = new Date(), source?: Record<string, string | undefined>): string | null {
  const name = accessPassCookieName(source);
  const raw = headers.get("cookie") ?? "";
  const token = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  const payload = verifyPass<PassPayload>(token, source);
  if (!payload || payload.v !== 1 || typeof payload.c !== "string" || typeof payload.e !== "number") return null;
  return payload.e > now.getTime() ? payload.c : null;
}

/**
 * Transmet le code désigné par le laissez-passer à la création du commerce (`afterCreateOrganization`), qui
 * l'active dans sa propre transaction et y range le résultat.
 */
export type AccessActivationOutcome =
  | { status: "activated"; endsAt: string; replayed: boolean }
  | { status: "failed"; code: string };
export type AccessActivationScope = { codeId: string; outcome?: AccessActivationOutcome };
export const accessActivationScope = new AsyncLocalStorage<AccessActivationScope>();
