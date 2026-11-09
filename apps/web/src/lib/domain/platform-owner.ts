import { count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { account, platformAdmin, session as sessionTable, twoFactor, user } from "../db/schema";
import type { QadrAuth } from "../auth/server";
import { CommercialError, type CommercialDatabase } from "./commercial";
import { writePlatformAudit } from "./platform";

/**
 * Compte propriétaire de la plateforme (mission 13), créé et géré uniquement par
 * `scripts/platform-owner.ts` : jamais au démarrage, jamais par une route HTTP.
 *
 * - Mot de passe haché par Better Auth (`ctx.password.hash`, scrypt), jamais écrit ni journalisé.
 * - Nom d'utilisateur en minuscules, unique et immuable (plugin Username, `immutableUsername`).
 * - Un seul propriétaire actif : l'initialisation est refusée dès qu'un droit `platform_admin` actif existe.
 */
export const OWNER_MIN_PASSWORD_LENGTH = 12;
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._]{2,29}$/, "Nom d’utilisateur : 3 à 30 caractères (a-z, 0-9, point, tiret bas), commençant par une lettre ou un chiffre.");
const passwordSchema = z.string().min(OWNER_MIN_PASSWORD_LENGTH, `Mot de passe : au moins ${OWNER_MIN_PASSWORD_LENGTH} caractères.`).max(128);
const bootstrapSchema = z.object({
  username: usernameSchema,
  email: z.email().max(254),
  name: z.string().trim().min(2).max(100),
  password: passwordSchema,
}).strict();
const resetSchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();

export async function bootstrapPlatformOwner(auth: QadrAuth, db: CommercialDatabase, raw: unknown) {
  const input = bootstrapSchema.parse(raw);
  const [active] = await db.select({ total: count() }).from(platformAdmin).where(isNull(platformAdmin.revokedAt));
  if (Number(active?.total ?? 0) > 0) throw new CommercialError("Un propriétaire de la plateforme est déjà actif : initialisation refusée.", 409);
  const [taken] = await db.select({ id: user.id }).from(user)
    .where(sql`lower(${user.email}) = ${input.email.toLowerCase()} or ${user.username} = ${input.username}`).limit(1);
  // Un compte de commerce existant n'est jamais promu ni modifié : le propriétaire a son propre compte.
  if (taken) throw new CommercialError("Adresse ou nom d’utilisateur déjà utilisé : choisissez un compte dédié à l’administration.", 409);

  const context = await auth.$context;
  const hash = await context.password.hash(input.password);
  const created = await context.internalAdapter.createUser({
    email: input.email.toLowerCase(), name: input.name, emailVerified: false, username: input.username, displayUsername: input.username,
  }, { method: "admin" });
  await context.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: hash });
  await db.transaction(async (tx) => {
    await tx.insert(platformAdmin).values({ userId: created.id, grantedByUserId: null });
    await writePlatformAudit(tx as never, {
      actorUserId: null, eventType: "platform.owner_bootstrapped", entityType: "user", entityId: created.id,
      before: { admin: false }, after: { admin: true }, reason: "Initialisation du propriétaire (scripts/platform-owner.ts)",
    });
  });
  return { userId: created.id, username: input.username };
}

/**
 * Renouvellement du mot de passe du propriétaire par un opérateur ayant accès à la base (mot de passe
 * oublié, suspicion de fuite). Toutes les sessions du compte sont fermées.
 */
export async function resetPlatformOwnerPassword(auth: QadrAuth, db: CommercialDatabase, raw: unknown) {
  const input = resetSchema.parse(raw);
  const [owner] = await db.select({ id: user.id }).from(user).innerJoin(platformAdmin, eq(platformAdmin.userId, user.id))
    .where(sql`${user.username} = ${input.username} and ${platformAdmin.revokedAt} is null`).limit(1);
  if (!owner) throw new CommercialError("Aucun propriétaire actif avec ce nom d’utilisateur.", 404);
  const context = await auth.$context;
  const hash = await context.password.hash(input.password);
  const updated = await db.update(account).set({ password: hash, updatedAt: new Date() })
    .where(sql`${account.userId} = ${owner.id} and ${account.providerId} = 'credential'`).returning({ id: account.id });
  if (!updated.length) throw new CommercialError("Le compte propriétaire n’a pas de mot de passe enregistré.", 409);
  const closed = await db.delete(sessionTable).where(eq(sessionTable.userId, owner.id)).returning({ id: sessionTable.id });
  await writePlatformAudit(db as never, {
    actorUserId: null, eventType: "platform.owner_password_reset", entityType: "user", entityId: owner.id,
    reason: "Renouvellement du mot de passe (scripts/platform-owner.ts)", metadata: { sessionsClosed: closed.length },
  });
  return { userId: owner.id, sessionsClosed: closed.length };
}

