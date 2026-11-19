import { updatePlatformPlan } from "@/lib/domain/platform";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { getPlatformContext } from "@/lib/domain/platform-context";
import { invalidatePublicPlans } from "@/lib/domain/public-plans";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const context = await getPlatformContext(request.headers);
    const { planId } = await params;
    const updated = await updatePlatformPlan(context.db, context.actorUserId, planId, await parseJsonRequest(request));
    // Prix, nom, publication ou retrait : la page publique relit la base à la visite suivante.
    invalidatePublicPlans();
    return new Response(jsonSafe(updated), { headers: { "content-type": "application/json" } });
  }
  catch (error) { return errorResponse(error); }
}
