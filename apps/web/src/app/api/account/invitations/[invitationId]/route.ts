import { currentInvitationPolicy } from "@/lib/auth/server";
import { acceptInvitation, getInvitationForUser } from "@/lib/domain/account";
import { getAccountContext } from "@/lib/domain/account-context";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: RouteContext<"/api/account/invitations/[invitationId]">) {
  try {
    const context = await getAccountContext(request.headers);
    const { invitationId } = await ctx.params;
    return new Response(jsonSafe({ invitation: await getInvitationForUser(context.db, invitationId, context.email, { required: currentInvitationPolicy().requiresVerifiedEmail, emailVerified: context.emailVerified }) }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, ctx: RouteContext<"/api/account/invitations/[invitationId]">) {
  try {
    const context = await getAccountContext(request.headers);
    const { invitationId } = await ctx.params;
    return Response.json(await acceptInvitation(context.auth, request.headers, invitationId));
  } catch (error) { return errorResponse(error); }
}
