import { createBusinessSupplier, listBusinessSuppliers } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe({ suppliers: await listBusinessSuppliers(context.db, context) }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const supplier = await createBusinessSupplier(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe({ supplier }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
