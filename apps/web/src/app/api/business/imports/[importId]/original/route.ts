import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";
import { getImportOriginal } from "@/lib/domain/imports";

export const runtime = "nodejs";

type Params = { params: Promise<{ importId: string }> };

/**
 * Fichier d'origine d'un import (mission 12, lot L2). Contrôles en base (commerce de la session, permission),
 * puis redirection vers une URL R2 signée de quelques minutes, ou contenu servi directement par le stockage
 * mémoire (tests, aperçu). Jamais mis en cache ; la redirection n'envoie pas de Referer.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const context = await getBusinessContext(request.headers);
    const { importId } = await params;
    const original = await getImportOriginal(context.db, context, importId);
    const common = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
    if (original.kind === "redirect") return new Response(null, { status: 303, headers: { ...common, location: original.url } });
    return new Response(Buffer.from(original.bytes), { headers: { ...common, "content-type": original.contentType,
      "content-disposition": original.contentDisposition, "x-content-type-options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
