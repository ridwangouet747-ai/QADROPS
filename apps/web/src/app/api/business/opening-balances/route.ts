import { createOpeningBalance, listOpeningBalances } from "@/lib/domain/opening";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Clients (`?party=customer`) ou fournisseurs (`?party=supplier`) avec leur éventuel solde d'ouverture. */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const partyType = new URL(request.url).searchParams.get("party");
    return new Response(jsonSafe(await listOpeningBalances(context.db, context, { partyType })), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    const result = await createOpeningBalance(context.db, { ...body, businessId: context.businessId, actorUserId: context.userId });
    return new Response(jsonSafe({ balance: result }), { status: result.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
