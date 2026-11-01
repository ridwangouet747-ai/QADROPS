import { validateCashSession } from "@/lib/domain/cash-session";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { sessionId } = await params;
    const result = await validateCashSession(context.db, { ...(await parseJsonRequest(request)), ...context, sessionId });
    return new Response(jsonSafe({ session: result }), { status: result.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
