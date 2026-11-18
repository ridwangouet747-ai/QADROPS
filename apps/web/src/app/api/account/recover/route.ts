import { guardPublicRequest, noStore } from "@/lib/commercial/public-guard";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { recoverWithCode } from "@/lib/domain/username-accounts";
import { rateRules, refundRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const refused = { error: "Nom d’utilisateur ou code de secours incorrect.", code: "invalid_recovery" };

/**
 * Mot de passe oublié sans e-mail (mission CTO du 2026-11-17, § 7) : nom d'utilisateur + code de secours + nouveau
 * mot de passe. Turnstile « password-reset », limites par adresse IP et par nom d'utilisateur (comptées après
 * Turnstile, rendues en cas de succès). Toute erreur sur le compte ou le code donne le même 401. Succès : 200
 * `{ recovered: true, recoveryCode }` (nouveau code, montré une fois), toutes les sessions fermées, aucune ouverte.
 */
export async function POST(request: Request) {
  try {
    const body = await parseJsonRequest(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
    const guard = await guardPublicRequest(request, "password-reset", (ip) => [
      { rule: rateRules.recoveryCodeIp, subject: ip },
      { rule: rateRules.recoveryCodeAccount, subject: username || "-" },
    ]);
    if (guard instanceof Response) return guard;
    const result = await recoverWithCode(guard.db, body);
    if (!result.ok) return Response.json(refused, { status: 401, headers: noStore });
    await refundRateLimit(guard.db, guard.decisions);
    return new Response(jsonSafe({ recovered: true, recoveryCode: result.recoveryCode }), { status: 200, headers: { ...noStore, "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
