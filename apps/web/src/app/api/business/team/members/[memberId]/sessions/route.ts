import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";
import { revokeMemberSessions } from "@/lib/domain/team-codes";

export const runtime = "nodejs";

/** Ferme les sessions d'un employé (2026-11-16) ; trace d'audit `team.sessions_revoked`. */
export async function DELETE(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { memberId } = await params;
    return new Response(jsonSafe(await revokeMemberSessions(context.db, context, memberId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
