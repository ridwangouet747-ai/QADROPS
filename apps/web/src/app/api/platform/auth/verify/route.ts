import { getAuth } from "@/lib/auth/server";
import { isSameOriginRequest, platformAuthMessages as messages, platformRequestClient, responseWithCookies } from "@/lib/auth/platform-request";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import { errorResponse } from "@/lib/domain/business-context";
import { verifyPlatformSecondFactor } from "@/lib/domain/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Étape 2 de la connexion du propriétaire (mission 14) : code de l'application d'authentification
 * (`{ code }`) ou code de secours (`{ backupCode }`). Seule cette route ouvre la session plateforme.
 */
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) return Response.json(messages.origin, { status: 403 });
    const body = await request.json().catch(() => null);
    const { secret, clientKey } = platformRequestClient(request);
    const result = await verifyPlatformSecondFactor(await getAuth(), await getRuntimeDatabase(), { body, headers: request.headers, clientKey, secret });
    if (result.ok) return responseWithCookies({ ok: true }, 200, result.headers);
    if (result.status === 429) {
      return Response.json(messages.throttled, { status: 429, headers: { "retry-after": String(result.retryAfterSeconds ?? 900) } });
    }
    return Response.json(messages.codeRefused, { status: 401 });
  } catch (error) {
    return errorResponse(error);
  }
}
