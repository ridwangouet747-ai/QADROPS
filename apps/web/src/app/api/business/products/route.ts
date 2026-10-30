import { createProduct } from "@/lib/domain/commercial";
import { listBusinessProducts } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const data = await listBusinessProducts(context.db, context);
    return new Response(jsonSafe(data), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    const product = await createProduct(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
    return new Response(jsonSafe({ product }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) {
    return errorResponse(error);
  }
}
