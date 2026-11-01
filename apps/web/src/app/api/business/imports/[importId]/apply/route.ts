import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { applyImportBatch } from "@/lib/domain/imports";

export const runtime = "nodejs";

/** Application confirmée par le commerçant ; `idempotencyKey` fournie par le client (rejouable sans doublon). */
export async function POST(request: Request, { params }: { params: Promise<{ importId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { importId } = await params;
    const body = await parseJsonRequest(request);
    return new Response(jsonSafe({ result: await applyImportBatch(context.db, context, { ...body, batchId: importId }) }), { headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
