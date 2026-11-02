import { archivePrintDevice, updatePrintDevice } from "@/lib/domain/printing";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Profil de l'imprimante : largeur, page de codes, mode d'écriture (texte, image ou automatique). */
export async function PATCH(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    return Response.json(await updatePrintDevice(context.db, context, (await params).deviceId, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    return Response.json(await archivePrintDevice(context.db, context, (await params).deviceId));
  } catch (error) { return errorResponse(error); }
}
