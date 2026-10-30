import { listInventoryWorkspace, startInventory } from "@/lib/domain/inventory";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const workspace = await listInventoryWorkspace(context.db, context);
    return new Response(jsonSafe(workspace), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const session = await startInventory(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe({ session }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
