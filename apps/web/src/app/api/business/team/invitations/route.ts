import { getAuth } from "@/lib/auth/server";
import { inviteMember } from "@/lib/domain/account";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const body = await parseJsonRequest(request);
    return new Response(jsonSafe({ invitation: await inviteMember(await getAuth(), context.db, request.headers, context, body) }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
