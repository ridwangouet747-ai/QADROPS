import { listPlatformAudit } from "@/lib/domain/platform";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const params = new URL(request.url).searchParams;
    const value = (name: string) => params.get(name) || undefined;
    const filters = { search: value("q"), action: value("action"), businessId: value("business"), actorUserId: value("actor"), from: value("from"), to: value("to"), before: value("before"), limit: params.get("limit") ? Number(params.get("limit")) : undefined };
    return new Response(jsonSafe(await listPlatformAudit(context.db, context.actorUserId, filters)), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
