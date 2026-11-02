import { getCommercialReport, reportCsv } from "@/lib/domain/reports";
import { getReportExport, getWorkbookExport } from "@/lib/domain/exports";
import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";
import { buildReportPdf, pdfLocales, reportPdfFileName, type PdfLocale } from "@/lib/exports/report-pdf";
import { buildReportWorkbook, workbookFileName } from "@/lib/exports/report-workbook";
import { XLSX_CONTENT_TYPE } from "@/lib/exports/xlsx";
import { isLocale, localeCookie, resolveLocale, type Locale } from "@/lib/i18n/config";

export const runtime = "nodejs";

/*
 * Exports d'un rapport (docs/exports.md) : CSV (résumé), XLSX (classeur) et PDF (fr/en).
 * Le commerce vient de la session ; aucun identifiant de commerce ou d'utilisateur n'est lu dans la
 * requête. Fichiers produits en mémoire, jamais stockés, jamais journalisés.
 */

/** Langue des en-têtes : paramètre `lang` de l'écran, sinon le cookie de langue de l'interface. */
function requestLocale(request: Request, query: URLSearchParams): Locale {
  const asked = query.get("lang");
  if (isLocale(asked)) return asked;
  const cookie = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${localeCookie}=`))?.slice(localeCookie.length + 1);
  return resolveLocale(cookie);
}

function download(body: Uint8Array | string, contentType: string, fileName: string) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { headers: {
    "content-type": contentType, "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  } });
}

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = new URL(request.url).searchParams;
    const format = query.get("format");
    const locale = requestLocale(request, query);
    const input = {
      businessId: context.businessId, actorUserId: context.actorUserId,
      period: query.get("period") ?? "monthly",
      date: query.get("date") ?? undefined,
      startDate: query.get("startDate") ?? undefined,
      endDate: query.get("endDate") ?? undefined,
    };
    if (format === "csv") {
      const report = await getCommercialReport(context.db, input);
      return download(reportCsv(report), "text/csv; charset=utf-8", `qadr-ops-rapport-${report.startDate}-${report.endDate}.csv`);
    }
    if (format === "xlsx") {
      const data = await getWorkbookExport(context.db, input);
      return download(buildReportWorkbook(data, locale), XLSX_CONTENT_TYPE, workbookFileName(data));
    }
    if (format === "pdf") {
      // Le PDF serveur n'existe qu'en français et en anglais (polices standard, pas de façonnage arabe).
      if (!(pdfLocales as readonly string[]).includes(locale)) {
        return Response.json({ error: "Le rapport PDF n’est disponible qu’en français ou en anglais.", code: "pdf_language_unsupported" }, { status: 422 });
      }
      const { report, businessName } = await getReportExport(context.db, input);
      return download(buildReportPdf(report, businessName, locale as PdfLocale), "application/pdf", reportPdfFileName(report));
    }
    return Response.json({ error: "Format d’export non pris en charge.", code: "unsupported_format" }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
