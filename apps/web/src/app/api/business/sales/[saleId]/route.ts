import { getBusinessSale } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: RouteContext<"/api/business/sales/[saleId]">) {
  try {
    const [{ saleId }, context] = await Promise.all([ctx.params, getBusinessContext(request.headers)]);
    const sale = await getBusinessSale(context.db, { ...context, saleId });
    return new Response(jsonSafe({ sale }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
