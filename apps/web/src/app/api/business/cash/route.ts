import { getCashOverview, openCashSession } from "@/lib/domain/cash-session";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Caisse du membre connecté et clôtures visibles (les siennes, ou toutes avec le droit cash:audit). */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const limit = new URL(request.url).searchParams.get("limit") ?? undefined;
    return new Response(jsonSafe(await getCashOverview(context.db, context, { limit })), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** Ouverture de sa propre caisse ; le commerce et la personne viennent toujours de la session. */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const session = await openCashSession(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe({ session }), { status: session.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
