import { archiveBusinessProduct, updateBusinessProduct } from "@/lib/domain/business-data";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: RouteContext<"/api/business/products/[productId]">) {
  try {
    const [{ productId }, context, body] = await Promise.all([ctx.params, getBusinessContext(request.headers), parseJsonRequest(request)]);
    return Response.json(await updateBusinessProduct(context.db, { ...body, ...context, productId }));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/business/products/[productId]">) {
  try {
    const [{ productId }, context] = await Promise.all([ctx.params, getBusinessContext(request.headers)]);
    return Response.json(await archiveBusinessProduct(context.db, { ...context, productId }));
  } catch (error) { return errorResponse(error); }
}
