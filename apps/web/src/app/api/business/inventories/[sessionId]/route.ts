import { getInventorySession } from "@/lib/domain/inventory";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { sessionId } = await params;
    const session = await getInventorySession(context.db, { ...context, sessionId });
    return new Response(jsonSafe({ session }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
