import { createBusiness } from "@/lib/domain/account";
import { getAccountContext } from "@/lib/domain/account-context";
import { assertTrustedOrigin, errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Mission 16 : création d'un commerce seulement depuis une page de l'application (Origin, puis Sec-Fetch-Site).
    assertTrustedOrigin(request.headers, request.method);
    const context = await getAccountContext(request.headers);
    const body = await parseJsonRequest(request);
    return new Response(jsonSafe({ business: await createBusiness(context.auth, request.headers, body, context.db) }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
