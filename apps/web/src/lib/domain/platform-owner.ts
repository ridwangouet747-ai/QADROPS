import { count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { account, platformAdmin, session as sessionTable, user } from "../db/schema";
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
