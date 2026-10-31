import { and, eq } from "drizzle-orm";
import { createDatabase } from "@/lib/db/client";
import { getAuth } from "@/lib/auth/server";
import { businessMemberAccess, businessProfile, member } from "@/lib/db/schema";
import type { CommercialDatabase } from "./commercial";

export class BusinessContextError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
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

export async function getBusinessContext(headers: Headers): Promise<{ db: CommercialDatabase; businessId: string; userId: string; actorUserId: string }> {
  const preview = process.env.QADR_PREVIEW_MODE === "true";
  if (preview && process.env.NODE_ENV !== "development") {
    throw new BusinessContextError("La prévisualisation locale est désactivée hors développement.", 403);
  }
  const authSession = await (await getAuth()).api.getSession({ headers });
  if (!authSession && preview) {
    // Prévisualisation sans connexion : commerce de démonstration. Avec une vraie session, on suit la session.
    const { getPreviewDatabase, previewIdentity } = await import("@/lib/preview/database");
    const db = await getPreviewDatabase();
    return { db: db as unknown as CommercialDatabase, ...previewIdentity, actorUserId: previewIdentity.userId };
  }
  if (!authSession) throw new BusinessContextError("Authentification requise.", 401);
  const businessId = authSession.session.activeOrganizationId;
  if (!businessId) throw new BusinessContextError("Sélectionnez d’abord un commerce.", 403);
  const db = preview ? await (await import("@/lib/preview/database")).getPreviewDatabase() as unknown as CommercialDatabase : createDatabase();
  await assertActiveMembership(db, businessId, authSession.user.id);
  return { db, businessId, userId: authSession.user.id, actorUserId: authSession.user.id };
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
  return Response.json({ error: message }, { status });
}
