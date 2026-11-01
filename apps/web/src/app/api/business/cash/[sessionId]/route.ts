import { getCashSessionDetail } from "@/lib/domain/cash-session";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { sessionId } = await params;
    return new Response(jsonSafe(await getCashSessionDetail(context.db, { ...context, sessionId })), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
