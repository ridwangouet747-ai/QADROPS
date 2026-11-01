import { addPrintDevice } from "@/lib/domain/printing";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return Response.json(await addPrintDevice(context.db, context, await parseJsonRequest(request)), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
