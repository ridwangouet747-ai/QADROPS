import { generateAccessCodes } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    return new Response(jsonSafe(await generateAccessCodes(context.db, context.actorUserId, await parseJsonRequest(request))), { status: 201, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
