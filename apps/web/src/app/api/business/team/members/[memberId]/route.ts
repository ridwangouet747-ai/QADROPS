import { getAuth } from "@/lib/auth/server";
import { changeMemberRole } from "@/lib/domain/account";
import { errorResponse, getBusinessContext, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: RouteContext<"/api/business/team/members/[memberId]">) {
  try {
    const context = await getBusinessContext(request.headers);
    const { memberId } = await ctx.params;
    return Response.json(await changeMemberRole(await getAuth(), context.db, request.headers, context, memberId, await parseJsonRequest(request)));
  } catch (error) { return errorResponse(error); }
}
