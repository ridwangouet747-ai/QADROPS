import { archivePrintDevice } from "@/lib/domain/printing";
import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    return Response.json(await archivePrintDevice(context.db, context, (await params).deviceId));
  } catch (error) { return errorResponse(error); }
}
