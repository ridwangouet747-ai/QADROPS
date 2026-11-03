import { getStockWorkspace, listStockItemsPage } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const params = new URL(request.url).searchParams;
    // `?limit=` (ou `cursor`) renvoie une page des niveaux de stock `{ items, nextCursor }` (les mouvements ont leur
    // propre liste paginée) ; sans ces paramètres, la réponse historique `{ items, movements }` est conservée.
    const data = params.has("limit") || params.has("cursor")
      ? await listStockItemsPage(context.db, context, Object.fromEntries([...params].filter(([, value]) => value !== "")))
      : await getStockWorkspace(context.db, context);
    return new Response(jsonSafe(data), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
