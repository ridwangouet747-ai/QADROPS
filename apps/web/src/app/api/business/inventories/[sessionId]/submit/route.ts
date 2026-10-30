import { submitInventory } from "@/lib/domain/inventory";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { sessionId } = await params;
    const result = await submitInventory(context.db, { ...context, sessionId });
    return new Response(jsonSafe({ result }), { headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