type OwnerRow = { id: string; twoFactorEnabled: boolean };
async function activeOwnerByUsername(db: CommercialDatabase, rawUsername: unknown): Promise<OwnerRow> {
  const username = usernameSchema.parse(rawUsername);
  const [owner] = await db.select({ id: user.id, twoFactorEnabled: user.twoFactorEnabled }).from(user).innerJoin(platformAdmin, eq(platformAdmin.userId, user.id))
    .where(sql`${user.username} = ${username} and ${platformAdmin.revokedAt} is null`).limit(1);
  if (!owner) throw new CommercialError("Aucun propriétaire actif avec ce nom d’utilisateur.", 404);
  return owner;
}

function cookieHeaders(from: Headers) {
  const cookie = from.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => !pair.endsWith("=")).join("; ");
  return new Headers({ cookie });
}

/**
 * Activation du second facteur du propriétaire (mission 14), par `scripts/platform-owner.ts enroll-2fa`.
 *
 * 1. `begin` vérifie le mot de passe (connexion serveur, aucune route HTTP), crée un secret TOTP et dix codes de
 *    secours, chiffrés par Better Auth. Le facteur n'est PAS encore actif.
 * 2. `confirm(code)` exige un premier code valide de l'application d'authentification : seulement alors le
 *    facteur devient obligatoire. Toutes les sessions du compte sont ensuite fermées.
 * Le secret et les codes ne sont remis qu'à l'appelant (le terminal de l'opérateur), jamais écrits ni journalisés.
 */
export async function beginOwnerTwoFactorEnrollment(auth: QadrAuth, db: CommercialDatabase, raw: { username: unknown; password: unknown }) {
  const owner = await activeOwnerByUsername(db, raw.username);
  if (owner.twoFactorEnabled) throw new CommercialError("Le second facteur est déjà actif : utilisez reset-2fa pour le remplacer.", 409);
  const password = z.string().min(1).max(128).parse(raw.password);
  const username = usernameSchema.parse(raw.username);
  type Signed = { headers: Headers; response: { token?: string; twoFactorRedirect?: boolean } };
  let signed: Signed;
  try {
    signed = await auth.api.signInUsername({ body: { username, password, rememberMe: false }, headers: new Headers(), returnHeaders: true }) as Signed;
  } catch {
    throw new CommercialError("Nom d’utilisateur ou mot de passe incorrect.", 401);
  }
  const session = cookieHeaders(signed.headers);
  const enabled = await auth.api.enableTwoFactor({ body: { password, method: "totp" }, headers: session }) as { totpURI?: string; backupCodes?: string[] };
  if (!enabled.totpURI || !enabled.backupCodes?.length) throw new CommercialError("Activation du second facteur impossible.", 500);
  const closeSessions = () => db.delete(sessionTable).where(eq(sessionTable.userId, owner.id));
  return {
    totpURI: enabled.totpURI,
    backupCodes: enabled.backupCodes,
    async confirm(code: string) {
      try {
        await auth.api.verifyTOTP({ body: { code: z.string().trim().regex(/^\d{6}$/).parse(code) }, headers: session });
      } catch {
        throw new CommercialError("Code refusé : le second facteur n’est pas activé. Relancez enroll-2fa.", 400);
      }
      await closeSessions();
      await writePlatformAudit(db as never, {
        actorUserId: null, eventType: "platform.owner_2fa_enrolled", entityType: "user", entityId: owner.id,
        reason: "Activation du second facteur (scripts/platform-owner.ts)", metadata: { backupCodes: enabled.backupCodes!.length },
      });
      return { userId: owner.id };
    },
    async cancel() {
      await db.delete(twoFactor).where(eq(twoFactor.userId, owner.id));
      await closeSessions();
    },
  };
}

/**
 * Récupération (téléphone perdu, codes de secours épuisés) par un opérateur ayant accès à la base :
 * le second facteur est retiré, toutes les sessions fermées, puis il faut relancer enroll-2fa. La console
 * reste fermée entre-temps (403 platform_2fa_setup_required).
 */
export async function resetOwnerTwoFactor(db: CommercialDatabase, raw: { username: unknown }) {
  const owner = await activeOwnerByUsername(db, raw.username);
  const result = await db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, owner.id));
    await tx.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, owner.id));
    const closed = await tx.delete(sessionTable).where(eq(sessionTable.userId, owner.id)).returning({ id: sessionTable.id });
    await writePlatformAudit(tx as never, {
      actorUserId: null, eventType: "platform.owner_2fa_reset", entityType: "user", entityId: owner.id,
      reason: "Retrait du second facteur pour récupération (scripts/platform-owner.ts)", metadata: { sessionsClosed: closed.length },
    });
    return { sessionsClosed: closed.length };
  });
  return { userId: owner.id, ...result };
}
