import { recordOpeningBalancePayment } from "@/lib/domain/opening";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request, ctx: RouteContext<"/api/business/opening-balances/[balanceId]/payments">) {
  try {
    const context = await getBusinessContext(request.headers);
    const { balanceId } = await ctx.params;
    const body = await parseJsonRequest(request);
    const result = await recordOpeningBalancePayment(context.db, { ...body, openingBalanceId: balanceId, businessId: context.businessId, actorUserId: context.userId });
    return new Response(jsonSafe({ payment: result }), { status: result.replayed ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
