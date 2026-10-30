import { createCategory, listBusinessProducts } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const data = await listBusinessProducts(context.db, context);
    return new Response(jsonSafe({ categories: data.categories }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const category = await createCategory(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe({ category }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
