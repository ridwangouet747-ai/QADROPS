import { getAuth } from "@/lib/auth/server";
import { isSameOriginRequest, platformAuthMessages as messages, platformRequestClient, responseWithCookies } from "@/lib/auth/platform-request";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import { errorResponse } from "@/lib/domain/business-context";
import { signInPlatformOwner } from "@/lib/domain/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connexion du propriétaire : nom d'utilisateur et mot de passe. Sans second facteur, la session plateforme
 * est ouverte ici (`step: "done"`) ; avec second facteur, seule une épreuve est ouverte (cookie de défi,
 * `step: "two_factor"`) et `/api/platform/auth/verify` ouvre la session. Voir `platform-auth.ts`.
 */
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) return Response.json(messages.origin, { status: 403 });
    const body = await request.json().catch(() => null);
    const { secret, clientKey } = platformRequestClient(request);
    const result = await signInPlatformOwner(await getAuth(), await getRuntimeDatabase(), { body, headers: request.headers, clientKey, secret });
    if (result.ok) {
      return responseWithCookies(result.step === "done" ? { ok: true, step: "done", defaultPassword: result.defaultPassword } : { ok: true, step: "two_factor" }, 200, result.headers);
    }
    if (result.status === 429) {
      return Response.json(messages.throttled, { status: 429, headers: { "retry-after": String(result.retryAfterSeconds ?? 900) } });
    }
    return Response.json(messages.refused, { status: 401 });
  } catch (error) {
    return errorResponse(error);
  }
}
