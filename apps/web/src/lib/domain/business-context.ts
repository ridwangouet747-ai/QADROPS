import { createDatabase } from "@/lib/db/client";
import { getAuth } from "@/lib/auth/server";
import type { CommercialDatabase } from "./commercial";

export class BusinessContextError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function getBusinessContext(headers: Headers): Promise<{ db: CommercialDatabase; businessId: string; userId: string; actorUserId: string }> {
  if (process.env.QADR_PREVIEW_MODE === "true") {
    if (process.env.NODE_ENV !== "development") {
      throw new BusinessContextError("La prévisualisation locale est désactivée hors développement.", 403);
    }
    const { getPreviewDatabase, previewIdentity } = await import("@/lib/preview/database");
    const db = await getPreviewDatabase();
    return { db: db as unknown as CommercialDatabase, ...previewIdentity, actorUserId: previewIdentity.userId };
  }
  const authSession = await getAuth().api.getSession({ headers });
  if (!authSession) throw new BusinessContextError("Authentification requise.", 401);
  const businessId = authSession.session.activeOrganizationId;
  if (!businessId) throw new BusinessContextError("Sélectionnez d’abord un commerce.", 403);
  return { db: createDatabase(), businessId, userId: authSession.user.id, actorUserId: authSession.user.id };
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
