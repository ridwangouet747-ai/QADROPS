import { createReceivedPurchase, listBusinessPurchases, listBusinessPurchasesPage } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const params = new URL(request.url).searchParams;
    // `?limit=` (ou `cursor`) renvoie une page `{ items, nextCursor }` ; sans ces paramètres, la réponse historique est conservée.
    const data = params.has("limit") || params.has("cursor")
      ? await listBusinessPurchasesPage(context.db, context, Object.fromEntries([...params].filter(([, value]) => value !== "")))
      : { purchases: await listBusinessPurchases(context.db, context) };
    return new Response(jsonSafe(data), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const purchase = await createReceivedPurchase(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe({ purchase }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
