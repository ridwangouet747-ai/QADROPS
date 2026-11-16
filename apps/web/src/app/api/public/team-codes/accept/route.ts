import { getAuth } from "@/lib/auth/server";
import { guardPublicRequest, noStore } from "@/lib/commercial/public-guard";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { signInByUsername } from "@/lib/domain/employee-auth";
import { acceptInviteCode } from "@/lib/domain/team-codes";
import { rateRules, refundRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * L'employé rejoint le commerce (2026-11-16, page /join-business) : code d'invitation, nom, nom d'utilisateur et
 * mot de passe personnel. Compte, appartenance (rôle fixé par le code) et consommation du code dans une seule
 * transaction (`acceptInviteCode`), puis ouverture de la session sur ce commerce. Aucune adresse e-mail.
 * 201 `{ joined: true, businessId, role }` + cookie de session ; 409 `username_taken` | `already_used` ;
 * 410 `expired` | `revoked` ; 403 `business_closed` | `plan_limit` ; 404 `invalid` ; 422 `commercial_code`.
 */
export async function POST(request: Request) {
  try {
    const guard = await guardPublicRequest(request, "team-join", (ip) => [
      { rule: rateRules.inviteCodeIp, subject: ip },
      { rule: rateRules.inviteCodeGlobal, subject: "all" },
    ]);
    if (guard instanceof Response) return guard;
    const body = await parseJsonRequest(request);
    const joined = await acceptInviteCode(guard.db, body);
    await refundRateLimit(guard.db, guard.decisions);
    const headers = new Headers({ ...noStore, "content-type": "application/json" });
    const signedIn = await signInByUsername(await getAuth(), guard.db, { username: joined.username, password: body.password }, joined.businessId);
    if (signedIn.ok) for (const cookie of signedIn.setCookies) headers.append("set-cookie", cookie);
    return new Response(jsonSafe({ joined: true, businessId: joined.businessId, role: joined.role, username: joined.username, signedIn: signedIn.ok }), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
