import { setMemberAccess } from "@/lib/domain/account";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request, ctx: RouteContext<"/api/business/team/members/[memberId]/access">) {
  try {
    const context = await getBusinessContext(request.headers);
    const { memberId } = await ctx.params;
    return Response.json(await setMemberAccess(context.db, context, memberId, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
