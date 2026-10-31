import { listOpeningCandidates, postStockOpening } from "@/lib/domain/opening";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Produits encore éligibles au stock d'ouverture (aucun mouvement, stock à zéro), paginés. */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([, value]) => value !== ""));
    return new Response(jsonSafe(await listOpeningCandidates(context.db, context, params)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    const result = await postStockOpening(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
    return new Response(jsonSafe({ opening: result }), { status: result.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
