import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";
import { discardImportBatch } from "@/lib/domain/imports";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ importId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { importId } = await params;
    return new Response(jsonSafe({ result: await discardImportBatch(context.db, context, importId) }), { headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
