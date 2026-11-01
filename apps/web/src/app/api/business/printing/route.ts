import { getPrinterSetup, updatePrinterSettings } from "@/lib/domain/printing";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

const headers = { "content-type": "application/json", "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try { const context = await getBusinessContext(request.headers); return new Response(jsonSafe(await getPrinterSetup(context.db, context)), { headers }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try { const context = await getBusinessContext(request.headers); return new Response(jsonSafe(await updatePrinterSettings(context.db, context, await parseJsonRequest(request))), { headers }); }
  catch (error) { return errorResponse(error); }
}
