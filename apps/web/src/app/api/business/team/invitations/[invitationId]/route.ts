import { getAuth } from "@/lib/auth/server";
import { cancelInvitation } from "@/lib/domain/account";
import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function DELETE(request: Request, ctx: RouteContext<"/api/business/team/invitations/[invitationId]">) {
  try {
    const context = await getBusinessContext(request.headers);
    const { invitationId } = await ctx.params;
    return Response.json(await cancelInvitation(await getAuth(), context.db, request.headers, context, invitationId));
  } catch (error) { return errorResponse(error); }
}
