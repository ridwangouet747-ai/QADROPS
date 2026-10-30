import { getStockWorkspace } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe(await getStockWorkspace(context.db, context)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
