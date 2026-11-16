import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";
import { revokeInviteCode } from "@/lib/domain/team-codes";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ codeId: string }> }) {
  try {
    const context = await getBusinessContext(request.headers);
    const { codeId } = await params;
    return new Response(jsonSafe(await revokeInviteCode(context.db, context, codeId)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
