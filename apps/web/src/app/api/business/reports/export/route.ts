import { getCommercialReport, reportCsv } from "@/lib/domain/reports";
import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = new URL(request.url).searchParams;
    if (query.get("format") !== "csv") return Response.json({ error: "Format d’export non pris en charge." }, { status: 400 });
    const report = await getCommercialReport(context.db, {
      ...context,
      period: query.get("period") ?? "monthly",
      date: query.get("date") ?? undefined,
      startDate: query.get("startDate") ?? undefined,
      endDate: query.get("endDate") ?? undefined,
    });
    return new Response(reportCsv(report), { headers: {
      "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="qadr-ops-rapport-${report.startDate}-${report.endDate}.csv"`,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
