import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { updateImportRow } from "@/lib/domain/imports";

export const runtime = "nodejs";

/** Correction d'une ligne ou décision (créer, rattacher, ignorer, revenir à la proposition). */
export async function PATCH(request: Request, { params }: { params: Promise<{ importId: string; rowId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { importId, rowId } = await params;
    const body = await parseJsonRequest(request);
    return new Response(jsonSafe(await updateImportRow(context.db, context, { ...body, batchId: importId, rowId })), { headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
