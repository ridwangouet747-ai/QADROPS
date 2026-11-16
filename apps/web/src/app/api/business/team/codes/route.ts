import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { createInviteCode, listInviteCodes } from "@/lib/domain/team-codes";

export const runtime = "nodejs";

const privateJson = { "content-type": "application/json", "cache-control": "private, no-store" };

/** Codes d'invitation des employés du commerce de la session (2026-11-16, docs/team-invite-codes.md). */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe(await listInviteCodes(context.db, context)), { headers: privateJson });
  } catch (error) { return errorResponse(error); }
}

/** Création : la réponse est la seule à contenir le code en clair. */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe(await createInviteCode(context.db, context, await parseJsonRequest(request))), { status: 201, headers: privateJson });
  } catch (error) { return errorResponse(error); }
}
