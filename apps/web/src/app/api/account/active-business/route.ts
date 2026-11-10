import { setActiveBusiness } from "@/lib/domain/account";
import { getAccountContext } from "@/lib/domain/account-context";
import { assertTrustedOrigin, errorResponse, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Change le commerce actif de la session après vérification serveur de l'appartenance. */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request.headers, request.method);
    const context = await getAccountContext(request.headers);
    const body = await parseJsonRequest(request);
    return Response.json(await setActiveBusiness(context.auth, context.db, request.headers, context.userId, body));
  } catch (error) { return errorResponse(error); }
}
