import { getAuth } from "@/lib/auth/server";
import { clientIpFrom } from "@/lib/auth/client-ip-headers";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import { errorResponse } from "@/lib/domain/business-context";
import { platformClientKey, signInPlatformOwner } from "@/lib/domain/platform-auth";
import { readEnvironment } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Même message pour un nom inconnu, un mauvais mot de passe ou un compte sans droit. */
const refused = { error: "Nom d’utilisateur ou mot de passe incorrect.", code: "invalid_credentials" };
const throttled = { error: "Trop de tentatives. Patientez quelques minutes avant de réessayer.", code: "too_many_attempts" };

/** Requête venue d'une page de l'application elle-même (connexion forcée depuis un autre site refusée). */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin, new URL(readEnvironment().BETTER_AUTH_URL).origin]);
  if (process.env.BETTER_AUTH_URL) allowed.add(new URL(process.env.BETTER_AUTH_URL).origin);
  return allowed.has(origin);
}

/** Connexion du propriétaire de la plateforme (nom d'utilisateur et mot de passe). Voir `platform-auth.ts`. */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Origine refusée.", code: "invalid_origin" }, { status: 403 });
    const body = await request.json().catch(() => null);
    const secret = process.env.BETTER_AUTH_SECRET || "qadr-preview-only-secret-never-in-production-000";
    const result = await signInPlatformOwner(await getAuth(), await getRuntimeDatabase(), {
      body, headers: request.headers, clientKey: platformClientKey(clientIpFrom(request.headers), secret),
    });
    if (!result.ok) {
      return Response.json(result.status === 429 ? throttled : refused, {
        status: result.status, headers: result.status === 429 ? { "retry-after": "900" } : undefined,
      });
    }
    const headers = new Headers({ "cache-control": "no-store" });
    for (const cookie of result.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return Response.json({ ok: true }, { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
