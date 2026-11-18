import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { getAuth } from "@/lib/auth/server";
import { businessMemberAccess, businessProfile, member } from "@/lib/db/schema";
import { isTrustedRequest, originRefusal } from "@/lib/security/request-origin";
import type { CommercialDatabase } from "./commercial";
import { commercialAccess, subscriptionRequired } from "./commercial-access";
import { isPlatformOwnerAccount } from "./platform-owner-separation";

export class BusinessContextError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

/** Mission 16 : une route authentifiée par cookie refuse une origine étrangère (src/lib/security/request-origin.ts). */
export function assertTrustedOrigin(headers: Headers, method?: string) {
  if (!isTrustedRequest(headers, method)) throw new BusinessContextError(originRefusal.error, 403, originRefusal.code);
}

/**
 * Vérifie côté serveur que l'utilisateur est membre du commerce, que son accès n'est pas désactivé et
 * que le commerce a un profil. Le commerce vient toujours de la session, jamais du navigateur.
 */
export async function assertActiveMembership(db: CommercialDatabase, businessId: string, userId: string) {
  const [row] = await db.select({ role: member.role, disabledAt: businessMemberAccess.disabledAt, profile: businessProfile.businessId })
    .from(member)
    .leftJoin(businessMemberAccess, and(eq(businessMemberAccess.businessId, member.organizationId), eq(businessMemberAccess.userId, member.userId)))
    .leftJoin(businessProfile, eq(businessProfile.businessId, member.organizationId))
    .where(and(eq(member.organizationId, businessId), eq(member.userId, userId))).limit(1);
  if (!row || !row.profile) throw new BusinessContextError("Ce commerce n’est pas accessible avec ce compte.", 403);
  if (row.disabledAt) throw new BusinessContextError("Votre accès à ce commerce a été désactivé.", 403);
  return row.role;
}

/**
 * `allowWithoutSubscription` : routes encore ouvertes à un commerce sans droit d’usage (suivi d’abonnement,
 * paiement, code d’accès, notifications, export de ses données). Toutes les autres répondent
 * 403 `subscription_required` (voir commercial-access.ts).
 */
export async function getBusinessContext(headers: Headers, options: { allowWithoutSubscription?: boolean } = {}): Promise<{ db: CommercialDatabase; businessId: string; userId: string; actorUserId: string; sessionId: string | null }> {
  assertTrustedOrigin(headers);
  const preview = process.env.QADR_PREVIEW_MODE === "true";
  if (preview && process.env.NODE_ENV !== "development") {
    throw new BusinessContextError("La prévisualisation locale est désactivée hors développement.", 403);
  }
  const authSession = await (await getAuth()).api.getSession({ headers });
  if (!authSession && preview) {
    // Prévisualisation sans connexion : commerce de démonstration. Avec une vraie session, on suit la session.
    const { getPreviewDatabase, previewIdentity } = await import("@/lib/preview/database");
    const db = await getPreviewDatabase();
    return { db: db as unknown as CommercialDatabase, ...previewIdentity, actorUserId: previewIdentity.userId, sessionId: null };
  }
  if (!authSession) throw new BusinessContextError("Authentification requise.", 401);
  const businessId = authSession.session.activeOrganizationId;
  if (!businessId) throw new BusinessContextError("Sélectionnez d’abord un commerce.", 403);
  const db = preview ? await (await import("@/lib/preview/database")).getPreviewDatabase() as unknown as CommercialDatabase : getDatabase();
  // Le compte de la plateforme n'a pas d'espace commerçant (platform-owner-separation.ts) : traité comme sans session.
  if (await isPlatformOwnerAccount(db, authSession.user.id)) throw new BusinessContextError("Authentification requise.", 401);
  await assertActiveMembership(db, businessId, authSession.user.id);
  if (!options.allowWithoutSubscription && !(await commercialAccess(db, businessId)).open) {
    throw new BusinessContextError(subscriptionRequired.error, 403, subscriptionRequired.code);
  }
  return { db, businessId, userId: authSession.user.id, actorUserId: authSession.user.id, sessionId: authSession.session.id };
}

export function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
}

export async function parseJsonRequest(request: Request): Promise<Record<string, unknown>> {
  const advertisedLength = Number(request.headers.get("content-length") ?? 0);
  if (advertisedLength > 65_536) throw new BusinessContextError("Requête trop volumineuse.", 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 65_536) throw new BusinessContextError("Requête trop volumineuse.", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new BusinessContextError("Corps JSON invalide.", 400); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BusinessContextError("Le corps doit être un objet JSON.", 400);
  }
  return parsed as Record<string, unknown>;
}

export function errorResponse(error: unknown): Response {
  const knownError = error instanceof BusinessContextError || (error instanceof Error && error.name === "CommercialError");
  const validationError = error instanceof Error && error.name === "ZodError";
  const status = knownError && "status" in error && typeof error.status === "number" ? error.status : validationError ? 400 : 500;
  const message = knownError && error instanceof Error ? error.message : validationError ? "Les données de la requête sont invalides." : "Une erreur empêche le traitement de la requête.";
  const code = knownError && "code" in error && typeof error.code === "string" ? error.code : validationError ? "validation" : undefined;
  // Erreur imprévue : la réponse reste générique, mais Sentry la reçoit (sans message ni données, voir
  // sentry.server.config.ts) ; sinon une panne en production passerait inaperçue.
  if (status === 500) Sentry.captureException(error);
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}
