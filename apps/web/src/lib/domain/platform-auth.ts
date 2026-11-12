import { createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { platformAdmin, platformSession, session as sessionTable, user } from "../db/schema";
import type { QadrAuth } from "../auth/server";
import { consumeRateLimits, rateRules, refundRateLimit } from "../security/rate-limit";
import type { CommercialDatabase } from "./commercial";
import { writePlatformAudit } from "./platform";
import { ensureSeededPlatformOwner, isSeedPassword } from "./platform-owner";

/**
 * Connexion du propriétaire de la plateforme : nom d'utilisateur et mot de passe ; second facteur seulement
 * si le propriétaire l'a activé (missions 13 et 14, rendu facultatif le 2026-11-12 à sa demande).
 *
 * Sans second facteur : l'étape 1 ouvre directement la session Better Auth et la session plateforme, après
 * contrôle du droit. Si aucun propriétaire n'existe, le compte de départ est d'abord créé à partir des
 * variables du serveur (`ensureSeededPlatformOwner`). Avec second facteur, les deux étapes ci-dessous :
 *
 * 1. `POST /api/platform/auth/sign-in` appelle `signInUsername` de Better Auth côté serveur (la route HTTP
 *    `/sign-in/username` est fermée). Le compte du propriétaire ayant le second facteur activé, le plugin
 *    twoFactor supprime la session tout juste créée et ne laisse qu'un cookie de défi `two_factor` (5 min).
 *    AUCUNE session, donc aucune session plateforme, n'existe à ce stade.
 * 2. `POST /api/platform/auth/verify` présente ce cookie et un code TOTP (ou un code de secours) à
 *    `verifyTOTP` / `verifyBackupCode` côté serveur. Seule une vérification réussie crée la session Better
 *    Auth ; la session plateforme (`platform_session`) n'est ouverte qu'ici, après contrôle du droit.
 *
 * - Les routes HTTP `/api/auth/two-factor/*` sont fermées : impossible d'obtenir une session par elles.
 * - Les cookies reçus ne sont jamais transmis à l'étape 1 (pas de cookie « appareil de confiance », pas de
 *   session existante) ; à l'étape 2, seuls les cookies du défi sont transmis.
 * - Réponse identique (401) pour un nom inconnu, un mauvais mot de passe ou un compte sans droit.
 * - Limitation partagée entre instances (`lib/security/rate-limit.ts`), réservée avant toute vérification,
 *   rendue en cas de succès : par client (empreinte HMAC de l'adresse IP) et au total.
 * - Audit : ni nom d'utilisateur saisi, ni adresse IP, ni code, ni secret.
 */
export const PLATFORM_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const platformLoginLimits = {
  windowMs: rateRules.platformSignInClient.windowMs,
  perClient: rateRules.platformSignInClient.limit,
  global: rateRules.platformSignInGlobal.limit,
} as const;

const FAILED = "platform.login_failed";
const signInSchema = z.object({
  username: z.string().trim().min(3).max(30),
  password: z.string().min(1).max(128),
}).strict();
const verifySchema = z.union([
  z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict(),
  z.object({ backupCode: z.string().trim().min(8).max(40).regex(/^[A-Za-z0-9-]+$/) }).strict(),
]);

type Refusal = { ok: false; status: 401 | 429; retryAfterSeconds?: number };
export type PlatformSignInResult =
  | { ok: true; step: "two_factor"; headers: Headers }
  /** Sans second facteur : session ouverte. `defaultPassword` : le mot de passe est encore celui de départ. */
  | { ok: true; step: "done"; userId: string; defaultPassword: boolean; headers: Headers }
  | Refusal;
export type PlatformVerifyResult = { ok: true; userId: string; headers: Headers } | { ok: false; status: 401 | 429; retryAfterSeconds?: number };

/** Empreinte non réversible du client, pour compter les échecs sans conserver d'adresse IP. */
export function platformClientKey(ip: string | null | undefined, secret: string) {
  return createHmac("sha256", secret).update(`platform-login:${ip?.trim() || "inconnu"}`).digest("hex").slice(0, 32);
}

type FailureCause = "invalid_input" | "invalid_credentials" | "not_platform_owner" | "invalid_second_factor" | "second_factor_locked";
async function recordFailure(db: CommercialDatabase, clientKey: string, cause: FailureCause) {
  // Ni nom d'utilisateur, ni mot de passe, ni code, ni adresse IP : seulement l'empreinte du client et le motif.
  await writePlatformAudit(db as never, {
    actorUserId: null, eventType: FAILED, entityType: "platform_login", entityId: "owner",
    metadata: { client: clientKey, cause }, result: "failure",
  });
}

async function activeGrant(db: CommercialDatabase, userId: string) {
  const [grant] = await db.select({ userId: platformAdmin.userId }).from(platformAdmin)
    .where(and(eq(platformAdmin.userId, userId), isNull(platformAdmin.revokedAt))).limit(1);
  return !!grant;
}

/** Cookies d'une requête, filtrés par nom (la valeur n'est jamais lue ici). */
function keepCookies(headers: Headers, keep: (name: string) => boolean) {
  const kept = (headers.get("cookie") ?? "").split(";").map((pair) => pair.trim()).filter((pair) => {
    const name = pair.split("=")[0] ?? "";
    return name.length > 0 && keep(name);
  });
  const next = new Headers(headers);
  if (kept.length) next.set("cookie", kept.join("; ")); else next.delete("cookie");
  return next;
}

export async function signInPlatformOwner(auth: QadrAuth, db: CommercialDatabase, input: {
  body: unknown; headers: Headers; clientKey: string; secret: string; now?: Date; environment?: Readonly<Record<string, string | undefined>>;
}): Promise<PlatformSignInResult> {
  const now = input.now ?? new Date();
  const limits = await consumeRateLimits(db, [
    { rule: rateRules.platformSignInClient, subject: input.clientKey },
    { rule: rateRules.platformSignInGlobal, subject: "owner" },
  ], input.secret, now);
  if (!limits.allowed) return { ok: false, status: 429, retryAfterSeconds: limits.retryAfterSeconds };
  const parsed = signInSchema.safeParse(input.body);
  if (!parsed.success) {
    await recordFailure(db, input.clientKey, "invalid_input");
    return { ok: false, status: 401 };
  }

  // Première connexion : s'il n'y a aucun propriétaire, le compte de départ est créé (valeurs du serveur seulement).
  await ensureSeededPlatformOwner(auth, db, input.environment);

  type Signed = { headers: Headers; response: { twoFactorRedirect?: boolean; token?: string; user?: { id: string } } };
  let signedIn: Signed;
  try {
    signedIn = await auth.api.signInUsername({
      body: { username: parsed.data.username, password: parsed.data.password, rememberMe: false },
      headers: keepCookies(input.headers, () => false),
      returnHeaders: true,
    }) as Signed;
  } catch {
    await recordFailure(db, input.clientKey, "invalid_credentials");
    return { ok: false, status: 401 };
  }

  if (!signedIn.response.twoFactorRedirect) {
    // Mot de passe correct, compte sans second facteur : Better Auth vient de créer une session ordinaire.
    const token = signedIn.response.token;
    const userId = signedIn.response.user?.id;
    const [created] = token ? await db.select({ id: sessionTable.id }).from(sessionTable).where(eq(sessionTable.token, token)).limit(1) : [];
    if (!userId || !created || !(await activeGrant(db, userId))) {
      // Compte de commerce (ou droit retiré) : la session ordinaire est supprimée aussitôt, refus générique.
      if (token) await db.delete(sessionTable).where(eq(sessionTable.token, token));
      await recordFailure(db, input.clientKey, "not_platform_owner");
      return { ok: false, status: 401 };
    }
    await db.transaction(async (tx) => {
      await tx.insert(platformSession).values({ sessionId: created.id, userId, createdAt: now });
      await writePlatformAudit(tx as never, {
        actorUserId: userId, eventType: "platform.login_succeeded", entityType: "platform_login", entityId: "owner",
        metadata: { client: input.clientKey, factor: "password" },
      });
    });
    await refundRateLimit(db, limits.decisions);
    return { ok: true, step: "done", userId, defaultPassword: isSeedPassword(parsed.data.password, input.environment), headers: signedIn.headers };
  }

  // Défi ouvert : vérifier que ce compte est bien le propriétaire actif, sans attendre le code.
  const [candidate] = await db.select({ id: user.id }).from(user).where(eq(user.username, parsed.data.username.toLowerCase())).limit(1);
  if (!candidate || !(await activeGrant(db, candidate.id))) {
    await recordFailure(db, input.clientKey, "not_platform_owner");
    return { ok: false, status: 401 };
  }
  await refundRateLimit(db, limits.decisions);
  await writePlatformAudit(db as never, {
    actorUserId: candidate.id, eventType: "platform.login_password_accepted", entityType: "platform_login", entityId: "owner",
    metadata: { client: input.clientKey },
  });
  return { ok: true, step: "two_factor", headers: signedIn.headers };
}

/** Second facteur : seule cette étape crée la session Better Auth et la session plateforme. */
export async function verifyPlatformSecondFactor(auth: QadrAuth, db: CommercialDatabase, input: {
  body: unknown; headers: Headers; clientKey: string; secret: string; now?: Date;
}): Promise<PlatformVerifyResult> {
  const now = input.now ?? new Date();
  const limits = await consumeRateLimits(db, [
    { rule: rateRules.platformVerifyClient, subject: input.clientKey },
    { rule: rateRules.platformVerifyGlobal, subject: "owner" },
  ], input.secret, now);
  if (!limits.allowed) return { ok: false, status: 429, retryAfterSeconds: limits.retryAfterSeconds };
  const parsed = verifySchema.safeParse(input.body);
  if (!parsed.success) {
    await recordFailure(db, input.clientKey, "invalid_input");
    return { ok: false, status: 401 };
  }
  // Seulement le défi et la préférence « ne pas se souvenir » : jamais une session existante.
  const headers = keepCookies(input.headers, (name) => name.endsWith("two_factor") || name.endsWith("dont_remember"));
  const factor = "code" in parsed.data ? "totp" : "backup_code";

  type Verified = { headers: Headers; response: { token: string; user: { id: string } } };
  let verified: Verified;
  try {
    verified = ("code" in parsed.data
      ? await auth.api.verifyTOTP({ body: { code: parsed.data.code }, headers, returnHeaders: true })
      : await auth.api.verifyBackupCode({ body: { code: parsed.data.backupCode }, headers, returnHeaders: true })) as unknown as Verified;
  } catch (error) {
    const locked = (error as { statusCode?: number }).statusCode === 429;
    await recordFailure(db, input.clientKey, locked ? "second_factor_locked" : "invalid_second_factor");
    return locked ? { ok: false, status: 429, retryAfterSeconds: 900 } : { ok: false, status: 401 };
  }

  const userId = verified.response.user.id;
  const [created] = await db.select({ id: sessionTable.id }).from(sessionTable).where(eq(sessionTable.token, verified.response.token)).limit(1);
  if (!created || !(await activeGrant(db, userId))) {
    await db.delete(sessionTable).where(eq(sessionTable.token, verified.response.token));
    await recordFailure(db, input.clientKey, "not_platform_owner");
    return { ok: false, status: 401 };
  }
  await db.transaction(async (tx) => {
    await tx.insert(platformSession).values({ sessionId: created.id, userId, createdAt: now });
    await writePlatformAudit(tx as never, {
      actorUserId: userId, eventType: "platform.login_succeeded", entityType: "platform_login", entityId: "owner",
      metadata: { client: input.clientKey, factor },
    });
  });
  await refundRateLimit(db, limits.decisions);
  return { ok: true, userId, headers: verified.headers };
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
