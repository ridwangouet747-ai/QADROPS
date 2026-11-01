import { createPrintJob, listPrintJobs } from "@/lib/domain/printing";
import { errorResponse, getBusinessContext, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return new Response(jsonSafe({ jobs: await listPrintJobs(context.db, context, query) }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** Prépare un ticket (vente validée ou page de test) ; renvoie les octets ESC/POS à transmettre au service local. */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe(await createPrintJob(context.db, context, await parseJsonRequest(request))), { status: 201, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
