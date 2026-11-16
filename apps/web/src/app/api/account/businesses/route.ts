import { clearAccessPassCookie } from "@/lib/commercial/access-pass";
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
    const business = await createBusiness(context.auth, request.headers, body, context.db);
    const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
    // Code consommé : le laissez-passer n'a plus d'usage (2026-11-16, commercial/access-pass.ts).
    if (business.access?.status === "activated") headers.append("set-cookie", clearAccessPassCookie());
    return new Response(jsonSafe({ business }), { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}
