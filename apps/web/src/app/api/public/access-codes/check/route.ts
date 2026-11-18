import { and, eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/server";
import { accessPassCookie } from "@/lib/commercial/access-pass";
import { guardPublicRequest, noStore } from "@/lib/commercial/public-guard";
import { member, organization } from "@/lib/db/schema";
import { errorResponse, jsonSafe, parseJsonRequest } from "@/lib/domain/business-context";
import { CommercialError } from "@/lib/domain/commercial";
import { checkCommercialCode, recordCommercialCodeRejection } from "@/lib/domain/commercial-codes";
import { platformClientKey } from "@/lib/domain/platform-auth";
import { isPlatformOwnerAccount } from "@/lib/domain/platform-owner-separation";
import { rateRules, refundRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * Vérification d'un code d'accès commercial saisi sur /redeem-code (2026-11-16, docs/commercial-access-codes.md).
 * Ne consomme rien. Si le code est utilisable, pose un laissez-passer HttpOnly (2 h) et indique l'étape suivante :
 * `register` (aucun compte connecté), `onboarding` (compte connecté sans commerce à renouveler) ou `renew`
 * (propriétaire ou administrateur connecté : le code s'appliquera à SON commerce actif).
 *
 * Réponses : 200 `{ valid: true, … }` ; 404 `invalid` ; 409 `already_used` ; 410 `expired` | `revoked` ;
 * 422 `invite_code` ; 400 `turnstile_failed` ; 403 `invalid_origin` ; 429 `rate_limited`. Turnstile : action
 * « access-code ». Seuls les échecs consomment le quota (par adresse IP et au total).
 */
export async function POST(request: Request) {
  try {
    const guard = await guardPublicRequest(request, "access-code", (ip) => [
      { rule: rateRules.accessCodeIp, subject: ip },
      { rule: rateRules.accessCodeGlobal, subject: "all" },
    ]);
    if (guard instanceof Response) return guard;
    const { db, ip, secret, decisions } = guard;
    const body = await parseJsonRequest(request);
    let checked: Awaited<ReturnType<typeof checkCommercialCode>>;
    try {
      checked = await checkCommercialCode(db, body.code);
    } catch (error) {
      if (error instanceof CommercialError && error.code) await recordCommercialCodeRejection(db, { reason: error.code, client: platformClientKey(ip, secret) });
      throw error;
    }
    await refundRateLimit(db, decisions);

    let next: "register" | "onboarding" | "renew" = "register";
    let businessName: string | null = null;
    const session = await (await getAuth()).api.getSession({ headers: request.headers }).catch(() => null);
    // Compte de la plateforme : jamais de suite « onboarding » ; le code sert à créer un nouveau compte commerçant.
    const current = session && !(await isPlatformOwnerAccount(db, session.user.id)) ? session : null;
    if (current) {
      next = "onboarding";
      const activeId = current.session.activeOrganizationId;
      if (activeId) {
        const [membership] = await db.select({ role: member.role, name: organization.name }).from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .where(and(eq(member.organizationId, activeId), eq(member.userId, current.user.id))).limit(1);
        if (membership && ["owner", "admin"].includes(membership.role)) { next = "renew"; businessName = membership.name; }
      }
    }
    return new Response(jsonSafe({ valid: true, plan: checked.plan, duration: checked.duration, activationDeadline: checked.activationDeadline, next, businessName }), {
      headers: { ...noStore, "content-type": "application/json", "set-cookie": accessPassCookie(checked.id) },
    });
  } catch (error) { return errorResponse(error); }
}
