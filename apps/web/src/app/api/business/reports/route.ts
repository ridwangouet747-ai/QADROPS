import { getCommercialReport } from "@/lib/domain/reports";
import { errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = new URL(request.url).searchParams;
    const report = await getCommercialReport(context.db, {
      ...context,
      period: query.get("period") ?? "monthly",
      date: query.get("date") ?? undefined,
      startDate: query.get("startDate") ?? undefined,
      endDate: query.get("endDate") ?? undefined,
    });
    return new Response(jsonSafe({ report }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
