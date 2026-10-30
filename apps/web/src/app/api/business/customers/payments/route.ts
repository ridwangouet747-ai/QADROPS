import { recordCustomerPayment } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const result = await recordCustomerPayment(context.db, { ...(await parseJsonRequest(request)), ...context });
    return new Response(jsonSafe(result), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
