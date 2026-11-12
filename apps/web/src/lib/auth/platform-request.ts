import { clientIpFrom } from "./client-ip-headers";
import { readEnvironment } from "@/lib/env";
import { platformClientKey } from "@/lib/domain/platform-auth";

/**
 * Éléments communs aux routes de connexion du propriétaire (`/api/platform/auth/*`, missions 13 et 14).
 */

/** Requête venue d'une page de l'application elle-même (connexion forcée depuis un autre site refusée). */
export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin, new URL(readEnvironment().BETTER_AUTH_URL).origin]);
  if (process.env.BETTER_AUTH_URL) allowed.add(new URL(process.env.BETTER_AUTH_URL).origin);
  return allowed.has(origin);
}

/** Secret des empreintes (limitation, audit). Aperçu local seulement : valeur de développement. */
export function platformRequestSecret() {
  return process.env.BETTER_AUTH_SECRET || "qadr-preview-only-secret-never-in-production-000";
}

export function platformRequestClient(request: Request) {
  const secret = platformRequestSecret();
  return { secret, clientKey: platformClientKey(clientIpFrom(request.headers), secret) };
}

export const platformAuthMessages = {
  refused: { error: "Nom d’utilisateur ou mot de passe incorrect.", code: "invalid_credentials" },
  codeRefused: { error: "Code incorrect ou expiré. Reconnectez-vous si le délai est dépassé.", code: "invalid_second_factor" },
  throttled: { error: "Trop de tentatives. Patientez quelques minutes avant de réessayer.", code: "too_many_attempts" },
  origin: { error: "Origine refusée.", code: "invalid_origin" },
} as const;

/** Copie les cookies posés par Better Auth (session ou défi du second facteur) sur la réponse. */
export function responseWithCookies(body: unknown, status: number, from: Headers) {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of from.getSetCookie()) headers.append("set-cookie", cookie);
  return Response.json(body, { status, headers });
}
