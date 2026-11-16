import { getAuth } from "@/lib/auth/server";
import { guardPublicRequest, noStore } from "@/lib/commercial/public-guard";
import { errorResponse, parseJsonRequest } from "@/lib/domain/business-context";
import { signInByUsername } from "@/lib/domain/employee-auth";
import { rateRules, refundRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const refused = { error: "Nom d’utilisateur ou mot de passe incorrect.", code: "invalid_credentials" };

/**
 * Connexion d'un employé par nom d'utilisateur (2026-11-16). Turnstile « login », limites par adresse IP et par
 * nom d'utilisateur (comptées après Turnstile, rendues en cas de succès). Le propriétaire de la plateforme reçoit
 * le même refus qu'un mauvais mot de passe : sa console a sa propre connexion (/platform/login).
 */
export async function POST(request: Request) {
  try {
    const body = await parseJsonRequest(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
    const guard = await guardPublicRequest(request, "login", (ip) => [
      { rule: rateRules.usernameSignInIp, subject: ip },
      { rule: rateRules.usernameSignInAccount, subject: username || "-" },
    ]);
    if (guard instanceof Response) return guard;
    const signedIn = await signInByUsername(await getAuth(), guard.db, { username: body.username, password: body.password });
    if (!signedIn.ok) return Response.json(refused, { status: 401, headers: noStore });
    await refundRateLimit(guard.db, guard.decisions);
    const headers = new Headers({ ...noStore, "content-type": "application/json" });
    for (const cookie of signedIn.setCookies) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) { return errorResponse(error); }
}
