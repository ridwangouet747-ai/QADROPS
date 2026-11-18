import { registrationAllowsUsername, registrationPolicy } from "@/lib/auth/registration";
import { getAuth } from "@/lib/auth/server";
import { readAccessPass } from "@/lib/commercial/access-pass";
import { accessCodeRequired } from "@/lib/commercial/mode";
import { guardPublicRequest, noStore } from "@/lib/commercial/public-guard";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { usableCommercialCodeById } from "@/lib/domain/commercial-codes";
import { signInByUsername } from "@/lib/domain/employee-auth";
import { createUsernameAccount } from "@/lib/domain/username-accounts";
import { rateRules } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

// Même refus qu'une inscription par e-mail refusée (liste, code d'accès) : rien n'indique quelle barrière a joué.
const refused = { error: "Impossible de créer le compte.", code: "SIGN_UP_FAILED" };

/**
 * Inscription sans adresse e-mail (mission CTO du 2026-11-17, § 7) : nom, nom d'utilisateur et mot de passe.
 * Mêmes barrières que `/api/auth/sign-up/email` : origine, Turnstile « register », compteur `auth.sign_up.ip`, puis
 * code d'accès commercial vérifié (laissez-passer) quand le mode commercial l'exige, sinon liste d'inscription
 * (registration.ts). 201 `{ created: true, username, recoveryCode }` + cookie de session ; le code de secours
 * n'est rendu qu'ici, une seule fois. 409 `username_taken` ; 422 `SIGN_UP_FAILED` ; 400 validation.
 */
export async function POST(request: Request) {
  try {
    const guard = await guardPublicRequest(request, "register", (ip) => [{ rule: rateRules.signUpIp, subject: ip }]);
    if (guard instanceof Response) return guard;
    const body = await parseJsonRequest(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    // Mode code : le code commercial vérifié (laissez-passer relu en base) est l'autorisation, la liste n'est pas
    // consultée. Sans code exigé : la liste d'inscription (registration.ts).
    let allowed: boolean;
    if (accessCodeRequired()) {
      const codeId = readAccessPass(request.headers);
      allowed = Boolean(codeId && await usableCommercialCodeById(guard.db, codeId));
    } else allowed = registrationAllowsUsername(registrationPolicy(), username);
    if (!allowed) return Response.json(refused, { status: 422, headers: noStore });
    const created = await createUsernameAccount(guard.db, body);
    const headers = new Headers({ ...noStore, "content-type": "application/json" });
    const signedIn = await signInByUsername(await getAuth(), guard.db, { username: created.username, password: body.password });
    if (signedIn.ok) for (const cookie of signedIn.setCookies) headers.append("set-cookie", cookie);
    return new Response(jsonSafe({ created: true, username: created.username, recoveryCode: created.recoveryCode, signedIn: signedIn.ok }), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
