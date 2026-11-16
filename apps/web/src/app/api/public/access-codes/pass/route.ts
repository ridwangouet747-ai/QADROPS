import { readAccessPass } from "@/lib/commercial/access-pass";
import { accessCodeRequired, commercialMode, whatsappNumber } from "@/lib/commercial/mode";
import { getRuntimeDatabase } from "@/lib/db/runtime";
import { errorResponse, jsonSafe } from "@/lib/domain/business-context";
import { describeCommercialCode, usableCommercialCodeById } from "@/lib/domain/commercial-codes";

export const runtime = "nodejs";

/**
 * État du laissez-passer de ce navigateur (2026-11-16) : lu par l'inscription et la création du commerce pour
 * afficher l'offre retenue, ou renvoyer vers /redeem-code. Lecture seule ; ne révèle rien sans cookie valide.
 */
export async function GET(request: Request) {
  try {
    const required = accessCodeRequired();
    const codeId = readAccessPass(request.headers);
    const row = codeId ? await usableCommercialCodeById(await getRuntimeDatabase(), codeId) : null;
    const pass = row ? await describeCommercialCode(await getRuntimeDatabase(), row) : null;
    // `whatsapp` : numéro public de Qadr Agency (configuration serveur) ou null ; jamais un numéro inventé.
    return new Response(jsonSafe({ required, mode: commercialMode(), pass, whatsapp: whatsappNumber() }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
