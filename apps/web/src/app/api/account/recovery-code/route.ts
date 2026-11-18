import { platformRequestSecret } from "@/lib/auth/platform-request";
import { noStore } from "@/lib/commercial/public-guard";
import { getAccountContext } from "@/lib/domain/account-context";
import { assertTrustedOrigin, errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { hasRecoveryCode, renewRecoveryCode } from "@/lib/domain/username-accounts";
import { consumeRateLimits, rateRules } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Le compte connecté a-t-il un code de secours ? Le code lui-même n'est jamais relu (seule son empreinte existe). */
export async function GET(request: Request) {
  try {
    const context = await getAccountContext(request.headers);
    return Response.json({ present: await hasRecoveryCode(context.db, context.userId), hasEmail: context.email !== null }, { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

/**
 * Nouveau code de secours pour le compte connecté (code perdu ou vu par quelqu'un) : mot de passe actuel exigé,
 * compteur du changement de mot de passe. 200 `{ recoveryCode }` montré une fois ; 403 `invalid_password` ; 429.
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request.headers, request.method);
    const context = await getAccountContext(request.headers);
    const body = await parseJsonRequest(request);
    const limits = await consumeRateLimits(context.db, [{ rule: rateRules.passwordChangeAccount, subject: context.userId }], platformRequestSecret());
    if (!limits.allowed) {
      return Response.json({ error: "Trop d’essais. Patientez quelques minutes avant de réessayer.", code: "rate_limited" },
        { status: 429, headers: { ...noStore, "retry-after": String(limits.retryAfterSeconds) } });
    }
    const renewed = await renewRecoveryCode(context.db, context.userId, body.currentPassword);
    return new Response(jsonSafe(renewed), { status: 200, headers: { ...noStore, "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
