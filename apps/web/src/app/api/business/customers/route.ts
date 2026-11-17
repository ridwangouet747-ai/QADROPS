import { createBusinessCustomer, listBusinessCustomers, listBusinessCustomersPage } from "@/lib/domain/business-data";
import { createCustomerWithOpeningBalance } from "@/lib/domain/opening";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const params = new URL(request.url).searchParams;
    // `?limit=` (ou `cursor`) renvoie une page `{ items, nextCursor }` ; sans ces paramètres, la réponse historique est conservée.
    const data = params.has("limit") || params.has("cursor")
      ? await listBusinessCustomersPage(context.db, context, Object.fromEntries([...params].filter(([, value]) => value !== "")))
      : { customers: await listBusinessCustomers(context.db, context) };
    return new Response(jsonSafe(data), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/**
 * Crée un client. Avec `openingBalance: { amountXof, asOfDate, note? }` et `idempotencyKey`, la fiche et sa dette
 * de départ sont écrites ensemble (une seule transaction idempotente) : jamais une vente à crédit.
 */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    if (body.openingBalance !== undefined && body.openingBalance !== null) {
      const result = await createCustomerWithOpeningBalance(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
      const payload = { customer: { id: result.customerId }, openingBalance: { id: result.openingBalanceId, amountXof: result.amountXof, remainingXof: result.remainingXof }, replayed: result.replayed };
      return new Response(jsonSafe(payload), { status: result.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
    }
    const customer = await createBusinessCustomer(context.db, { ...body, ...context });
    return new Response(jsonSafe({ customer }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
