import { BusinessContextError, errorResponse, getBusinessContext, jsonSafe } from "@/lib/domain/business-context";
import { createCatalogImport, listImportBatches } from "@/lib/domain/imports";
import { IMPORT_LIMITS } from "@/lib/imports/spreadsheet";

export const runtime = "nodejs";

const noStore = { "content-type": "application/json", "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    return new Response(jsonSafe(await listImportBatches(context.db, context)), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

/** Envoi d'un fichier (multipart, champ « file »). Le type est vérifié sur le contenu, pas sur l'extension. */
export async function POST(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    // Marge pour l'enveloppe multipart ; la taille exacte du fichier est revérifiée ensuite.
    if (Number(request.headers.get("content-length") ?? 0) > IMPORT_LIMITS.fileBytes + 64_000) throw new BusinessContextError("Le fichier dépasse 2 Mo.", 413);
    const form = await request.formData().catch(() => { throw new BusinessContextError("Envoi de fichier invalide.", 400); });
    const file = form.get("file");
    if (!(file instanceof File)) throw new BusinessContextError("Aucun fichier reçu.", 400);
    if (file.size > IMPORT_LIMITS.fileBytes) throw new BusinessContextError("Le fichier dépasse 2 Mo.", 413);
    const result = await createCatalogImport(context.db, { ...context, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return new Response(jsonSafe({ import: result }), { status: result.existing ? 200 : 201, headers: { "content-type": "application/json" } });
  } catch (error) { return errorResponse(error); }
}
