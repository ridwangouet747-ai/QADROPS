import { getBusinessSettings, updateBusinessSettings } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe({ settings: await getBusinessSettings(context.db, context) }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const result = await updateBusinessSettings(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe(result), { headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
