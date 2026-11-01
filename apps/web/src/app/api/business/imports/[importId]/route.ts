import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getImportBatch, updateImportMapping } from "@/lib/domain/imports";

export const runtime = "nodejs";

type Params = { params: Promise<{ importId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const context = await getBusinessContext(request.headers);
    const { importId } = await params;
    return new Response(jsonSafe(await getImportBatch(context.db, context, importId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** Confirmation des colonnes (et de la ligne de titres). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getBusinessContext(request.headers);
    const { importId } = await params;
    const body = await parseJsonRequest(request);
    return new Response(jsonSafe(await updateImportMapping(context.db, context, { ...body, batchId: importId })), { headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
