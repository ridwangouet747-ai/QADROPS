import { getAccountOverview } from "@/lib/domain/account";
import { getAccountContext } from "@/lib/domain/account-context";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";

export const runtime = "nodejs";

/** Utilisateur connecté : commerces accessibles (rôle, état), commerce actif, accès plateforme. */
export async function GET(request: Request) {
  try {
    const context = await getAccountContext(request.headers);
    const overview = await getAccountOverview(context.db, context.userId, context.activeBusinessId);
    return new Response(jsonSafe({ user: { id: context.userId, email: context.email }, ...overview }), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
