import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { revokeCommercialAccessCode } from "@/lib/domain/commercial-codes";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const runtime = "nodejs";

/** Révocation d'un code encore inutilisé (motif obligatoire, trace d'audit). Un code utilisé ne se révoque pas. */
export async function POST(request: Request, { params }: { params: Promise<{ codeId: string }> }) {
  try {
    const context = await getPlatformContext(request.headers);
    const { codeId } = await params;
    return new Response(jsonSafe(await revokeCommercialAccessCode(context.db, context.actorUserId, codeId, await parseJsonRequest(request))), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
