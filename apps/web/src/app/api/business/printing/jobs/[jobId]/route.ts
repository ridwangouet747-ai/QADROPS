import { reportPrintResult } from "@/lib/domain/printing";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    return Response.json(await reportPrintResult(context.db, context, (await params).jobId, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
