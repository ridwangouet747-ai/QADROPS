import { listStockMovementsPage } from "@/lib/domain/catalog-pages";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Historique paginé des mouvements de stock (curseur date + identifiant, filtres facultatifs). */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([, value]) => value !== ""));
    return new Response(jsonSafe(await listStockMovementsPage(context.db, context, params)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
