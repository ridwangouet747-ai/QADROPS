import { getAuth } from "@/lib/auth/server";
import { isSameOriginRequest, platformAuthMessages as messages, platformRequestClient, responseWithCookies } from "@/lib/auth/platform-request";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import { errorResponse } from "@/lib/domain/business-context";
import { signInPlatformOwner } from "@/lib/domain/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Étape 1 de la connexion du propriétaire : nom d'utilisateur et mot de passe. En cas de succès, seule
 * une épreuve de second facteur est ouverte (cookie de défi), jamais une session. Voir `platform-auth.ts`.
 */
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) return Response.json(messages.origin, { status: 403 });
    const body = await request.json().catch(() => null);
    const { secret, clientKey } = platformRequestClient(request);
    const result = await signInPlatformOwner(await getAuth(), await getRuntimeDatabase(), { body, headers: request.headers, clientKey, secret });
    if (result.ok) return responseWithCookies({ ok: true, step: "two_factor" }, 200, result.headers);
    if (result.status === 429) {
      return Response.json(messages.throttled, { status: 429, headers: { "retry-after": String(result.retryAfterSeconds ?? 900) } });
    }
    if (result.status === 403) return Response.json(messages.setupRequired, { status: 403 });
    return Response.json(messages.refused, { status: 401 });
  } catch (error) {
    return errorResponse(error);
  }
}
