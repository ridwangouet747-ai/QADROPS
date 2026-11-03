import { createSale } from "@/lib/domain/commercial";
import { listBusinessSales, listBusinessSalesPage } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

import { processNotificationsAfterResponse } from "@/lib/notifications/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = new URL(request.url).searchParams;
    // `?limit=` (ou `cursor`) renvoie (avec les mêmes filtres from/to) une page `{ items, nextCursor }` ; sans ces paramètres, la réponse historique est conservée.
    const data = query.has("limit") || query.has("cursor")
      ? await listBusinessSalesPage(context.db, context, Object.fromEntries([...query].filter(([, value]) => value !== "")))
      : { sales: await listBusinessSales(context.db, context, { from: query.get("from") ?? undefined, to: query.get("to") ?? undefined }) };
    return new Response(jsonSafe(data), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    const sale = await createSale(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
    // La vente est déjà enregistrée : les notifications partent après la réponse, sans la retarder.
    if (!sale.replayed) processNotificationsAfterResponse(context.db);
    return new Response(jsonSafe({ sale }), { status: sale.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) {
    return errorResponse(error);
  }
}
