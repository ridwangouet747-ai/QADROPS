import { guardPublicRequest, noStore } from "@/lib/commercial/public-guard";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { checkInviteCode } from "@/lib/domain/team-codes";
import { rateRules, refundRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * Vérification d'un code d'invitation d'employé (2026-11-16, page /join-business). Ne consomme rien ; rend le nom
 * du commerce et le rôle proposé, rien d'autre. 404 `invalid`, 409 `already_used`, 410 `expired` | `revoked`,
 * 403 `business_closed`, 422 `commercial_code`. Turnstile : action « team-join ».
 */
export async function POST(request: Request) {
  try {
    const guard = await guardPublicRequest(request, "team-join", (ip) => [
      { rule: rateRules.inviteCodeIp, subject: ip },
      { rule: rateRules.inviteCodeGlobal, subject: "all" },
    ]);
    if (guard instanceof Response) return guard;
    const checked = await checkInviteCode(guard.db, (await parseJsonRequest(request)).code);
    await refundRateLimit(guard.db, guard.decisions);
    return new Response(jsonSafe({ valid: true, ...checked }), { headers: { ...noStore, "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
