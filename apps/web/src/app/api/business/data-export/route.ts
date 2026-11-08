import { buildBusinessDataArchive } from "@/lib/domain/data-export";
import { errorResponse, getBusinessContext } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/*
 * Export complet des données du commerce actif (mission 13, docs/privacy/data-export.md).
 * Propriétaire uniquement ; commerce et compte viennent de la session. Archive produite en mémoire,
 * envoyée directement : rien n'est stocké, donc pas d'URL à signer ni de fichier à purger.
 */
export async function GET(request: Request) {
  try {
    const context = await getBusinessContext(request.headers);
    const { archive, fileName } = await buildBusinessDataArchive(context.db, { businessId: context.businessId, actorUserId: context.actorUserId });
    return new Response(new Uint8Array(archive), { headers: {
      "content-type": "application/zip", "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
