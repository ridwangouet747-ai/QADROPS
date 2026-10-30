import { createSale } from "@/lib/domain/commercial";
import { listBusinessSales } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = new URL(request.url).searchParams;
    const sales = await listBusinessSales(context.db, context, { from: query.get("from") ?? undefined, to: query.get("to") ?? undefined });
    return new Response(jsonSafe({ sales }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    const sale = await createSale(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
    return new Response(jsonSafe({ sale }), { status: sale.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) {
    return errorResponse(error);
  }
}
