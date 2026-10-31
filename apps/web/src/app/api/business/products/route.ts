import { createProduct } from "@/lib/domain/commercial";
import { listBusinessProducts } from "@/lib/domain/business-data";
import { listProductsPage } from "@/lib/domain/catalog-pages";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const params = new URL(request.url).searchParams;
    // `?limit=` (ou `cursor`) active la pagination serveur ; sans paramètre, la liste complète reste
    // servie aux écrans qui en dépendent encore (caisse, achats).
    const data = params.has("limit") || params.has("cursor")
      ? await listProductsPage(context.db, context, Object.fromEntries([...params].filter(([, value]) => value !== "")))
      : await listBusinessProducts(context.db, context);
    return new Response(jsonSafe(data), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    const product = await createProduct(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
    return new Response(jsonSafe({ product }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) {
    return errorResponse(error);
  }
}
