import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { generateCommercialAccessCodes, listCommercialAccessCodes } from "@/lib/domain/commercial-codes";
import { getPlatformContext } from "@/lib/domain/platform-context";

export const runtime = "nodejs";

const privateJson = { "content-type": "application/json", "cache-control": "private, no-store" };

/** Gestion des accès commerciaux (2026-11-16) : liste filtrée par état, sans jamais le code brut. */
export async function GET(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    const url = new URL(request.url);
    const query = Object.fromEntries(["state", "limit", "before"].flatMap((key) => url.searchParams.get(key) ? [[key, url.searchParams.get(key)]] : []));
    return new Response(jsonSafe(await listCommercialAccessCodes(context.db, context.actorUserId, query)), { headers: privateJson });
  } catch (error) { return errorResponse(error); }
}

/** Génération après paiement vérifié : la réponse est la seule à contenir les codes en clair. */
export async function POST(request: Request) {
  try {
    const context = await getPlatformContext(request.headers);
    return new Response(jsonSafe(await generateCommercialAccessCodes(context.db, context.actorUserId, await parseJsonRequest(request))), { status: 201, headers: privateJson });
  } catch (error) { return errorResponse(error); }
}
