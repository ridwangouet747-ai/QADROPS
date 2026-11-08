import { createHmac } from "node:crypto";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvent, platformAdmin, platformSession, session as sessionTable } from "../db/schema";
import type { QadrAuth } from "../auth/server";
import type { CommercialDatabase } from "./commercial";
import { writePlatformAudit } from "./platform";

/**
 * Connexion du propriétaire de la plateforme (mission 13).
 *
 * - Un seul chemin : `POST /api/platform/auth/sign-in` appelle `signInUsername` de Better Auth côté serveur
 *   (la route HTTP `/sign-in/username` est fermée), vérifie le droit `platform_admin`, puis ouvre une
 *   session plateforme (`platform_session`). Une session ordinaire, même du propriétaire, n'ouvre pas la console.
 * - Réponse identique pour un nom inconnu, un mauvais mot de passe ou un compte sans droit : 401 générique.
 *   Better Auth calcule un hachage même pour un nom inconnu (temps de réponse comparable).
 * - Tentatives limitées à partir du journal d'audit en ajout seul : par client (empreinte HMAC de l'adresse
 *   IP, jamais l'adresse elle-même) et au total, sur une fenêtre glissante. Fonctionne sur plusieurs
 *   instances, contrairement à la limitation en mémoire de Better Auth.
 * - Session plateforme valable `PLATFORM_SESSION_MAX_AGE_MS`, cookie de session de navigateur
 *   (`rememberMe: false`) : il faut se reconnecter chaque jour de travail.
 */
export const PLATFORM_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const platformLoginLimits = { windowMs: 15 * 60 * 1000, perClient: 5, global: 30 } as const;

const FAILED = "platform.login_failed";
const signInSchema = z.object({
  username: z.string().trim().min(3).max(30),
  password: z.string().min(1).max(128),
}).strict();

export type PlatformSignInResult =
  | { ok: true; userId: string; headers: Headers }
  | { ok: false; status: 401 | 429 };

/** Empreinte non réversible du client, pour compter les échecs sans conserver d'adresse IP. */
export function platformClientKey(ip: string | null | undefined, secret: string) {
  return createHmac("sha256", secret).update(`platform-login:${ip?.trim() || "inconnu"}`).digest("hex").slice(0, 32);
}

async function recentFailures(db: CommercialDatabase, clientKey: string, now: Date) {
  const since = new Date(now.getTime() - platformLoginLimits.windowMs);
  const [all] = await db.select({ total: count() }).from(auditEvent)
    .where(and(eq(auditEvent.eventType, FAILED), gte(auditEvent.occurredAt, since)));
  const [mine] = await db.select({ total: count() }).from(auditEvent)
    .where(and(eq(auditEvent.eventType, FAILED), gte(auditEvent.occurredAt, since), sql`${auditEvent.metadata}->>'client' = ${clientKey}`));
  return { global: Number(all?.total ?? 0), client: Number(mine?.total ?? 0) };
}

async function recordFailure(db: CommercialDatabase, clientKey: string, reason: "invalid_input" | "invalid_credentials" | "not_platform_owner") {
  // Ni nom d'utilisateur, ni mot de passe, ni adresse IP : seulement l'empreinte du client et le motif interne.
  await writePlatformAudit(db as never, {
    actorUserId: null, eventType: FAILED, entityType: "platform_login", entityId: "owner",
    metadata: { client: clientKey, cause: reason }, result: "failure",
  });
}

export async function signInPlatformOwner(auth: QadrAuth, db: CommercialDatabase, input: {
  body: unknown; headers: Headers; clientKey: string; now?: Date;
}): Promise<PlatformSignInResult> {
  const now = input.now ?? new Date();
  const failures = await recentFailures(db, input.clientKey, now);
  if (failures.client >= platformLoginLimits.perClient || failures.global >= platformLoginLimits.global) {
    return { ok: false, status: 429 };
  }
  const parsed = signInSchema.safeParse(input.body);
  if (!parsed.success) {
    await recordFailure(db, input.clientKey, "invalid_input");
    return { ok: false, status: 401 };
  }

  let signedIn: { headers: Headers; response: { token: string; user: { id: string } } };
  try {
    signedIn = await auth.api.signInUsername({
      body: { username: parsed.data.username, password: parsed.data.password, rememberMe: false },
      headers: input.headers,
      returnHeaders: true,
    }) as typeof signedIn;
  } catch {
    await recordFailure(db, input.clientKey, "invalid_credentials");
    return { ok: false, status: 401 };
  }

  const userId = signedIn.response.user.id;
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin)
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt))).limit(1);
  const [created] = await db.select({ id: sessionTable.id }).from(sessionTable).where(eq(sessionTable.token, signedIn.response.token)).limit(1);
  if (!grant || !created) {
    // Compte valide mais sans droit : la session tout juste créée est supprimée, la réponse reste générique.
    await db.delete(sessionTable).where(eq(sessionTable.token, signedIn.response.token));
    await recordFailure(db, input.clientKey, "not_platform_owner");
    return { ok: false, status: 401 };
  }
  await db.transaction(async (tx) => {
    await tx.insert(platformSession).values({ sessionId: created.id, userId, createdAt: now });
    await writePlatformAudit(tx as never, {
      actorUserId: userId, eventType: "platform.login_succeeded", entityType: "platform_login", entityId: "owner",
      metadata: { client: input.clientKey },
    });
  });
  return { ok: true, userId, headers: signedIn.headers };
}

/** Session plateforme valide (ouverte par la connexion dédiée, non expirée) pour cette session Better Auth. */
export async function hasActivePlatformSession(db: CommercialDatabase, sessionId: string, userId: string, now = new Date()) {
  const [row] = await db.select({ createdAt: platformSession.createdAt }).from(platformSession)
    .where(and(eq(platformSession.sessionId, sessionId), eq(platformSession.userId, userId))).limit(1);
  return !!row && now.getTime() - row.createdAt.getTime() < PLATFORM_SESSION_MAX_AGE_MS;
}

/** Trace de la déconnexion volontaire (la suppression de la session supprime aussi la session plateforme). */
export async function recordPlatformSignOut(db: CommercialDatabase, userId: string) {
  await writePlatformAudit(db as never, {
    actorUserId: userId, eventType: "platform.logout", entityType: "platform_login", entityId: "owner",
  });
}
